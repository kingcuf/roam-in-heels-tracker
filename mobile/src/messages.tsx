import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, Platform, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { C, F } from './theme';
import { useStore } from './store';
import { api } from './api';
import { Btn, useToast } from './ui';
import {
  CHECKLIST_PRESETS, FACT_KEY_RE, MESSAGE_STAGES, MessageImage, MessageTemplate, UNIT_FACTS, factKeyOf, factsOf,
  messageValues, messagesFor, renderMessage, stayPropOf, varLabel, waLink,
} from './logic';

/* ── Messages ───────────────────────────────────────────────────────────────
   Two surfaces here, the library editor lives in screens/MessageLibrary:
     * BookingMessages — the booking page's Messages tab: every message for
       this unit, filled in, sendable to WhatsApp in two taps.
     * UnitFactsEditor — Admin, on the property: the "guest info" every
       message draws on (Wi-Fi, address, contacts, custom facts). */

export const stageName = (k: string) => (MESSAGE_STAGES.find((x) => x.key === k) || { label: k }).label;
export const when = (iso: string) => {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return '';
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return d.getDate() + ' ' + m + ', ' + h + ':' + String(d.getMinutes()).padStart(2, '0') + ' ' + ap;
};
const RECIPIENT_LABEL: Record<string, string> = { guest: 'guest', host: 'host', manager: 'property manager', other: 'another number' };

/* ══ on the booking page ══ */
export function BookingMessages({ row }: { row: number }) {
  const s = useStore();
  const o = (s.logs?.bookings?.rows || []).find((x) => x.r === row) || null;
  const data = s.logs?.messages;
  const { list, due } = useMemo(() => (o ? messagesFor(o, data) : { list: [], due: 'any' as const }), [o, data]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { setOpen(list.length ? list[0].id : null); }, [row, list.length]);
  if (!o) return null;
  if (!data) return <Text style={st.empty}>Messages need the latest server — refresh in a minute.</Text>;
  const prop = stayPropOf(o.cells);
  const isAdmin = s.me?.role === 'Admin';
  if (!list.length) {
    return (
      <View style={st.card}>
        <Text style={st.emptyT}>No messages yet</Text>
        <Text style={st.empty}>
          {isAdmin
            ? 'Write your messages once under Add → Messages, and they appear here filled in for every booking.'
            : 'An Admin sets up the message library under Add → Messages.'}
        </Text>
      </View>
    );
  }
  const facts = factsOf(data, prop);
  const values = messageValues(o, facts);
  return (
    <View style={{ gap: 10 }}>
      {list.map((t) => (
        <MessageCard
          key={t.id} t={t} row={row} values={values} facts={facts} prop={prop}
          guestPhone={String(o.cells[13] ?? '').trim()}
          dueNow={t.stage === due && due !== 'any'}
          open={open === t.id} onToggle={() => setOpen(open === t.id ? null : t.id)}
        />
      ))}
    </View>
  );
}

