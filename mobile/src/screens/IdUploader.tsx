import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { C, F } from '../theme';
import { Btn, useToast } from '../ui';
import { useStore } from '../store';
import { api } from '../api';
import { IdFront, IdSlot, backSlot, frontForGuest, frontOf, guestLabel } from '../logic';

/* Guest ID documents for one booking, as a block of UI rather than a screen —
   the Action tab shows it in a sheet, the booking form shows it inline, and
   they must behave identically. Two copies of an upload flow is two places for
   a slot name to drift.

   The booking is the container; each guest is a slot inside it, and each guest's
   ID has a front and a back. Only the FRONT counts as required: an Aadhaar has
   two sides worth keeping, but a passport page or a licence photo may be the
   whole document, so demanding a back would strand bookings on the IDs-pending
   list forever. The back is always offered, never insisted on.

   File picker only, by decision — no in-app camera. Both sources are offered
   because a picker alone reaches the Files app but not the photo library. */

export type Att = {
  id: number; slot: IdSlot; filename: string;
  content_type: string; size_bytes: number; uploaded_at: string;
  localUri?: string;          // staged (not yet uploaded) — see `onStage`
};
export type StagedFile = { uri: string; name: string; mimeType: string };
const SLOT_IDS: IdSlot[] = (['lead', 'co', ...Array.from({ length: 10 }, (_, i) => `g${i + 3}`)] as IdFront[])
  .flatMap((f) => [f, backSlot(f)]);

/* One booking renders one IdUploader per guest slot, all pointed at the same
   row, and each fired its own listAttachments on mount — the call count scaled
   with the number of guests, not with the number of rows needed. Concurrent
   callers for a row now share one request. Nothing is cached past it, so a
   reload after an upload still goes to the server. */
const attsInflight = new Map<number, Promise<Att[]>>();
function listAtts(pin: string, row: number): Promise<Att[]> {
  const live = attsInflight.get(row);
  if (live) return live;
  const p: Promise<Att[]> = api.listAttachments(pin, row)
    .finally(() => { attsInflight.delete(row); });
  attsInflight.set(row, p);
  return p;
}

