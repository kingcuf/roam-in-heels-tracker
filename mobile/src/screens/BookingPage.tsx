import React, { useEffect, useMemo, useState } from 'react';
import {
  BackHandler, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity,
  useWindowDimensions, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, G, inr } from '../theme';
import { useStore } from '../store';
import { api } from '../api';
import { Btn } from '../ui';
import { BookingChecklist } from '../checklist';
import {
  ageFrom, bannerUnitOf, cardOf, checklistFor, ciFmtDay, ciNum, ciParse, idSlotsOf, IdSlot, parseExtraGuests,
  reviewStatusOf, splitOf, stayPhase, StayPhase, stayPropOf,
} from '../logic';
import { coverFor } from '../unitCovers';

/* ── The booking page ──────────────────────────────────────────────────────
   One full-screen page for a booking, opened from every place a booking is
   tapped (Action cards, Calendar, Booking log, Report day list).

   Built around the two questions a manager opens a booking with:
     1. "Which flat, who, and when?" — answered before any scrolling: the
        flat's photo with its unit number, where the stay is today (arriving,
        in-house, leaving), the guest, and the check-in → check-out strip.
     2. "What's left to do?" — the Checklist tab, with its progress on the tab
        itself so it can be read without switching.
   Everything else (contact, IDs, money, notes) sits under Details, grouped
   the way it is used rather than in column order.

   A plain full-screen view rather than a Modal: bottom sheets (ID upload,
   confirm dialogs) are Modals and must be able to open on top of it. */

const PHASE_TONE: Record<StayPhase, { bg: string; fg: string }> = {
  none: { bg: 'rgba(255,255,255,0.85)', fg: C.bark },
  upcoming: { bg: 'rgba(255,255,255,0.9)', fg: C.ink },
  arriving: { bg: G.gold1, fg: '#2A1A06' },
  inhouse: { bg: '#E7F2EC', fg: C.green },
  leaving: { bg: G.gold1, fg: '#2A1A06' },
  past: { bg: 'rgba(255,255,255,0.8)', fg: C.bark },
};
const REVIEW_LABEL = { pending: 'Not asked yet', requested: 'Asked — waiting', received: 'Received', skipped: 'Skipped' };
const OUT_MS = 220;

export default function BookingPage() {
  const s = useStore();
  const page = s.bookingPage;
  /* Keep the last booking on screen while the page slides out. */
  const [shown, setShown] = useState(page);
  const { width } = useWindowDimensions();
  const x = useSharedValue(width);

  useEffect(() => {
    if (page) {
      setShown(page);
      x.value = width;
      x.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
      return;
    }
    if (!shown) return;
    x.value = withTiming(width, { duration: OUT_MS, easing: Easing.in(Easing.cubic) });
    const t = setTimeout(() => setShown(null), OUT_MS + 10);
    return () => clearTimeout(t);
  }, [page]);

  const close = () => {
    const back = page?.onBack;
    s.closeBooking();
    if (back) setTimeout(back, OUT_MS);
  };

  /* Android back and Escape on the web both close the page. */
  useEffect(() => {
    if (!page) return;
    if (Platform.OS === 'web') {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !s.idTarget) close(); };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { close(); return true; });
    return () => sub.remove();
  }, [page, s.idTarget]);

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  if (!shown) return null;
  return (
    <Reanimated.View style={[StyleSheet.absoluteFill, st.page, slide]}>
      <PageBody row={shown.row} onClose={close} />
    </Reanimated.View>
  );
}

