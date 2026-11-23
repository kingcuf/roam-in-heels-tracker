import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, BackHandler, Image, Linking, Platform, ScrollView, Share, StyleSheet, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, G } from '../theme';
import { useStore } from '../store';
import { api } from '../api';
import { confirmDestructive, useToast } from '../ui';
import { waLink } from '../logic';
import { UnitTile, unitNo } from '../propertyPicker';

/* ── Unit photos ────────────────────────────────────────────────────────────
   "Can you send pictures of 3028?" — answered from here instead of from the
   phone's gallery or an old chat. Two ways out, because they suit different
   asks:
     * Share photos — the chosen pictures themselves, through the phone's share
       sheet into a WhatsApp chat (a computer saves them for WhatsApp Web).
     * Album link — one WhatsApp message to a number with a link to a clean
       page of every photo of the unit. Works from any device, no attachments.
   Admins add and remove photos here; everyone else only shares. */

export default function UnitGallery() {
  const s = useStore();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const open = s.gallery !== null;
  const units = (s.props || []).filter((p) => (p.status || 'Active') !== 'Inactive');
  const prop = s.gallery || units[0]?.name || '';
  const album = (s.logs?.photos || []).find((a) => a.property === prop);
  const photos = album?.photos || [];
  const admin = s.me?.role === 'Admin';
  const no = unitNo(prop) || prop;

  const [sel, setSel] = useState<number[]>([]);
  const [manage, setManage] = useState(false);
  const [busy, setBusy] = useState('');
  const [phone, setPhone] = useState('');
  const [view, setView] = useState<number | null>(null);
  useEffect(() => { setSel([]); setManage(false); setView(null); }, [prop, open]);

  /* Web: selected photos are fetched as Files ahead of the tap, because a
     browser only opens the share sheet straight from a tap. */
  const cache = useRef(new Map<number, File>());
  const [, bump] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let live = true;
    for (const id of sel) {
      if (cache.current.has(id)) continue;
      const ph = photos.find((p) => p.id === id);
      fetch(api.attachmentUrl(s.pin, id)).then((r) => r.blob()).then((b) => {
        const ext = (b.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
        cache.current.set(id, new File([b], 'unit-' + no + '-' + id + '.' + ext, { type: b.type || ph?.type || 'image/jpeg' }));
        if (live) bump((n) => n + 1);
      }).catch(() => {});
    }
    return () => { live = false; };
  }, [sel.join(',')]);
  const files = sel.map((id) => cache.current.get(id)).filter(Boolean) as File[];
  const ready = files.length === sel.length;
  const canShare = Platform.OS === 'web' && ready && !!files.length && !!(navigator as any)?.canShare?.({ files });

  useEffect(() => {
    if (!open) return;
    const close = () => { if (view !== null) setView(null); else s.closeGallery(); };
    if (Platform.OS === 'web') {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const h = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => h.remove();
  }, [open, view]);

  if (!open) return null;

  const toggle = (id: number) => setSel((x) => (x.indexOf(id) >= 0 ? x.filter((y) => y !== id) : [...x, id]));
  const cols = width >= 700 ? 5 : 3;
  const gap = 6;
  const tile = Math.floor((Math.min(width, 900) - 28 - gap * (cols - 1)) / cols);

  const sharePhotos = async () => {
    if (!sel.length) return;
    if (Platform.OS === 'web') {
      if (!ready) { toast('Still loading the photos — a moment', false); return; }
      if (canShare) { try { await (navigator as any).share({ files }); } catch { /* dismissed */ } return; }
      for (const f of files) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(f); a.download = f.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      toast(files.length + ' photo' + (files.length === 1 ? '' : 's') + ' saved — drag them into the WhatsApp chat', true);
      return;
    }
    for (const id of sel) await Linking.openURL(api.attachmentUrl(s.pin, id)).catch(() => {});
  };
  const linkText = 'Here are the photos of Unit ' + no + ' — Roam in Heels:\n' + (album?.album || '');
  const sendLink = () => {
    if (!album?.album) { toast('Album link not ready — refresh and try again', false); return; }
    const digits = phone.replace(/\D/g, '');
    if (digits && digits.length < 10) { toast('Enter a full mobile number, or leave it empty to pick a chat', false); return; }
    Linking.openURL(digits ? waLink(phone, linkText) : 'https://wa.me/?text=' + encodeURIComponent(linkText))
      .catch(() => toast('Couldn’t open WhatsApp', false));
  };
  const copyLink = async () => {
    if (!album?.album) return;
    if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
      try { await (navigator as any).clipboard.writeText(album.album); toast('Album link copied', true); return; } catch { /* fall through */ }
    }
    try { await Share.share({ message: linkText }); } catch { /* dismissed */ }
  };

  const add = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { toast('Photo access is needed to pick photos', false); return; }
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 20 });
    if (r.canceled || !r.assets?.length) return;
    let ok = 0, bad = '';
    for (let i = 0; i < r.assets.length; i++) {
      const a = r.assets[i];
      setBusy('Uploading ' + (i + 1) + ' of ' + r.assets.length + '…');
      try {
        await api.uploadPropertyPhoto(s.pin, prop, { uri: a.uri, name: a.fileName || 'photo-' + (i + 1) + '.jpg', mimeType: a.mimeType || 'image/jpeg' });
        ok++;
      } catch (e: any) { bad = String(e?.message || e); }
    }
    setBusy('');
    await s.reloadLogs();
    toast(bad ? ok + ' added · ' + (r.assets.length - ok) + ' failed: ' + bad : ok + ' photo' + (ok === 1 ? '' : 's') + ' added', !bad);
  };
  const remove = (id: number) => confirmDestructive('Remove this photo?', 'It leaves Unit ' + no + '’s album, including the guest link.', async () => {
    try { await api.deletePropertyPhoto(s.pin, id); setSel((x) => x.filter((y) => y !== id)); await s.reloadLogs(); toast('Photo removed', true); }
    catch (e: any) { toast(String(e?.message || e), false); }
  });

  return (
    <View style={[StyleSheet.absoluteFill, st.page, { paddingTop: insets.top }]}>
      <View style={st.top}>
        <TouchableOpacity onPress={() => s.closeGallery()} hitSlop={10} accessibilityLabel="Back"><Text style={st.back}>‹</Text></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={st.h1}>{'Unit ' + no + ' photos'}</Text>
          <Text style={st.sub} numberOfLines={1}>{prop + ' · ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's')}</Text>
        </View>
        {admin && photos.length ? (
          <TouchableOpacity onPress={() => { setManage(!manage); setSel([]); }} hitSlop={8}>
            <Text style={st.link}>{manage ? 'Done' : 'Manage'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 230 + insets.bottom, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
        {units.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 8 }}>
            {units.map((u) => <UnitTile key={u.name} name={u.name} on={u.name === prop} onPress={() => s.openGallery(u.name)} />)}
          </ScrollView>
        ) : null}

        {photos.length && !manage ? (
          <View style={st.selRow}>
            <Text style={st.hint}>{sel.length ? sel.length + ' selected' : 'Tap photos to pick the ones to send'}</Text>
            <TouchableOpacity onPress={() => setSel(sel.length === photos.length ? [] : photos.map((p) => p.id))} hitSlop={8}>
              <Text style={st.link}>{sel.length === photos.length ? 'Clear' : 'Select all'}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={[st.grid, { gap }]}>
          {admin && (manage || !photos.length) ? (
            <TouchableOpacity style={[st.addTile, { width: tile, height: tile }]} onPress={add} disabled={!!busy} activeOpacity={0.7}>
              {busy ? <ActivityIndicator color={C.blue2} /> : <Text style={st.addPlus}>+</Text>}
              <Text style={st.addT}>{busy ? 'Uploading…' : 'Add photos'}</Text>
            </TouchableOpacity>
          ) : null}
          {photos.map((p) => {
            const on = sel.indexOf(p.id) >= 0;
            return (
              <TouchableOpacity key={p.id} activeOpacity={0.85}
                onPress={() => (manage ? setView(p.id) : toggle(p.id))}
                onLongPress={() => setView(p.id)}
                accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                <Image source={{ uri: api.attachmentUrl(s.pin, p.id) }} style={[{ width: tile, height: tile }, st.img, on && st.imgOn]} />
                {manage ? (
                  <TouchableOpacity style={st.del} onPress={() => remove(p.id)} hitSlop={6} accessibilityLabel="Remove photo">
                    <Text style={st.delT}>×</Text>
                  </TouchableOpacity>
                ) : (
                  <>
                    <View style={[st.tick, on && st.tickOn]}><Text style={st.tickT}>{on ? String(sel.indexOf(p.id) + 1) : ''}</Text></View>
                    <TouchableOpacity style={st.zoom} onPress={() => setView(p.id)} hitSlop={6} accessibilityLabel="View full size">
                      <Text style={st.zoomT}>⤢</Text>
                    </TouchableOpacity>
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        {busy ? <Text style={[st.hint, { marginTop: 10 }]}>{busy}</Text> : null}

        {!photos.length ? (
          <Text style={st.empty}>
            {admin ? 'No photos of Unit ' + no + ' yet. Add the listing photos once — then anyone can send them in seconds.'
              : 'No photos of Unit ' + no + ' yet. Ask an Admin to add them.'}
          </Text>
        ) : null}
      </ScrollView>

      {/* The send bar */}
      {photos.length && !manage ? (
        <View style={[st.bar, { paddingBottom: 12 + insets.bottom }]}>
          <TouchableOpacity style={[st.primary, !sel.length && st.primaryOff]} disabled={!sel.length} onPress={sharePhotos} activeOpacity={0.85}>
            <Text style={st.primaryT}>
              {!sel.length ? 'Pick photos to share'
                : Platform.OS === 'web' && !ready ? 'Preparing ' + sel.length + '…'
                : (Platform.OS === 'web' && !canShare ? 'Save ' : 'Share ') + sel.length + ' photo' + (sel.length === 1 ? '' : 's')}
            </Text>
            {sel.length ? <Text style={st.primaryS}>{Platform.OS === 'web' && !canShare ? 'then drop them into the WhatsApp chat' : 'pick WhatsApp, then the chat'}</Text> : null}
          </TouchableOpacity>
          <View style={st.orRow}><View style={st.rule} /><Text style={st.or}>or send the whole album as a link</Text><View style={st.rule} /></View>
          <View style={st.linkRow}>
            <TextInput value={phone} onChangeText={setPhone} placeholder="Guest mobile (optional)" placeholderTextColor={C.muted}
              keyboardType="phone-pad" style={st.input} />
            <TouchableOpacity style={st.wa} onPress={sendLink} activeOpacity={0.85}><Text style={st.waT}>WhatsApp link</Text></TouchableOpacity>
          </View>
          <TouchableOpacity onPress={copyLink} hitSlop={6} style={{ alignSelf: 'center' }}>
            <Text style={st.link}>{Platform.OS === 'web' ? 'Copy album link' : 'Share album link…'}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {view !== null ? (
        <TouchableOpacity activeOpacity={1} onPress={() => setView(null)} style={[StyleSheet.absoluteFill, st.viewer]}>
          <Image source={{ uri: api.attachmentUrl(s.pin, view) }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          <Text style={st.viewerT}>Tap anywhere to close</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: '#F7F3EC', zIndex: 50 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  back: { fontFamily: F.bold, fontSize: 30, color: C.ink, lineHeight: 32, paddingRight: 4 },
  h1: { fontFamily: F.xbold, fontSize: 20, color: C.ink, letterSpacing: -0.4 },
  sub: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 1 },
  link: { fontFamily: F.bold, fontSize: 13, color: C.blue2 },
  selRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, marginBottom: 10 },
  hint: { fontFamily: F.med, fontSize: 12.5, color: C.bark },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  img: { borderRadius: 10, backgroundColor: C.line },
  imgOn: { opacity: 0.82 },
  tick: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: G.gold2 },
  tickT: { color: '#fff', fontFamily: F.xbold, fontSize: 11 },
  zoom: { position: 'absolute', bottom: 6, right: 6, width: 24, height: 24, borderRadius: 7, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  zoomT: { color: '#fff', fontSize: 13, fontFamily: F.bold },
  del: { position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: 13, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  delT: { color: '#fff', fontSize: 17, lineHeight: 19, fontFamily: F.bold },
  addTile: { borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(185,128,54,0.5)', backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 2 },
  addPlus: { fontFamily: F.bold, fontSize: 26, color: C.blue2, lineHeight: 28 },
  addT: { fontFamily: F.semi, fontSize: 12, color: C.blue2 },
  empty: { fontFamily: F.med, fontSize: 13.5, color: C.bark, lineHeight: 20, marginTop: 14 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14, paddingTop: 12, gap: 9, backgroundColor: '#FFFDF9', borderTopWidth: 1, borderTopColor: C.line },
  primary: { backgroundColor: '#1F8F55', borderRadius: 14, paddingVertical: 11, alignItems: 'center' },
  primaryOff: { backgroundColor: '#C9C7BF' },
  primaryT: { fontFamily: F.xbold, fontSize: 15, color: '#fff' },
  primaryS: { fontFamily: F.med, fontSize: 11.5, color: 'rgba(255,255,255,0.85)', marginTop: 1 },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rule: { flex: 1, height: 1, backgroundColor: C.line },
  or: { fontFamily: F.semi, fontSize: 11, color: C.muted },
  linkRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontFamily: F.med, fontSize: 14, color: C.ink, backgroundColor: '#fff' },
  wa: { borderRadius: 12, borderWidth: 1.5, borderColor: '#1F8F55', paddingHorizontal: 14, justifyContent: 'center' },
  waT: { fontFamily: F.bold, fontSize: 13.5, color: '#1F8F55' },
  viewer: { backgroundColor: 'rgba(10,10,12,0.94)', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
  viewerT: { color: 'rgba(255,255,255,0.7)', fontFamily: F.med, fontSize: 12, marginTop: 12 },
});