export default function IdUploader({ row, guest, coGuest, needsCo, onChanged, staged, onStage, extras = [], only, orphansBeyond, compact }: {
  row: number;
  /* Names of guests 3+ (bookings.extra_guests). */
  extras?: string[];
  /* Render just this guest's ID (the booking form places each guest's ID
     inside that guest's own block). */
  only?: IdFront;
  /* Render ONLY documents belonging to guests outside this list — the booking
     form gives each guest their own IdUploader, so a document whose guest the
     booking no longer lists has no block of its own to appear in. Four live
     bookings were found holding a 'co' document while recording one guest: the
     file uploaded, saved and streamed back fine, and was invisible in the app,
     which reads as an upload that silently failed. Unexpected is not the same
     as absent, so it gets a block of its own rather than nothing. */
  orphansBeyond?: IdFront[];
  compact?: boolean;
  /* New booking (no row yet): picked files are held by the form and uploaded
     right after the booking is created. */
  staged?: Partial<Record<IdSlot, StagedFile>>;
  onStage?: (slot: IdSlot, file: StagedFile | null) => void;
  guest: string;
  coGuest: string;
  /* Two guests means two IDs, whether or not the second was ever named. */
  needsCo: boolean;
  onChanged?: () => void;
}) {
  const s = useStore();
  const toast = useToast();
  const [atts, setAtts] = useState<Att[]>([]);
  const [busy, setBusy] = useState<IdSlot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (!onStage) load(); }, [row]);
  const shown: Att[] = onStage
    ? SLOT_IDS.filter((k) => staged?.[k]).map((k, i) => ({
        id: -(i + 1) - SLOT_IDS.indexOf(k) * 10, slot: k, filename: staged![k]!.name,
        content_type: staged![k]!.mimeType, size_bytes: 0, uploaded_at: 'uploads on save', localUri: staged![k]!.uri,
      }))
    : atts;

  async function load() {
    if (!row) { setAtts([]); return; }
    setLoading(true);
    try { setAtts(await listAtts(s.pin, row)); }
    catch (e: any) { toast(e?.message || 'Could not load IDs', false); }
    finally { setLoading(false); }
  }

  async function send(slot: IdSlot, file: { uri: string; name: string; mimeType: string }) {
    if (onStage) { onStage(slot, file); toast('ID added — it uploads when you save the booking', true); return; }
    setBusy(slot);
    try {
      await api.uploadAttachment(s.pin, row, slot, file);
      toast('ID uploaded', true);
      await load();
      await s.reloadLogs();          // refreshes idMap so the Action list updates
      onChanged?.();
    } catch (e: any) {
      toast(e?.message || 'Upload failed', false);
    } finally { setBusy(null); }
  }

  async function pickFile(slot: IdSlot) {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['image/*', 'application/pdf'],
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    await send(slot, {
      uri: a.uri,
      name: a.name || 'id',
      mimeType: a.mimeType || 'application/octet-stream',
    });
  }

  async function pickPhoto(slot: IdSlot) {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { toast('Photo access is needed to pick an image', false); return; }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,               // ID scans stay legible; keeps uploads well under the 12 MB cap
    });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    await send(slot, {
      uri: a.uri,
      name: a.fileName || 'photo.jpg',
      mimeType: a.mimeType || 'image/jpeg',
    });
  }

  async function remove(id: number) {
    const st0 = shown.find((a) => a.id === id);
    if (onStage && st0) { onStage(st0.slot, null); return; }
    try {
      await api.deleteAttachment(s.pin, id);
      toast('ID removed', true);
      await load();
      await s.reloadLogs();
      onChanged?.();
    } catch (e: any) { toast(e?.message || 'Could not remove', false); }
  }

  const allPeople: { front: IdFront; label: string; who: string }[] = [
    { front: 'lead', label: 'Lead guest', who: guest || '—' },
    ...(needsCo
      ? [{ front: 'co' as IdFront, label: 'Co-guest', who: coGuest || 'Name not recorded' }]
      : []),
    ...extras.map((n, i) => ({ front: frontForGuest(i + 3), label: `Guest ${i + 3}`, who: n || 'Name not recorded' })),
  ];
  /* Whose documents are actually on file, in slot order. */
  const onFile: IdFront[] = [];
  for (const a of shown) { const f = frontOf(a.slot); if (onFile.indexOf(f) < 0) onFile.push(f); }
  const orphansOf = (covered: IdFront[]) => onFile
    .filter((f) => covered.indexOf(f) < 0)
    .map((f) => ({ front: f, label: guestLabel(f), who: '', orphan: true }));

  const people: { front: IdFront; label: string; who: string; orphan?: boolean }[] =
    orphansBeyond ? orphansOf(orphansBeyond)
    : only ? [{ front: only, label: '', who: '' }]
    /* The sheet is the whole booking's documents, so it carries the orphans. */
    : [...allPeople, ...orphansOf(allPeople.map((p) => p.front))];

  return (
    <View>
      {loading ? <ActivityIndicator color={C.navy} style={{ marginVertical: 14 }} /> : null}

      {people.map((pp) => {
        const back = backSlot(pp.front);
        const gotFront = shown.find((a) => a.slot === pp.front);
        const gotBack = shown.find((a) => a.slot === back);
        /* An orphan's empty side offers no upload button: filling it would only
           store a second document nobody asked for. Replace and Remove stay. */
        return (
          <View key={pp.front} style={compact && !pp.orphan ? null : st.block}>
            {pp.orphan ? (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={st.who} numberOfLines={1}>{pp.label}</Text>
                  <Text style={st.role}>No longer listed on this booking</Text>
                </View>
                <Text style={[st.tag, st.tagOk]}>On file</Text>
              </View>
            ) : compact ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Text style={[st.role, { flex: 1 }]}>ID document</Text>
                <Text style={[st.tag, gotFront ? st.tagOk : st.tagNo]}>
                  {gotFront ? (onStage ? 'Ready' : 'On file') : 'Missing'}
                </Text>
              </View>
            ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={st.who} numberOfLines={1}>{pp.who}</Text>
                <Text style={st.role}>{pp.label}</Text>
              </View>
              <Text style={[st.tag, gotFront ? st.tagOk : st.tagNo]}>
                {gotFront ? (onStage ? 'Ready' : 'On file') : 'Missing'}
              </Text>
            </View>
            )}

            {pp.orphan && !gotFront ? null : (
              <SideRow
                label="Front" required={!pp.orphan} hint={pp.orphan ? '' : undefined} slot={pp.front} att={gotFront}
                busy={busy === pp.front} pin={s.pin}
                onFile={pickFile} onPhoto={pickPhoto} onRemove={remove}
              />
            )}
            {pp.orphan && !gotBack ? null : (
              <SideRow
                label="Back" hint={pp.orphan ? '' : undefined} slot={back} att={gotBack}
                busy={busy === back} pin={s.pin}
                onFile={pickFile} onPhoto={pickPhoto} onRemove={remove}
              />
            )}
          </View>
        );
      })}

      {compact || orphansBeyond ? null : <Text style={st.note}>
        Stored privately and only reachable with your PIN. Documents are deleted
        automatically 6 months after check-out. Where a full ID is not required,
        a masked copy is safer to keep.
      </Text>}
    </View>
  );
}