function PageBody({ row, onClose }: { row: number; onClose: () => void }) {
  const s = useStore();
  const insets = useSafeAreaInsets();
  const { width: pageW } = useWindowDimensions();
  const [tab, setTab] = useState<'details' | 'checklist'>('details');
  useEffect(() => { setTab('details'); }, [row]);

  const o = (s.logs?.bookings?.rows || []).find((y) => y.r === row) || null;
  const entries = useMemo(
    () => (o ? checklistFor(o, s.logs?.checklist, s.idMap as any) : []),
    [o, s.logs?.checklist, s.idMap],
  );

  if (!o) {
    return (
      <View style={[st.missing, { paddingTop: insets.top + 60 }]}>
        <Text style={st.missingT}>This booking is no longer in the log.</Text>
        <Btn title="Go back" kind="ghost" onPress={onClose} style={{ marginTop: 14 }} />
      </View>
    );
  }

  const c = o.cells;
  const b = cardOf(o);
  const unit = bannerUnitOf(c);
  const cover = coverFor(unit);
  const stayProp = stayPropOf(c);
  const split = splitOf(c);
  const status = stayPhase(b.inD, b.outD);
  const tone = PHASE_TONE[status.phase];
  const doneN = entries.filter((e) => e.done).length;

  const canChange = s.can('booking.update') || s.can('booking.delete');
  const edit = () => {
    s.closeBooking();
    s.setEditB({ row, bookingId: b.id, from: 'blog', cells: c });
    s.setAddSeg('book');
    s.setTab('add');
  };
  const editLabel = s.needsApproval ? 'Request a change' : 'Edit booking';

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      stickyHeaderIndices={[2]}
      showsVerticalScrollIndicator={false}
    >
      {/* 0 ── banner */}
      <View style={[st.banner, { height: 250 + insets.top }]}>
        {cover ? (
          /* The listing photos are portrait (3:4) and the room sits in their
             lower half; a plain centre crop showed mostly ceiling. Lay the photo
             out at full width and slide it up so the bed and windows land in
             the banner. */
          <Image
            source={cover} resizeMode="cover" accessibilityIgnoresInvertColors
            style={{ position: 'absolute', left: 0, width: pageW, height: pageW * 4 / 3,
              top: -Math.max(0, pageW * 4 / 3 - (250 + insets.top)) * 0.62 }}
          />
        ) : (
          <LinearGradient colors={['#2A2118', '#14110D']} style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient
          colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0.72)']}
          locations={[0, 0.3, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={[st.bannerTop, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={onClose} style={st.round} activeOpacity={0.7} accessibilityLabel="Back" hitSlop={8}>
            <Text style={st.roundTxt}>‹</Text>
          </TouchableOpacity>
          {canChange ? (
            <TouchableOpacity onPress={edit} style={st.editPill} activeOpacity={0.75} accessibilityRole="button">
              <Text style={st.editPillTxt}>{s.needsApproval ? 'Request change' : 'Edit'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        <View style={st.bannerFoot}>
          <View style={[st.phase, { backgroundColor: tone.bg }]}>
            <Text style={[st.phaseTxt, { color: tone.fg }]}>{status.label}</Text>
          </View>
          <Text style={st.unitLbl}>UNIT</Text>
          <Text style={st.unitNo} numberOfLines={1}>{unit || '—'}</Text>
          <Text style={st.unitSub} numberOfLines={1}>
            {[stayProp, b.channel].filter(Boolean).join('  ·  ')}
          </Text>
        </View>
      </View>

      {/* 1 ── who & when */}
      <View style={st.summary}>
        <View style={st.sumHead}>
          <Avatar name={b.guest} docId={leadDoc(s.idDocs?.[String(row)])} pin={s.pin} />
          <View style={{ flex: 1 }}>
            <Text style={st.guest} numberOfLines={1}>{b.guest || 'Guest'}</Text>
            <Text style={st.guestSub} numberOfLines={1}>
              {[b.guests ? b.guests + ' guest' + (b.guests === 1 ? '' : 's') : '', b.id ? '#' + b.id : '']
                .filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        </View>
        <View style={st.strip}>
          <End label="CHECK-IN" d={b.inD} t={b.inT} on={status.phase === 'arriving' || status.phase === 'upcoming'} />
          <View style={st.nights}>
            <Text style={st.nightsN}>{b.nights === null ? '—' : b.nights === 0 ? 'Day' : b.nights}</Text>
            <Text style={st.nightsL}>{b.nights === 0 ? 'use' : b.nights === 1 ? 'night' : 'nights'}</Text>
          </View>
          <End label="CHECK-OUT" d={b.outD} t={b.outT} on={status.phase === 'leaving' || status.phase === 'inhouse'} right />
        </View>
      </View>

      {/* 2 ── tabs (sticky) */}
      <View style={st.tabsWrap}>
        <View style={st.tabs}>
          <TabBtn label="Details" on={tab === 'details'} onPress={() => setTab('details')} />
          <TabBtn
            label="Checklist" on={tab === 'checklist'} onPress={() => setTab('checklist')}
            badge={entries.length ? doneN + '/' + entries.length : undefined}
            complete={!!entries.length && doneN === entries.length}
          />
        </View>
      </View>

      {/* 3 ── tab content */}
      <View style={st.body}>
        {tab === 'details' ? (
          <Details row={row} c={c} b={b} stayProp={stayProp} split={split} unit={unit} />
        ) : (
          <View style={st.card}>
            <BookingChecklist row={row} bare />
          </View>
        )}
        {canChange && tab === 'details' ? (
          <Btn title={editLabel} onPress={edit} style={{ marginTop: 18 }} />
        ) : null}
      </View>
    </ScrollView>
  );
}

/* ── Details tab ── */
function Details({ row, c, b, stayProp, split, unit }: {
  row: number; c: any[]; b: ReturnType<typeof cardOf>; stayProp: string;
  split: ReturnType<typeof splitOf>; unit: string;
}) {
  const s = useStore();
  const phone = String(c[13] ?? '').trim();
  const extras = parseExtraGuests(c[27]).filter((g) => g.name.trim());
  const slots = idSlotsOf(c);
  const have = (s.idMap?.[String(row)] || []) as IdSlot[];
  const missing = slots.filter((sl) => have.indexOf(sl) < 0);
  const review = reviewStatusOf(c);
  const discount = ciNum(c[7]), commission = ciNum(c[10]);

  const uploadIds = () => s.setIdTarget({
    row, id: b.id, prop: b.prop, guest: b.guest, coGuest: b.coGuest,
    ci: b.inD, expected: slots.length, have: slots.length - missing.length, missing,
    guests: b.guests, coNamed: !!b.coGuest.trim(), card: b,
  });

  return (
    <View style={{ gap: 14 }}>
      <Section title="Guests">
        <Person name={b.guest || 'Lead guest'} role="Lead guest" age={ageFrom(c[14])} />
        {phone ? <PhoneRow phone={phone} /> : null}
        {b.coGuest ? <Person name={b.coGuest} role="Co-guest" age={ageFrom(c[16])} /> : null}
        {extras.map((g, i) => <Person key={i} name={g.name} role={'Guest ' + (i + 3)} age={ageFrom(g.birthYr)} />)}
        <View style={st.idRow}>
          <View style={{ flex: 1 }}>
            <Text style={st.lbl}>IDs on file</Text>
            <Text style={[st.idVal, { color: missing.length ? C.red : C.green }]}>
              {missing.length ? (slots.length - missing.length) + ' of ' + slots.length + ' uploaded' : 'All ' + slots.length + ' uploaded'}
            </Text>
          </View>
          <Btn kind="mini" title={missing.length ? 'Upload IDs' : 'View IDs'} onPress={uploadIds} />
        </View>
      </Section>

      <Section title="Stay">
        <Row label="Check-in" value={b.inD ? ciFmtDay(b.inD) + ' ' + b.inD.getFullYear() + (b.inT ? ' · ' + b.inT : '') : 'Not recorded'} />
        <Row label="Check-out" value={b.outD ? ciFmtDay(b.outD) + ' ' + b.outD.getFullYear() + (b.outT ? ' · ' + b.outT : '') : 'Not recorded'} />
        <Row label="Nights" value={b.nights === null ? '' : b.nights === 0 ? 'Day use' : String(b.nights)} />
        <Row label="Stay unit" value={unit} />
        {/* Booked under one flat, slept in another: both matter. */}
        {split || (b.prop && stayProp && b.prop !== stayProp)
          ? <Row label="Booked under" value={b.prop} tone={C.blue2} />
          : <Row label="Property" value={stayProp} />}
      </Section>

      <Section title="Booking">
        <Row label="Booking ID" value={b.id} selectable />
        <Row label="Booked on" value={ciParse(b.bookedOn) ? ciFmtDay(ciParse(b.bookedOn) as Date) + ' ' + (ciParse(b.bookedOn) as Date).getFullYear() : ''} />
        <Row label="Channel" value={b.channel} />
        <Row label="Type" value={b.type} />
        {b.referrer ? <Row label={b.type === 'Resold' ? 'Resold to' : 'Source'} value={b.referrer} /> : null}
        <Row label="Review" value={REVIEW_LABEL[review]} tone={review === 'received' ? C.green : review === 'pending' ? C.muted : undefined} />
      </Section>

      <Section title="Payment">
        {b.listPrice ? <Row label="List price" value={inr(b.listPrice)} /> : null}
        {discount ? <Row label="Discount" value={'− ' + inr(discount)} /> : null}
        <Row label="Guest paid" value={b.paid ? inr(b.paid) : ''} />
        {commission ? <Row label="Commission" value={'− ' + inr(commission)} /> : null}
        {split ? <Row label="Split fee" value={inr(split.fee)} /> : null}
        <Row label="Net earned" value={inr(b.net)} tone={C.green} strong />
        <Row label="Awaiting payout" value={b.pending > 0 ? inr(b.pending) : 'Nothing due'} tone={b.pending > 0 ? C.red : C.muted} />
      </Section>

      {b.notes ? (
        <Section title="Notes">
          <Text style={st.notes} selectable>{b.notes}</Text>
        </Section>
      ) : null}
    </View>
  );
}

/* ── pieces ── */
function End({ label, d, t, on, right }: { label: string; d: Date | null; t: string; on: boolean; right?: boolean }) {
  const wd = d ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] : '';
  return (
    <View style={[{ flex: 1 }, right && { alignItems: 'flex-end' }]}>
      <Text style={[st.endLbl, on && { color: C.blue2 }]}>{label}</Text>
      <Text style={st.endDate}>{d ? ciFmtDay(d) : '—'}</Text>
      <Text style={st.endSub}>{d ? wd + (t ? ' · ' + t : '') : 'not recorded'}</Text>
    </View>
  );
}

function TabBtn({ label, on, onPress, badge, complete }: {
  label: string; on: boolean; onPress: () => void; badge?: string; complete?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={[st.tab, on && st.tabOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Text style={[st.tabTxt, on && st.tabTxtOn]}>{label}</Text>
      {badge ? (
        <View style={[st.badge, complete && { backgroundColor: C.greenbg }]}>
          <Text style={[st.badgeTxt, complete && { color: C.green }]}>{complete ? '✓ ' + badge : badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={st.card}>
      <Text style={st.secT}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, tone, strong, selectable }: {
  label: string; value: string; tone?: string; strong?: boolean; selectable?: boolean;
}) {
  return (
    <View style={st.row}>
      <Text style={st.lbl}>{label}</Text>
      <Text style={[st.val, strong && st.valStrong, tone ? { color: tone } : null]} selectable={selectable}>{value || '—'}</Text>
    </View>
  );
}

function Person({ name, role, age }: { name: string; role: string; age: string }) {
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <Text style={st.person} numberOfLines={1}>{name}</Text>
        <Text style={st.personSub}>{role + (age ? ' · ' + age + ' yrs' : '')}</Text>
      </View>
    </View>
  );
}

function PhoneRow({ phone }: { phone: string }) {
  const digits = phone.replace(/[^\d+]/g, '');
  const bare = digits.replace(/^\+/, '');
  const wa = bare.length === 10 ? '91' + bare : bare;   // a 10-digit number is Indian
  return (
    <View style={st.row}>
      <View style={{ flex: 1 }}>
        <Text style={st.lbl}>Phone</Text>
        <Text style={st.phone} selectable>{phone}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity style={st.act} onPress={() => Linking.openURL('tel:' + digits)} activeOpacity={0.7}>
          <Text style={st.actTxt}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.act, st.actWa]} onPress={() => Linking.openURL('https://wa.me/' + wa)} activeOpacity={0.7}>
          <Text style={[st.actTxt, { color: '#fff' }]}>WhatsApp</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* The lead guest's ID front as the face of the booking — same rule as the
   Action cards: lead, else co-guest, never a PDF. */
function leadDoc(docs?: { id: number; slot: string; type: string }[]) {
  const d = docs || [];
  const pick = d.find((x) => x.slot === 'lead') || d.find((x) => x.slot === 'co');
  return pick && !/pdf/i.test(pick.type || '') ? pick.id : undefined;
}
function Avatar({ name, docId, pin }: { name: string; docId?: number; pin: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [docId]);
  if (docId && !failed) {
    return <Image source={{ uri: api.attachmentUrl(pin, docId) }} style={st.avatar} onError={() => setFailed(true)} />;
  }
  return (
    <View style={[st.avatar, st.avatarBlank]}>
      <Text style={st.avatarTxt}>{(name || '?').trim().slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  page: { backgroundColor: G.bgMid, zIndex: 50 },
  missing: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  missingT: { fontFamily: F.semi, fontSize: 15, color: C.bark, textAlign: 'center' },

  banner: { overflow: 'hidden', backgroundColor: '#1a1612', justifyContent: 'space-between' },
  bannerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  round: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
  roundTxt: { fontFamily: F.bold, fontSize: 26, color: C.ink, marginTop: -3, marginLeft: -2 },
  editPill: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingVertical: 9, paddingHorizontal: 16 },
  editPillTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  bannerFoot: { paddingHorizontal: 18, paddingBottom: 44 },
  phase: { alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, marginBottom: 10 },
  phaseTxt: { fontFamily: F.bold, fontSize: 11.5, letterSpacing: 0.2 },
  unitLbl: { fontFamily: F.bold, fontSize: 10.5, color: 'rgba(255,255,255,0.75)', letterSpacing: 2 },
  unitNo: { fontFamily: F.xbold, fontSize: 52, lineHeight: 58, color: '#fff', letterSpacing: -1 },
  unitSub: { fontFamily: F.semi, fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: 2 },

  summary: {
    marginHorizontal: 14, marginTop: -28, backgroundColor: C.card, borderRadius: 22, padding: 16,
    shadowColor: G.shadow, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  sumHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  guest: { fontFamily: F.xbold, fontSize: 19, color: C.ink },
  guestSub: { fontFamily: F.med, fontSize: 12.5, color: C.muted, marginTop: 2 },
  strip: {
    flexDirection: 'row', alignItems: 'center', marginTop: 14, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: C.hair,
  },
  endLbl: { fontFamily: F.bold, fontSize: 10, color: C.muted, letterSpacing: 1.1 },
  endDate: { fontFamily: F.xbold, fontSize: 20, color: C.ink, marginTop: 3 },
  endSub: { fontFamily: F.med, fontSize: 12, color: C.bark, marginTop: 1 },
  nights: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.amberbg, borderRadius: 14,
    paddingVertical: 7, paddingHorizontal: 12, marginHorizontal: 8,
  },
  nightsN: { fontFamily: F.xbold, fontSize: 16, color: C.blue2 },
  nightsL: { fontFamily: F.semi, fontSize: 10, color: C.blue2 },

  tabsWrap: { backgroundColor: G.bgMid, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  tabs: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11 },
  tabOn: { backgroundColor: C.navy },
  tabTxt: { fontFamily: F.bold, fontSize: 13.5, color: C.bark },
  tabTxtOn: { color: '#fff' },
  badge: { backgroundColor: C.amberbg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  badgeTxt: { fontFamily: F.bold, fontSize: 11, color: C.blue2 },

  body: { paddingHorizontal: 14, paddingTop: 6 },
  card: { backgroundColor: C.card, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12 },
  secT: { fontFamily: F.bold, fontSize: 11, color: C.blue2, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 2 },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.hair,
  },
  lbl: { fontFamily: F.med, fontSize: 12.5, color: C.muted },
  val: { fontFamily: F.bold, fontSize: 14, color: C.ink, flexShrink: 1, textAlign: 'right' },
  valStrong: { fontFamily: F.xbold, fontSize: 16 },
  person: { fontFamily: F.bold, fontSize: 15, color: C.ink },
  personSub: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 1 },
  phone: { fontFamily: F.bold, fontSize: 14.5, color: C.ink, marginTop: 2 },
  act: { borderRadius: 10, borderWidth: 1, borderColor: C.line, paddingVertical: 7, paddingHorizontal: 12, backgroundColor: C.warm2 },
  actWa: { backgroundColor: '#2F7D57', borderColor: '#2F7D57' },
  actTxt: { fontFamily: F.bold, fontSize: 12.5, color: C.ink },
  idRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 12 },
  idVal: { fontFamily: F.bold, fontSize: 14, marginTop: 2 },
  notes: { fontFamily: F.med, fontSize: 14, color: C.ink, lineHeight: 20, paddingVertical: 8 },

  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarBlank: { backgroundColor: C.amberbg, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: F.xbold, fontSize: 18, color: C.blue2 },
});
