/* Full-screen hourly view of one calendar day.

   Opens by growing out of the tapped date cell: the card starts at the cell's
   exact rectangle, tipped back in 3D, and swings flat as it fills the tab —
   while the month grid behind it sinks away (see CalendarScreen's `depth`).
   Closing plays the same move in reverse, back into the cell.

   Rendered inside the Calendar tab rather than in a Modal on purpose: a
   Modal is a separate native window, and this screen already had to learn
   (CalendarScreen.editStay) what happens when one outlives a tab switch. */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing, SharedValue, interpolate, useAnimatedStyle, withSpring, withTiming,
} from 'react-native-reanimated';
import { C, F, G, inr } from '../theme';
import { fmtDayKey } from '../calendar';
import { Stay, addDays, dayKeyOf } from '../logic';

export type Rect = { x: number; y: number; w: number; h: number };
type Tone = { bg: string; line: string; fg: string; solid?: boolean; dim?: boolean };

const HOUR_H = 60;
const GUTTER = 58;
const NEXT_H = 150;   // room below 11 PM to scroll into the next day
const PREV_H = 150;   // and above 12 AM for the previous day

/* '10:30 AM' / '22:00' -> minutes after midnight, or null when not recorded. */
function minutesOf(t: string): number | null {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h * 60 + parseInt(m[2], 10);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtShort = (k: string) => Number(k.slice(8)) + ' ' + MON[Number(k.slice(5, 7)) - 1];
const hourLabel = (h: number) => (h === 0 ? '12 AM' : h < 12 ? h + ' AM' : h === 12 ? '12 PM' : h - 12 + ' PM');

/* One block per stay on this day, spanning check-in → check-out. A stay
   that began earlier starts at midnight; one that continues tomorrow runs to
   the end of the day. Times not recorded fall back to 2 PM in / 11 AM out and
   are labelled as such. */
type Blk = {
  stay: Stay; start: number; end: number;
  inHere: boolean; outHere: boolean; inGuess: boolean; outGuess: boolean;
};

export default function DayView({ dayKey, stays, from, area, progress, toneOf, onClose, onOpen, onDay, bare }: {
  dayKey: string;
  /* Inside the calendar's own header (title, arrows, views): no header here. */
  bare?: boolean;
  stays: Stay[];
  from: Rect;                      // the tapped cell, in this tab's coordinates
  area: { w: number; h: number };  // the tab's size
  progress: SharedValue<number>;   // 0 = cell, 1 = full screen (owned by the caller)
  toneOf: (x: Stay) => Tone;
  onClose: () => void;
  onOpen: (x: Stay) => void;
  onDay: (k: string) => void;
}) {
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [nowMin, setNowMin] = useState(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); });
  const isToday = dayKey === dayKeyOf(new Date());

  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()); }, 60000);
    return () => clearInterval(t);
  }, [isToday]);

  const { blocks, inHouse } = useMemo(() => {
    const out: Blk[] = [];
    stays.forEach((x) => {
      const inHere = x.inK === dayKey, outHere = x.outK === dayKey;
      if (!inHere && !outHere) return;
      const im = minutesOf(x.inT), om = minutesOf(x.outT);
      const start = inHere ? im ?? 14 * 60 : 0;
      let end = outHere ? om ?? 11 * 60 : 24 * 60;
      if (end <= start) end = Math.min(24 * 60, start + 60);   // bad or missing data: keep it visible
      out.push({ stay: x, start, end, inHere, outHere, inGuess: inHere && im === null, outGuess: outHere && om === null });
    });
    out.sort((a, b) => a.start - b.start || b.end - a.end);
    return { blocks: out, inHouse: stays.filter((x) => x.inK < dayKey && x.outK > dayKey) };
  }, [stays, dayKey]);

  /* The timeline scrolls on into the neighbouring days: past 11 PM into the
     next day (landing at its midnight), above 12 AM into the previous day
     (landing at its late evening, so scrolling up carries on through it). */
  const rolled = useRef<'next' | 'prev' | null>(null);
  const lastRoll = useRef(0);
  const viewH = useRef(600);
  const ready = useRef(false);          // ignore scroll events from our own positioning
  const onScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    viewH.current = layoutMeasurement.height;
    const max = contentSize.height - layoutMeasurement.height;
    if (!ready.current || max <= 0 || Date.now() - lastRoll.current < 900) return;
    if (contentOffset.y >= max - 6) {
      lastRoll.current = Date.now();
      rolled.current = 'next';
      onDay(addDays(dayKey, 1));
    } else if (contentOffset.y <= 6) {
      lastRoll.current = Date.now();
      rolled.current = 'prev';
      onDay(addDays(dayKey, -1));
    }
  };

  /* Land on the first thing that happens (or 8 AM, or now), not at midnight —
     unless we got here by scrolling on from a neighbouring day. */
  useEffect(() => {
    ready.current = false;
    const go = (y: number) => setTimeout(() => {
      scroller.current?.scrollTo({ y, animated: false });
      setTimeout(() => { ready.current = true; }, 250);
    }, 0);
    if (rolled.current) {
      const dir = rolled.current;
      rolled.current = null;
      const t0 = go(dir === 'next' ? PREV_H : Math.max(PREV_H + 1, PREV_H + 24 * HOUR_H + 24 - viewH.current));
      return () => clearTimeout(t0);
    }
    const first = blocks.find((b) => b.inHere) || blocks.find((b) => b.outHere);
    const target = isToday ? nowMin - 90 : first ? (first.inHere ? first.start : first.end) - 60 : 8 * 60;
    const y = PREV_H + Math.max(0, (target / 60) * HOUR_H);
    const t = go(y);
    return () => clearTimeout(t);
  }, [dayKey]);

  /* Overlapping stays sit side by side: greedy columns, then each block is
     as wide as the busiest overlap it is part of allows. */
  const placed = useMemo(() => {
    const colEnd: number[] = [];
    const withCol = blocks.map((b) => {
      let c = colEnd.findIndex((e) => e <= b.start);
      if (c < 0) { c = colEnd.length; colEnd.push(0); }
      colEnd[c] = b.end;
      return { ...b, col: c };
    });
    return withCol.map((b) => ({
      ...b,
      ncol: Math.max(1, ...withCol.filter((o) => o.start < b.end && o.end > b.start).map((o) => o.col + 1)),
    }));
  }, [blocks]);

  const arriving = blocks.filter((b) => b.inHere);
  const net = arriving.reduce((a, b) => a + b.stay.net, 0);
  const pending = arriving.reduce((a, b) => a + b.stay.pending, 0);

  const card = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [from.x, 0]),
      top: interpolate(p, [0, 1], [from.y, 0]),
      width: interpolate(p, [0, 1], [from.w, area.w]),
      height: interpolate(p, [0, 1], [from.h, area.h]),
      borderRadius: interpolate(p, [0, 1], [10, 0]),
      opacity: interpolate(p, [0, 0.12], [0, 1], 'clamp'),
      /* flat once open — a resting 3D transform blurs text on the web; on
         phones the grow stays flat throughout (iOS depth-sorts 3D layers). */
      transform: p > 0.999 || Platform.OS !== 'web' ? [] : [
        { perspective: 1100 },
        { rotateX: interpolate(p, [0, 0.55, 1], [28, 9, 0]) + 'deg' },
        { rotateY: interpolate(p, [0, 0.55, 1], [(from.x + from.w / 2 < area.w / 2 ? -1 : 1) * 22, 5, 0]) + 'deg' },
      ],
    };
  });
  const content = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.55, 0.95], [0, 1], 'clamp'),
    transform: [{ translateY: interpolate(progress.value, [0.55, 1], [16, 0], 'clamp') }],
  }));
  const ghost = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.5], [1, 0], 'clamp') }));

  const [y, mo, d] = dayKey.split('-').map(Number);
  const nk = addDays(dayKey, 1);
  const nd = new Date(Number(nk.slice(0, 4)), Number(nk.slice(5, 7)) - 1, Number(nk.slice(8)));
  const pk = addDays(dayKey, -1);
  const pd = new Date(Number(pk.slice(0, 4)), Number(pk.slice(5, 7)) - 1, Number(pk.slice(8)));
  const prevLabel = pd.toLocaleDateString('en-IN', { weekday: 'long' }) + ' · ' + fmtDayKey(pk);
  const nextLabel = nd.toLocaleDateString('en-IN', { weekday: 'long' }) + ' · ' + fmtDayKey(nk);
  const wk = new Date(y, mo - 1, d).toLocaleDateString('en-IN', { weekday: 'long' });

  return (
    <Animated.View style={[st.card, card]}>
      {/* while small, the card still reads as the cell it came from */}
      <Animated.View style={[st.ghost, ghost]} pointerEvents="none">
        <Text style={st.ghostTxt}>{d}</Text>
      </Animated.View>

      <Animated.View style={[{ flex: 1 }, content]}>
        {!bare ? <View style={st.head}>
          <TouchableOpacity onPress={onClose} style={st.back} hitSlop={10} accessibilityLabel="Back to month">
            <Text style={st.backTxt}>‹</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={st.wk}>{wk}{isToday ? ' · Today' : ''}</Text>
            <Text style={st.title}>{fmtDayKey(dayKey)}</Text>
          </View>
          <TouchableOpacity onPress={() => onDay(addDays(dayKey, -1))} style={st.nav} accessibilityLabel="Previous day">
            <Text style={st.navTxt}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => onDay(addDays(dayKey, 1))} style={st.nav} accessibilityLabel="Next day">
            <Text style={st.navTxt}>›</Text>
          </TouchableOpacity>
        </View> : null}

        <View style={st.chips}>
          <Chip n={arriving.length} label="arriving" color={C.green} />
          <Chip n={blocks.filter((b) => b.outHere).length} label="leaving" color={G.gold2} />
          <Chip n={inHouse.length} label="staying" color={C.sky} />
          {net ? <Text style={st.money}>{inr(net)}{pending ? '  ·  ' + inr(pending) + ' due' : ''}</Text> : null}
        </View>

        {inHouse.length ? (
          <View style={st.allDay}>
            <Text style={st.allDayLbl}>ALL DAY</Text>
            <View style={{ flex: 1, gap: 4 }}>
              {inHouse.map((x) => {
                const tone = toneOf(x);
                return (
                  <TouchableOpacity key={x.row} onPress={() => onOpen(x)} activeOpacity={0.7}
                    style={[st.allDayBar, { backgroundColor: tone.bg, borderColor: tone.line }]}>
                    <Text style={[st.evTitle, { color: tone.fg }]} numberOfLines={1}>
                      {x.guest || x.id} · staying{x.unit ? ' · ' + x.unit : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ height: PREV_H + 24 * HOUR_H + 24 + NEXT_H }}
          onScroll={onScroll} scrollEventThrottle={32}>
          {Array.from({ length: 24 }, (_, h) => (
            <View key={h} style={[st.hourRow, { top: PREV_H + h * HOUR_H }]}>
              <Text style={st.hourLbl}>{hourLabel(h)}</Text>
              <View style={st.hourLine} />
            </View>
          ))}

          {placed.map((b) => {
            const tone = toneOf(b.stay);
            const top = PREV_H + (b.start / 60) * HOUR_H;
            const height = Math.max(46, ((b.end - b.start) / 60) * HOUR_H - 3);
            const w = `${100 / b.ncol}%` as `${number}%`;
            const left = `${(100 / b.ncol) * b.col}%` as `${number}%`;
            const inTxt = b.inHere ? (b.inGuess ? 'in · time not set' : 'In ' + b.stay.inT) : 'Arrived ' + fmtShort(b.stay.inK);
            const outTxt = b.outHere ? (b.outGuess ? 'out · time not set' : 'Out ' + b.stay.outT) : 'Leaves ' + fmtShort(b.stay.outK);
            const tall = height >= 70;
            return (
              <View key={b.stay.row} style={[st.evLane, { top, height }]}>
                <TouchableOpacity
                  onPress={() => onOpen(b.stay)} activeOpacity={0.75}
                  style={[st.ev, {
                    width: w, left, backgroundColor: tone.bg, borderColor: tone.line,
                    borderTopWidth: b.inHere ? 3 : 0, borderBottomWidth: b.outHere ? 3 : 0,
                    borderTopLeftRadius: b.inHere ? 10 : 0, borderTopRightRadius: b.inHere ? 10 : 0,
                    borderBottomLeftRadius: b.outHere ? 10 : 0, borderBottomRightRadius: b.outHere ? 10 : 0,
                  }]}
                >
                  <Text style={[st.evKind, { color: tone.solid ? 'rgba(255,255,255,0.9)' : b.inHere ? C.green : C.bark }]} numberOfLines={1}>
                    {b.inHere ? '▲ ' : '↑ '}{inTxt}
                  </Text>
                  <Text style={[st.evTitle, { color: tone.fg }]} numberOfLines={1}>{b.stay.guest || b.stay.id}</Text>
                  {tall ? (
                    <Text style={[st.evSub, tone.solid && { color: 'rgba(255,255,255,0.8)' }]} numberOfLines={2}>
                      {[b.stay.unit || b.stay.prop, b.stay.sameDay ? 'day use' : b.stay.nights + ' night' + (b.stay.nights === 1 ? '' : 's'), inr(b.stay.net)]
                        .filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <Text style={[st.evKind, { color: tone.solid ? 'rgba(255,255,255,0.9)' : b.outHere ? G.gold3 : C.bark }]} numberOfLines={1}>
                    {b.outHere ? '▼ ' : '↓ '}{outTxt}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}

          {isToday ? (
            <View style={[st.now, { top: PREV_H + (nowMin / 60) * HOUR_H }]} pointerEvents="none">
              <View style={st.nowDot} />
              <View style={st.nowLine} />
            </View>
          ) : null}

          {/* scroll up → the previous day */}
          <View style={[st.nextWrap, { top: 12 }]}>
            <TouchableOpacity style={st.nextCard} activeOpacity={0.75}
              onPress={() => { rolled.current = 'prev'; onDay(addDays(dayKey, -1)); }}>
              <Text style={st.nextHint}>Keep scrolling ↑</Text>
              <Text style={st.nextDay}>{prevLabel}</Text>
              <Text style={st.nextLbl}>PREVIOUS DAY</Text>
            </TouchableOpacity>
          </View>

          {/* keep scrolling → the next day */}
          <View style={[st.nextWrap, { top: PREV_H + 24 * HOUR_H + 20 }]}>
            <TouchableOpacity style={st.nextCard} activeOpacity={0.75}
              onPress={() => { rolled.current = 'next'; onDay(addDays(dayKey, 1)); }}>
              <Text style={st.nextLbl}>NEXT DAY</Text>
              <Text style={st.nextDay}>{nextLabel}</Text>
              <Text style={st.nextHint}>Keep scrolling ↓</Text>
            </TouchableOpacity>
          </View>

          {!blocks.length && !inHouse.length ? (
            <View style={[st.emptyWrap, { top: PREV_H + 8 * HOUR_H }]}>
              <Text style={st.empty}>Nothing booked — the flat is free this day.</Text>
            </View>
          ) : null}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
}

function Chip({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={[st.chip, !n && { opacity: 0.45 }]}>
      <View style={[st.chipDot, { backgroundColor: color }]} />
      <Text style={st.chipTxt}>{n} {label}</Text>
    </View>
  );
}

/* Drives `progress` for open/close. Kept here so the timing lives with the view. */
export function openDay(progress: SharedValue<number>) {
  progress.value = 0;
  progress.value = withSpring(1, { damping: 20, stiffness: 170, mass: 0.9 });
}
export function closeDay(progress: SharedValue<number>, done: () => void) {
  progress.value = withTiming(0, { duration: 340, easing: Easing.inOut(Easing.cubic) });
  setTimeout(done, 350);
}

const st = StyleSheet.create({
  card: {
    position: 'absolute', overflow: 'hidden', backgroundColor: '#FFFCF8',
    shadowColor: G.shadow, shadowOpacity: 0.25, shadowRadius: 30, shadowOffset: { width: 0, height: 16 }, elevation: 20,
    zIndex: 50,
  },
  ghost: { position: 'absolute', top: 4, left: 6 },
  ghostTxt: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(90,58,20,0.07)', alignItems: 'center', justifyContent: 'center' },
  backTxt: { fontSize: 26, lineHeight: 28, color: C.ink, fontFamily: F.bold },
  wk: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.3, textTransform: 'uppercase', color: G.gold2 },
  title: { fontFamily: F.xbold, fontSize: 24, letterSpacing: -0.6, color: C.ink },
  nav: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  navTxt: { fontSize: 20, lineHeight: 22, color: C.bark, fontFamily: F.bold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#fff', borderWidth: 1, borderColor: C.hair },
  chipDot: { width: 7, height: 7, borderRadius: 4 },
  chipTxt: { fontFamily: F.semi, fontSize: 12, color: C.ink },
  money: { fontFamily: F.bold, fontSize: 12.5, color: C.green, marginLeft: 4 },
  allDay: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.hair, backgroundColor: 'rgba(233,185,110,0.06)' },
  allDayLbl: { width: GUTTER - 14, fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.8, color: C.muted, paddingTop: 5 },
  allDayBar: { borderWidth: 1, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 },
  hourRow: { position: 'absolute', left: 0, right: 0, height: HOUR_H, flexDirection: 'row' },
  hourLbl: { width: GUTTER, textAlign: 'right', paddingRight: 8, marginTop: -7, fontFamily: F.med, fontSize: 10.5, color: C.muted },
  hourLine: { flex: 1, height: 1, backgroundColor: C.hair, marginRight: 10 },
  evLane: { position: 'absolute', left: GUTTER + 4, right: 12 },
  ev: {
    position: 'absolute', top: 1, bottom: 0, borderLeftWidth: 4, paddingHorizontal: 9, paddingVertical: 5, marginRight: 3,
    shadowColor: G.shadow, shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  evKind: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.6 },
  evTitle: { fontFamily: F.bold, fontSize: 13.5 },
  evSub: { fontFamily: F.med, fontSize: 11, color: C.bark },
  now: { position: 'absolute', left: GUTTER - 5, right: 10, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.red },
  nowLine: { flex: 1, height: 2, backgroundColor: C.red },
  nextWrap: { position: 'absolute', left: GUTTER, right: 12, height: NEXT_H - 24, justifyContent: 'center' },
  nextCard: {
    borderRadius: 16, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(185,128,54,0.45)',
    backgroundColor: 'rgba(233,185,110,0.08)', paddingVertical: 14, alignItems: 'center',
  },
  nextLbl: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.2, color: G.gold2 },
  nextDay: { fontFamily: F.xbold, fontSize: 16, color: C.ink, marginTop: 2 },
  nextHint: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 3 },
  emptyWrap: { position: 'absolute', left: GUTTER, right: 12, alignItems: 'center' },
  empty: { fontFamily: F.med, color: C.muted, fontSize: 13, backgroundColor: '#FFFCF8', paddingHorizontal: 8 },
});