function MessageCard({ t, row, values, facts, prop, guestPhone, dueNow, open, onToggle }: {
  t: MessageTemplate; row: number; values: Record<string, string>; facts: Record<string, string>; prop: string;
  guestPhone: string; dueNow: boolean; open: boolean; onToggle: () => void;
}) {
  const s = useStore();
  const toast = useToast();
  const { text, missing } = renderMessage(t.body, values);
  const [draft, setDraft] = useState<string | null>(null);   // one-off edit, never saved to the template
  const [other, setOther] = useState<string | null>(null);
  useEffect(() => { setDraft(null); setOther(null); }, [t.id, t.body, row]);
  const out = draft ?? text;
  /* A raw {variable} never reaches a guest. Sending opens again once the
     detail is added to the unit, or the text is edited for this send. */
  const blocked = /\{[a-z][a-z0-9_]*\}/.test(out);

  const images = t.images || [];
  const files = usePhotoFiles(open ? images : [], s.pin);
  const canShareFiles = Platform.OS === 'web' && !!files && !!(navigator as any)?.canShare?.({ files });
  /* WhatsApp's click-to-chat link carries text only. Photos go through the
     phone's share sheet (pick the same chat), or are saved on a computer so
     they can be dropped into WhatsApp Web. */
  const sharePhotos = async () => {
    if (!images.length) return;
    if (Platform.OS === 'web') {
      if (!files) { toast('Photos are still loading — try again in a moment', false); return; }
      if (canShareFiles) {
        try { await (navigator as any).share({ files }); } catch { /* dismissed */ }
        return;
      }
      for (const f of files) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      toast(files.length + ' photo' + (files.length === 1 ? '' : 's') + ' saved — drag them into the WhatsApp chat', true);
      return;
    }
    for (const im of images) await Linking.openURL(api.attachmentUrl(s.pin, im.id)).catch(() => {});
  };

  const sends = (s.logs?.messages?.sends || []).filter((x) => x.booking_row === row && x.template_id === t.id);
  const last = sends[sends.length - 1];
  const linked = t.preset ? CHECKLIST_PRESETS.find((p) => p.key === t.preset) : null;

  const send = async (who: 'guest' | 'host' | 'manager' | 'other', phone: string) => {
    if (!phone.replace(/\D/g, '')) { toast('No number to send to', false); return; }
    if (blocked) return;
    /* Open WhatsApp first — on the web a popup has to come straight from the
       tap, before any await, or the browser blocks it. */
    Linking.openURL(waLink(phone, out)).catch(() => toast('Couldn’t open WhatsApp', false));
    try {
      const r = await api.logMessageSend(s.pin, row, t.id, who);
      if (r.ticked) toast('Checklist: “' + (linked?.label || 'step') + '” ticked', true);
      s.reloadLogs();
    } catch (e: any) { toast(String(e?.message || e), false); }
  };
  const copy = async () => {
    if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
      try { await (navigator as any).clipboard.writeText(out); toast('Copied', true); return; } catch { /* fall through */ }
    }
    try { await Share.share({ message: out }); } catch { /* dismissed */ }
  };

  const primary = t.audience === 'host'
    ? { who: 'host' as const, phone: facts.host_phone || '', label: 'WhatsApp host', none: 'No host mobile on ' + prop }
    : { who: 'guest' as const, phone: guestPhone, label: 'WhatsApp guest', none: 'No guest mobile on this booking' };
  const secondary = ([
    t.audience === 'host' ? null : { who: 'host' as const, phone: facts.host_phone || '', label: 'To host' },
    { who: 'manager' as const, phone: facts.manager_phone || '', label: 'To manager' },
  ].filter(Boolean) as { who: 'host' | 'manager'; phone: string; label: string }[]).filter((x) => x.phone);

  return (
    <View style={[st.card, dueNow && st.cardDue]}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={st.head} accessibilityRole="button"
        accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1 }}>
          <View style={st.tags}>
            {dueNow ? <Text style={[st.tag, st.tagDue]}>DUE NOW</Text> : null}
            <Text style={st.tag}>{stageName(t.stage).toUpperCase()}</Text>
            {t.audience === 'host' ? <Text style={[st.tag, st.tagHost]}>FOR HOST</Text> : null}
          </View>
          <Text style={st.title}>{t.title}</Text>
          <Text style={[st.status, last ? { color: C.green } : missing.length ? { color: C.red } : null]} numberOfLines={1}>
            {last
              ? '✓ Sent to ' + RECIPIENT_LABEL[last.recipient] + ' by ' + last.sent_by + ' · ' + when(last.sent_at) + (sends.length > 1 ? ' · ' + sends.length + '×' : '')
              : missing.length ? missing.length + ' detail' + (missing.length === 1 ? '' : 's') + ' missing' : 'Not sent yet'}
          </Text>
        </View>
        <Text style={st.chev}>{open ? '–' : '+'}</Text>
      </TouchableOpacity>

      {open ? (
        <View>
          {missing.length ? (
            <View style={st.warn}>
              <Text style={st.warnT}>
                {'Missing: ' + missing.map((k) => varLabel(k)).join(', ') + '.'}
              </Text>
              <Text style={st.warnS}>
                {s.me?.role === 'Admin'
                  ? 'Add it under Add → Property → ' + prop + ' → Guest info, or edit the text below for this send.'
                  : 'Ask an Admin to add it to ' + prop + '’s guest info, or edit the text below for this send.'}
              </Text>
            </View>
          ) : null}

          {draft !== null ? (
            <TextInput value={draft} onChangeText={setDraft} multiline style={[st.bubble, st.bubbleEdit]} textAlignVertical="top" />
          ) : (
            <View style={st.bubble}><Text style={st.bubbleTxt} selectable>{out}</Text></View>
          )}
          {images.length ? (
            <View style={st.photos}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {images.map((im) => (
                  <TouchableOpacity key={im.id} activeOpacity={0.85}
                    onPress={() => Linking.openURL(api.attachmentUrl(s.pin, im.id)).catch(() => {})}>
                    <Image source={{ uri: api.attachmentUrl(s.pin, im.id) }} style={st.thumb} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={st.photoRow}>
                <Text style={st.photoNote}>
                  {Platform.OS === 'web' && !canShareFiles
                    ? 'WhatsApp links carry text only. Send the text, then save the photos and drop them into the chat.'
                    : 'WhatsApp links carry text only. Send the text, then share the photos and pick the same chat.'}
                </Text>
                <Btn kind="mini" title={(Platform.OS === 'web' && !canShareFiles ? 'Save ' : 'Share ') + images.length + ' photo' + (images.length === 1 ? '' : 's')}
                  onPress={sharePhotos} disabled={Platform.OS === 'web' && !files} />
              </View>
            </View>
          ) : null}
          <View style={st.minorRow}>
            <TouchableOpacity onPress={() => setDraft(draft === null ? text : null)} hitSlop={6}>
              <Text style={st.link}>{draft === null ? 'Edit for this send' : 'Undo my edits'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={copy} hitSlop={6}>
              <Text style={st.link}>{Platform.OS === 'web' ? 'Copy' : 'Share…'}</Text>
            </TouchableOpacity>
          </View>
          {linked ? <Text style={st.linkNote}>{'Sending to the guest ticks “' + linked.label + '” on the checklist.'}</Text> : null}

          {blocked ? (
            <View style={[st.wa, st.waOff]}>
              <Text style={[st.waTxt, { color: C.bark }]}>{primary.label}</Text>
              <Text style={[st.waSub, { color: C.muted }]}>Add the missing detail, or edit the text, to send</Text>
            </View>
          ) : primary.phone ? (
            <TouchableOpacity style={st.wa} onPress={() => send(primary.who, primary.phone)} activeOpacity={0.8}>
              <Text style={st.waTxt}>{primary.label}</Text>
              <Text style={st.waSub}>{primary.phone}</Text>
            </TouchableOpacity>
          ) : <Text style={st.noNum}>{primary.none}</Text>}
          <View style={st.altRow}>
            {secondary.map((x) => (
              <TouchableOpacity key={x.who} style={[st.alt, blocked && { opacity: 0.45 }]} disabled={blocked}
                onPress={() => send(x.who, x.phone)} activeOpacity={0.7}>
                <Text style={st.altTxt}>{x.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={st.alt} onPress={() => setOther(other === null ? '' : null)} activeOpacity={0.7}>
              <Text style={st.altTxt}>Other number…</Text>
            </TouchableOpacity>
          </View>
          {other !== null ? (
            <View style={st.otherRow}>
              <TextInput
                value={other} onChangeText={setOther} placeholder="Mobile number" placeholderTextColor={C.muted}
                keyboardType="phone-pad" style={[st.input, { flex: 1 }]} autoFocus
              />
              <Btn kind="mini" title="Send" onPress={() => send('other', other)} disabled={blocked || other.replace(/\D/g, '').length < 10} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ══ on the property (Admin) ══ */
type FactRow = { key: string; label: string; value: string; custom?: boolean };
/* Web: fetch a message's photos as Files once the card opens, so the share
   sheet can be called straight from the tap (browsers refuse navigator.share
   after a slow await). null while loading. */
function usePhotoFiles(images: MessageImage[], pin: string): File[] | null {
  const [files, setFiles] = useState<File[] | null>(null);
  const key = images.map((i) => i.id).join(',');
  useEffect(() => {
    if (Platform.OS !== 'web' || !key) { setFiles(null); return; }
    let live = true;
    setFiles(null);
    Promise.all(images.map(async (im, i) => {
      const b = await (await fetch(api.attachmentUrl(pin, im.id))).blob();
      const ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      return new File([b], (im.name || 'photo-' + (i + 1)).replace(/\.[^.]+$/, '') + '.' + ext, { type: b.type || im.type });
    })).then((fs) => { if (live) setFiles(fs); }).catch(() => { if (live) setFiles([]); });
    return () => { live = false; };
  }, [key, pin]);
  return files;
}

/* ══ Admin: photos on a library message ══
   Staged until the message is saved, like every other field in the editor. */
export type StagedPhoto = { uri: string; name: string; mimeType: string };
export const MAX_MESSAGE_PHOTOS = 6;
export function MessagePhotosEditor({ existing, removed, added, onRemoveExisting, onAdd, onRemoveAdded }: {
  existing: MessageImage[]; removed: number[]; added: StagedPhoto[];
  onRemoveExisting: (id: number) => void; onAdd: (p: StagedPhoto[]) => void; onRemoveAdded: (i: number) => void;
}) {
  const s = useStore();
  const toast = useToast();
  const kept = existing.filter((x) => removed.indexOf(x.id) < 0);
  const room = MAX_MESSAGE_PHOTOS - kept.length - added.length;
  const pick = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { toast('Photo access is needed to pick an image', false); return; }
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75, allowsMultipleSelection: true, selectionLimit: room });
    if (r.canceled || !r.assets?.length) return;
    const list = r.assets.slice(0, room).map((a, i) => ({ uri: a.uri, name: a.fileName || 'photo-' + (i + 1) + '.jpg', mimeType: a.mimeType || 'image/jpeg' }));
    if (r.assets.length > room) toast('Only ' + MAX_MESSAGE_PHOTOS + ' photos per message', false);
    onAdd(list);
  };
  return (
    <View style={{ gap: 8 }}>
      <View style={st.chipsWrap}>
        {kept.map((im) => (
          <View key={'e' + im.id}>
            <Image source={{ uri: api.attachmentUrl(s.pin, im.id) }} style={st.thumb} />
            <TouchableOpacity style={st.thumbX} onPress={() => onRemoveExisting(im.id)} hitSlop={6} accessibilityLabel="Remove photo">
              <Text style={st.thumbXT}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        {added.map((p, i) => (
          <View key={'a' + i}>
            <Image source={{ uri: p.uri }} style={st.thumb} />
            <TouchableOpacity style={st.thumbX} onPress={() => onRemoveAdded(i)} hitSlop={6} accessibilityLabel="Remove photo">
              <Text style={st.thumbXT}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        {room > 0 ? (
          <TouchableOpacity style={[st.thumb, st.thumbAdd]} onPress={pick} activeOpacity={0.7} accessibilityLabel="Add photo">
            <Text style={st.thumbAddT}>+</Text>
            <Text style={st.thumbAddS}>Photo</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={st.photoNote}>{'Up to ' + MAX_MESSAGE_PHOTOS + ' photos, e.g. the building gate, parking or Wi-Fi card. They go out with the message.'}</Text>
    </View>
  );
}

export function UnitFactsEditor({ property }: { property: string }) {
  const s = useStore();
  const toast = useToast();
  const stored = useMemo(
    () => (s.logs?.messages?.facts || []).filter((f) => f.property === property),
    [s.logs, property],
  );
  const initial = (): FactRow[] => [
    ...UNIT_FACTS.map((f) => ({ key: f.key, label: f.label, value: stored.find((x) => x.key === f.key)?.value || '' })),
    ...stored.filter((x) => !UNIT_FACTS.some((f) => f.key === x.key))
      .map((x) => ({ key: x.key, label: x.label || x.key, value: x.value, custom: true })),
  ];
  const [rows, setRows] = useState<FactRow[]>(initial);
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  useEffect(() => { setRows(initial()); }, [stored]);
  if (!s.logs?.messages) return <Text style={st.empty}>Guest info needs the latest server — refresh in a minute.</Text>;

  const dirty = JSON.stringify(rows.map((r) => [r.key, r.value.trim()])) !== JSON.stringify(initial().map((r) => [r.key, r.value.trim()]));
  const set = (k: string, v: string) => setRows((rs) => rs.map((r) => (r.key === k ? { ...r, value: v } : r)));
  const addCustom = () => {
    const key = factKeyOf(newLabel);
    if (!FACT_KEY_RE.test(key)) { toast('Give the detail a name, e.g. Door code', false); return; }
    if (rows.some((r) => r.key === key)) { toast('{' + key + '} already exists', false); return; }
    setRows((rs) => [...rs, { key, label: newLabel.trim(), value: '', custom: true }]);
    setNewLabel('');
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.setPropertyFacts(s.pin, property, rows.map((r) => ({ key: r.key, label: r.label, value: r.value.trim() })));
      await s.reloadLogs();
      toast('Guest info saved', true);
    } catch (e: any) { toast(String(e?.message || e), false); }
    finally { setSaving(false); }
  };

  return (
    <View>
      {rows.map((r) => {
        const def = UNIT_FACTS.find((f) => f.key === r.key);
        return (
          <View key={r.key} style={st.factRow}>
            <View style={st.factHead}>
              <Text style={st.factLbl}>{r.label}</Text>
              <Text style={st.factKey}>{'{' + r.key + '}'}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={r.value} onChangeText={(v) => set(r.key, v)} placeholder={def?.hint || ''} placeholderTextColor={C.muted}
                style={[st.input, { flex: 1 }, def?.multiline && { minHeight: 60 }]} multiline={!!def?.multiline}
                autoCapitalize="none" textAlignVertical="top"
              />
              {r.custom ? (
                <TouchableOpacity onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} hitSlop={8} accessibilityLabel={'Remove ' + r.label}>
                  <Text style={st.x}>×</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}
      <View style={[st.otherRow, { marginTop: 6 }]}>
        <TextInput
          value={newLabel} onChangeText={setNewLabel} placeholder="Add a detail, e.g. Door code" placeholderTextColor={C.muted}
          style={[st.input, { flex: 1 }]} onSubmitEditing={addCustom} maxLength={40}
        />
        <Btn kind="mini" title="+ Add" onPress={addCustom} disabled={!newLabel.trim()} />
      </View>
      <Btn title={saving ? 'Saving…' : dirty ? 'Save guest info' : 'Saved'} onPress={save} disabled={!dirty || saving} style={{ marginTop: 14 }} />
    </View>
  );
}

export const st = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12 },
  cardDue: { borderWidth: 1.5, borderColor: C.copper },
  empty: { fontFamily: F.med, fontSize: 13, color: C.muted, lineHeight: 19 },
  emptyT: { fontFamily: F.bold, fontSize: 15, color: C.ink, marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tags: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  tag: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.9, color: C.bark, backgroundColor: C.bone, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  tagDue: { backgroundColor: C.amberbg, color: C.blue2 },
  tagHost: { backgroundColor: C.skybg, color: C.sky },
  title: { fontFamily: F.bold, fontSize: 15.5, color: C.ink },
  status: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  chev: { fontFamily: F.bold, fontSize: 22, color: C.blue2, width: 22, textAlign: 'center' },
  warn: { backgroundColor: C.redbg, borderRadius: 12, padding: 10, marginTop: 12 },
  warnT: { fontFamily: F.bold, fontSize: 12.5, color: C.red },
  warnS: { fontFamily: F.med, fontSize: 12, color: C.red, marginTop: 2, opacity: 0.85 },
  photos: { marginTop: 10, gap: 8 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  photoNote: { flex: 1, fontFamily: F.med, fontSize: 11.5, color: C.muted, lineHeight: 16 },
  thumb: { width: 76, height: 76, borderRadius: 10, backgroundColor: C.line },
  thumbX: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  thumbXT: { color: '#fff', fontSize: 15, lineHeight: 17, fontFamily: F.bold },
  thumbAdd: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.line, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  thumbAddT: { fontFamily: F.bold, fontSize: 22, color: C.blue2, lineHeight: 24 },
  thumbAddS: { fontFamily: F.semi, fontSize: 11, color: C.blue2 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 6 },
  bubble: { backgroundColor: '#E7F6DF', borderRadius: 14, borderTopLeftRadius: 4, padding: 12, marginTop: 12 },
  bubbleEdit: { minHeight: 160, fontFamily: F.med, fontSize: 14, color: C.ink, lineHeight: 20, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  bubbleTxt: { fontFamily: F.med, fontSize: 14, color: '#1B2B1B', lineHeight: 20 },
  minorRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  link: { fontFamily: F.bold, fontSize: 12.5, color: C.blue2 },
  linkNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 8 },
  wa: { backgroundColor: '#2F7D57', borderRadius: 14, paddingVertical: 11, alignItems: 'center', marginTop: 12 },
  waOff: { backgroundColor: C.bone },
  waTxt: { fontFamily: F.bold, fontSize: 15, color: '#fff' },
  waSub: { fontFamily: F.med, fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  noNum: { fontFamily: F.med, fontSize: 12.5, color: C.red, marginTop: 12, textAlign: 'center' },
  altRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8, justifyContent: 'center' },
  alt: { borderRadius: 10, borderWidth: 1, borderColor: C.line, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: C.warm2 },
  altTxt: { fontFamily: F.bold, fontSize: 12.5, color: C.ink },
  otherRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9,
    fontFamily: F.med, fontSize: 14, color: C.ink, backgroundColor: '#fff',
  },
  factRow: { marginBottom: 10 },
  factHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  factLbl: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  factKey: { fontFamily: F.med, fontSize: 11, color: C.muted },
  x: { fontFamily: F.bold, fontSize: 20, color: C.muted, paddingHorizontal: 4 },
});