/* One side of one guest's ID: what is there, and the two ways to replace it.
   The back says "optional" out loud so an empty one never reads as a failure. */
function SideRow({ label, required, hint, slot, att, busy, pin, onFile, onPhoto, onRemove }: {
  label: string; required?: boolean; hint?: string; slot: IdSlot; att?: Att; busy: boolean; pin: string;
  onFile: (s: IdSlot) => void; onPhoto: (s: IdSlot) => void; onRemove: (id: number) => void;
}) {
  return (
    <View style={st.side}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={st.sideLbl}>{label}</Text>
        <Text style={st.sideNote}>{hint !== undefined ? hint : required ? 'required' : 'optional'}</Text>
      </View>

      {att ? (
        <View style={st.have}>
          {/^image\//i.test(att.content_type) ? (
            <Image source={{ uri: att.localUri || api.attachmentUrl(pin, att.id) }} style={st.thumb} />
          ) : (
            <View style={[st.thumb, st.pdf]}><Text style={st.pdfTxt}>PDF</Text></View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={st.fname} numberOfLines={1}>{att.filename || 'document'}</Text>
            <Text style={st.fmeta}>
              {att.localUri ? 'Uploads when you save' : Math.max(1, Math.round(att.size_bytes / 1024)) + ' KB · ' + att.uploaded_at}
            </Text>
          </View>
          {att.localUri ? null : (
            <TouchableOpacity onPress={() => Linking.openURL(api.attachmentUrl(pin, att.id))} activeOpacity={0.7}>
              <Text style={st.link}>View</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => onRemove(att.id)} activeOpacity={0.7}>
            <Text style={[st.link, { color: C.red }]}>Remove</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {busy ? (
        <View style={st.uploading}>
          <ActivityIndicator color={C.navy} size="small" />
          <Text style={st.uploadingTxt}>Uploading…</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <Btn title={att ? 'Replace file' : 'Choose file'} kind="ghost"
               onPress={() => onFile(slot)} style={{ flex: 1 }} />
          <Btn title={att ? 'Replace photo' : 'Choose photo'} kind="ghost"
               onPress={() => onPhoto(slot)} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  block: { borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 12, marginTop: 4, paddingBottom: 12 },
  who: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  role: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 1 },
  tag: { fontFamily: F.bold, fontSize: 11, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 999, overflow: 'hidden' },
  tagOk: { color: C.green, backgroundColor: C.greenbg },
  tagNo: { color: C.red, backgroundColor: C.redbg },
  side: { marginTop: 11, paddingTop: 9, borderTopWidth: 1, borderTopColor: '#F7F5F0' },
  sideLbl: { fontFamily: F.bold, fontSize: 12, color: C.ink, flex: 1 },
  sideNote: { fontFamily: F.med, fontSize: 10.5, color: C.muted },
  have: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: C.bg },
  pdf: { alignItems: 'center', justifyContent: 'center' },
  pdfTxt: { fontFamily: F.bold, fontSize: 11, color: C.muted },
  fname: { fontFamily: F.semi, fontSize: 12.5, color: C.ink },
  fmeta: { fontFamily: F.med, fontSize: 11, color: C.muted, marginTop: 1 },
  link: { fontFamily: F.semi, fontSize: 12, color: C.navy, paddingHorizontal: 6 },
  uploading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  uploadingTxt: { fontFamily: F.med, fontSize: 12.5, color: C.muted },
  note: {
    fontFamily: F.med, fontSize: 11.5, color: C.muted, lineHeight: 17,
    borderTopWidth: 1, borderTopColor: C.hair, paddingTop: 12, marginTop: 4,
  },
});
