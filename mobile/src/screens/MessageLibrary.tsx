import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { C, F } from '../theme';
import { useStore } from '../store';
import { api } from '../api';
import { Btn, ShimmerCard, confirmDestructive, useToast } from '../ui';
import {
  CHECKLIST_PRESETS, LINKABLE_PRESETS, MESSAGE_STAGES, MESSAGE_VARS, MessageAudience, MessageStage, MessageTemplate,
  STARTER_MESSAGES, UNIT_FACTS, ciParse, factsOf, messageValues, renderMessage, stayPropOf, varLabel,
} from '../logic';
import { MessagePhotosEditor, StagedPhoto, stageName, st as ms } from '../messages';

/* ── Add → Messages: the message library (Admin) ────────────────────────────
   The list reads as the guest journey (before check-in → check-out), since
   that is the order messages are sent in. The editor's preview fills the
   message with a real upcoming booking, so an Admin sees exactly what a guest
   will get — including which unit is still missing a detail. */

type Draft = {
  id?: number; title: string; body: string; stage: MessageStage; audience: MessageAudience;
  properties: string[]; preset: string;
};
const BLANK: Draft = { title: '', body: '', stage: 'before', audience: 'guest', properties: [], preset: '' };

/* `active`: the Add tab keeps this pane mounted while hidden; messages are
   fetched only once it is actually shown. */
export default function MessageLibrary({ active = true }: { active?: boolean }) {
  const s = useStore();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seeding, setSeeding] = useState(false);
  useEffect(() => { if (active) s.needLogs('messages'); }, [active]);
  const data = s.logs?.messages;
  const templates = data?.templates || [];

  if (!s.logs || !data) return <View style={{ padding: 18, gap: 12 }}>{[0, 1, 2, 3].map((i) => <ShimmerCard key={i} lines={3} />)}</View>;
  if (draft) return <Editor draft={draft} onClose={() => setDraft(null)} />;

  const seed = async () => {
    setSeeding(true);
    try {
      for (const t of STARTER_MESSAGES) await api.saveTemplate(s.pin, t);
      await s.reloadLogs();
      toast(STARTER_MESSAGES.length + ' messages added — edit them to suit', true);
    } catch (e: any) { toast(String(e?.message || e), false); }
    finally { setSeeding(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 120, gap: 12 }}>
      <View>
        <Text style={st.h2}>Message library</Text>
        <Text style={st.sub}>
          Write each message once. On every booking’s page it appears filled in — guest name, dates, the unit’s Wi-Fi and
          address — ready to send on WhatsApp.
        </Text>
      </View>

      {!templates.length ? (
        <View style={[ms.card, { gap: 10 }]}>
          <Text style={ms.emptyT}>Start with ready-made messages</Text>
          <Text style={ms.empty}>
            Booking confirmed · Unit details & directions · Wi-Fi · How is your stay? · Check-out reminder + extend ·
            Thank you + review · New booking (for host). Edit any of them afterwards.
          </Text>
          <Btn title={seeding ? 'Adding…' : 'Add the 7 starter messages'} onPress={seed} disabled={seeding} />
        </View>
      ) : null}

      <Btn title="+ New message" kind={templates.length ? 'primary' : 'ghost'} onPress={() => setDraft({ ...BLANK })} />

      {MESSAGE_STAGES.map((sg) => {
        const list = templates.filter((t) => t.stage === sg.key);
        if (!list.length) return null;
        return (
          <View key={sg.key} style={{ gap: 8 }}>
            <Text style={st.stage}>{sg.label}</Text>
            {list.map((t) => <Row key={t.id} t={t} onPress={() => setDraft({ ...t })} />)}
          </View>
        );
      })}

      {templates.length ? (
        <Text style={st.foot}>
          Each unit’s details (Wi-Fi, address, contacts, door code…) live under Add → Property → edit the unit → Guest info.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Row({ t, onPress }: { t: MessageTemplate; onPress: () => void }) {
  const linked = t.preset ? CHECKLIST_PRESETS.find((p) => p.key === t.preset) : null;
  return (
    <TouchableOpacity style={ms.card} onPress={onPress} activeOpacity={0.75}>
      <View style={ms.tags}>
        {t.audience === 'host' ? <Text style={[ms.tag, ms.tagHost]}>FOR HOST</Text> : <Text style={ms.tag}>FOR GUEST</Text>}
        <Text style={ms.tag}>{t.properties.length ? t.properties.map(unitShort).join(' · ').toUpperCase() : 'ALL UNITS'}</Text>
        {linked ? <Text style={[ms.tag, ms.tagDue]}>{'TICKS: ' + linked.label.toUpperCase()}</Text> : null}
        {t.images?.length ? <Text style={ms.tag}>{t.images.length + ' PHOTO' + (t.images.length === 1 ? '' : 'S')}</Text> : null}
      </View>
      <Text style={ms.title}>{t.title}</Text>
      <Text style={st.snip} numberOfLines={2}>{t.body}</Text>
    </TouchableOpacity>
  );
}
const unitShort = (name: string) => (String(name).match(/\d{3,4}/) || [name])[0];

/* ══ editor ══ */
function Editor({ draft: d0, onClose }: { draft: Draft; onClose: () => void }) {
  const s = useStore();
  const toast = useToast();
  const [d, setD] = useState<Draft>(d0);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<StagedPhoto[]>([]);
  const [removed, setRemoved] = useState<number[]>([]);
  const existing = (s.logs?.messages?.templates || []).find((t) => t.id === d0.id)?.images || [];
  const sel = useRef({ start: d0.body.length, end: d0.body.length });
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const props = s.props.filter((p) => (p.status || 'Active') !== 'Inactive').map((p) => p.name);
  const data = s.logs?.messages;

  /* Custom facts across every unit, so a {door_code} added on 3028 can be used. */
  const custom = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of data?.facts || []) if (!UNIT_FACTS.some((u) => u.key === f.key)) m.set(f.key, f.label || f.key);
    return [...m.entries()].map(([key, label]) => ({ key, label }));
  }, [data]);
  const known = new Set([...MESSAGE_VARS.map((x) => x.key), 'checkin_time', 'checkout_time', ...custom.map((x) => x.key)]);
  const unknown = [...new Set((d.body.match(/\{([a-z][a-z0-9_]*)\}/g) || []).map((m) => m.slice(1, -1)))].filter((k) => !known.has(k));

  const insert = (key: string) => {
    const tok = '{' + key + '}';
    const { start, end } = sel.current;
    const a = Math.min(start, d.body.length), b = Math.min(end, d.body.length);
    const body = d.body.slice(0, a) + tok + d.body.slice(b);
    sel.current = { start: a + tok.length, end: a + tok.length };
    set({ body });
  };

  /* Preview booking: the next arrival in one of the chosen units (any unit
     when the message is for all), else the latest booking there. */
  const sample = useMemo(() => {
    const rows = (s.logs?.bookings?.rows || []).filter((o) => !d.properties.length || d.properties.indexOf(stayPropOf(o.cells)) >= 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const withIn = rows.map((o) => ({ o, t: ciParse(o.cells[20])?.getTime() || 0 })).filter((x) => x.t);
    const next = withIn.filter((x) => x.t >= today.getTime()).sort((a, b) => a.t - b.t)[0]
      || withIn.sort((a, b) => b.t - a.t)[0];
    return next ? next.o : null;
  }, [s.logs, d.properties]);
  const preview = sample ? renderMessage(d.body, messageValues(sample, factsOf(data, stayPropOf(sample.cells)))) : null;

  const save = async () => {
    if (!d.title.trim()) { toast('Give the message a name', false); return; }
    if (!d.body.trim()) { toast('The message is empty', false); return; }
    setBusy(true);
    try {
      const r = await api.saveTemplate(s.pin, { ...d, title: d.title.trim() });
      const id = d.id || r.id;
      /* Photos after the text: a new message needs its id first. */
      let failed = 0;
      for (const pid of removed) { try { await api.deleteMessageImage(s.pin, pid); } catch { failed++; } }
      for (const f of added) { try { await api.uploadMessageImage(s.pin, id, f); } catch { failed++; } }
      await s.reloadLogs();
      toast(failed ? 'Message saved, but ' + failed + ' photo change' + (failed === 1 ? '' : 's') + ' failed' : 'Message saved', !failed);
      onClose();
    } catch (e: any) { toast(String(e?.message || e), false); }
    finally { setBusy(false); }
  };
  const remove = () => confirmDestructive('Delete this message?', '“' + d.title + '” leaves the library. Past sends stay on their bookings.', async () => {
    try { await api.removeTemplate(s.pin, d.id as number); await s.reloadLogs(); toast('Message deleted', true); onClose(); }
    catch (e: any) { toast(String(e?.message || e), false); }
  });
  const toggleProp = (n: string) => set({ properties: d.properties.indexOf(n) >= 0 ? d.properties.filter((x) => x !== n) : [...d.properties, n] });

  const groups: { title: string; vars: { key: string; label: string }[] }[] = [
    { title: 'Guest', vars: MESSAGE_VARS.filter((v) => v.group === 'Guest') },
    { title: 'Stay', vars: MESSAGE_VARS.filter((v) => v.group === 'Stay') },
    { title: 'Unit', vars: [...MESSAGE_VARS.filter((v) => v.group === 'Unit'), ...custom] },
  ];

  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 140, gap: 12 }} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onClose} hitSlop={8}><Text style={st.back}>‹  Message library</Text></TouchableOpacity>
      <Text style={st.h2}>{d.id ? 'Edit message' : 'New message'}</Text>

      <View style={[ms.card, { gap: 12 }]}>
        <Lbl t="Name">
          <TextInput value={d.title} onChangeText={(v) => set({ title: v })} placeholder="e.g. Wi-Fi details" placeholderTextColor={C.muted} style={ms.input} maxLength={80} />
        </Lbl>
        <Lbl t="When is it sent">
          <Chips options={MESSAGE_STAGES.map((x) => ({ key: x.key, label: x.label }))} value={[d.stage]} onPick={(k) => set({ stage: k as MessageStage })} />
        </Lbl>
        <Lbl t="Who is it for">
          <Chips options={[{ key: 'guest', label: 'Guest' }, { key: 'host', label: 'Host' }]} value={[d.audience]} onPick={(k) => set({ audience: k as MessageAudience })} />
        </Lbl>
        <Lbl t="Units">
          <Chips
            options={[{ key: '*', label: 'All units' }, ...props.map((n) => ({ key: n, label: unitShort(n) }))]}
            value={d.properties.length ? d.properties : ['*']}
            onPick={(k) => (k === '*' ? set({ properties: [] }) : toggleProp(k))}
          />
        </Lbl>
        <Lbl t="When sent to the guest, tick this checklist step">
          <Chips
            options={[{ key: '', label: 'None' }, ...LINKABLE_PRESETS.map((p) => ({ key: p.key, label: p.label }))]}
            value={[d.preset]} onPick={(k) => set({ preset: k })}
          />
        </Lbl>
      </View>

      <View style={[ms.card, { gap: 10 }]}>
        <Text style={st.lbl}>Message</Text>
        <TextInput
          value={d.body} onChangeText={(v) => set({ body: v })} multiline textAlignVertical="top"
          onSelectionChange={(e) => { sel.current = e.nativeEvent.selection; }}
          placeholder={'Hi {guest_first_name}, …'} placeholderTextColor={C.muted}
          style={[ms.input, { minHeight: 170, lineHeight: 20 }]}
        />
        {unknown.length ? (
          <Text style={st.bad}>{'Unknown: ' + unknown.map((k) => '{' + k + '}').join(', ') + ' — no booking or unit has it. Add it as a unit detail, or fix the spelling.'}</Text>
        ) : null}
        <Text style={st.lbl}>Tap to insert at the cursor</Text>
        {groups.map((g) => (
          <View key={g.title}>
            <Text style={st.vg}>{g.title}</Text>
            <View style={st.chips}>
              {g.vars.map((v) => (
                <TouchableOpacity key={v.key} style={st.var} onPress={() => insert(v.key)} activeOpacity={0.7}>
                  <Text style={st.varTxt}>{v.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </View>

      <View style={[ms.card, { gap: 6 }]}>
        <Text style={st.lbl}>Photos</Text>
        <MessagePhotosEditor
          existing={existing} removed={removed} added={added}
          onRemoveExisting={(id) => setRemoved((x) => [...x, id])}
          onAdd={(p) => setAdded((x) => [...x, ...p])}
          onRemoveAdded={(i) => setAdded((x) => x.filter((_, j) => j !== i))}
        />
      </View>

      <View style={[ms.card, { gap: 6 }]}>
        <Text style={st.lbl}>Preview</Text>
        {preview && sample ? (
          <>
            <Text style={st.sampleNote}>{'With ' + (sample.cells[2] || 'a booking') + ' · ' + stayPropOf(sample.cells)}</Text>
            <View style={[ms.bubble, { marginTop: 4 }]}><Text style={ms.bubbleTxt}>{preview.text || ' '}</Text></View>
            {preview.missing.length ? (
              <Text style={st.bad}>{'Not set for ' + stayPropOf(sample.cells) + ': ' + preview.missing.map((k) => varLabel(k, data?.facts)).join(', ')}</Text>
            ) : null}
          </>
        ) : <Text style={ms.empty}>No booking in these units to preview with yet.</Text>}
      </View>

      <Btn title={busy ? 'Saving…' : 'Save message'} onPress={save} disabled={busy} />
      {d.id ? <Btn title="Delete message" kind="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

function Lbl({ t, children }: { t: string; children: React.ReactNode }) {
  return <View style={{ gap: 6 }}><Text style={st.lbl}>{t}</Text>{children}</View>;
}
function Chips({ options, value, onPick }: { options: { key: string; label: string }[]; value: string[]; onPick: (k: string) => void }) {
  return (
    <View style={st.chips}>
      {options.map((o) => {
        const on = value.indexOf(o.key) >= 0;
        return (
          <TouchableOpacity key={o.key} onPress={() => onPick(o.key)} style={[st.chip, on && st.chipOn]} activeOpacity={0.7}
            accessibilityState={{ selected: on }}>
            <Text style={[st.chipTxt, on && st.chipTxtOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  h2: { fontFamily: F.xbold, fontSize: 24, color: C.ink },
  sub: { fontFamily: F.med, fontSize: 13, color: C.bark, lineHeight: 19, marginTop: 4 },
  stage: { fontFamily: F.bold, fontSize: 11, color: C.blue2, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 6 },
  snip: { fontFamily: F.med, fontSize: 12.5, color: C.muted, marginTop: 4, lineHeight: 18 },
  foot: { fontFamily: F.med, fontSize: 12, color: C.muted, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  back: { fontFamily: F.bold, fontSize: 13.5, color: C.blue2 },
  lbl: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  vg: { fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: C.line, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: '#fff' },
  chipOn: { backgroundColor: C.navy, borderColor: C.navy },
  chipTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  chipTxtOn: { color: '#fff' },
  var: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 9, backgroundColor: C.amberbg },
  varTxt: { fontFamily: F.semi, fontSize: 12, color: C.blue2 },
  bad: { fontFamily: F.semi, fontSize: 12, color: C.red, lineHeight: 17 },
  sampleNote: { fontFamily: F.med, fontSize: 11.5, color: C.muted },
});
