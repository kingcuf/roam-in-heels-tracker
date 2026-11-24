import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, G, inr } from '../theme';
import { useStore } from '../store';
import { addMonth, monthTitle } from '../calendar';
import { Stay, addDays, computeStays, keyToDate, nightsInRange, thisMonthIso, todayIso, unitNumberOf } from '../logic';
import { unitNo } from '../propertyPicker';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import DayView, { Rect, closeDay, openDay as playOpen } from './DayView';

/* The Calendar tab: who is in which flat, and when.

   Built on STAY dates (check-in → check-out), never the booking date. The
   money calendar on the Dashboard answers "what did we earn that day"; this
   one answers "is 3028 free on Friday" and "how full was each unit".

   Four views, the way Google Calendar has them, each answering one question:
     Schedule  what happens next: arrivals and departures, day by day
     Day       one day by the hour: turnarounds, check-in and check-out times
     Week      one row per unit across seven days: where the gaps are
     Month     the wall planner, plus how full each unit was that month

   One visual language for time, in every view:
     in house now   solid unit colour, white text, a live dot
     upcoming       pale unit tint with a coloured edge
     past           faded grey: context, not something to act on
     money due      a small red dot on the bar; the bar keeps its unit colour

   A bar's ends sit where the check-in and check-out times say, so a 10:30am
   departure and a 2pm arrival on the same day share the cell without
   colliding. With no time recorded the end falls at midday. */

type CalView = 'schedule' | 'day' | 'week' | 'month';
const VIEWS: { key: CalView; label: string }[] = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* Bars a month week shows before "+N"; tapping "+N" opens the week up. */
const MAX_LANES = 3;
const CELL_MIN_H = 88;
const DATE_H = 24;
const BAR_H = 17;
const BAR_GAP = 3;
const EDGE = 0.1;
/* Week timeline */
const LABEL_W = 68;
const WBAR_H = 24;

const LANE_COLORS = [
  { bg: '#E4EDE9', line: '#2E5E4E', fg: '#204438' },   // emerald
  { bg: '#F7EFE1', line: '#B98036', fg: '#7A5320' },   // gold
  { bg: '#E9EDF2', line: '#4F5D75', fg: '#39445A' },   // slate
  { bg: '#F2E9E4', line: '#8A5A44', fg: '#5E3B2C' },   // clay
  { bg: '#ECECEF', line: '#4A4A55', fg: '#35353E' },   // graphite
];
type Tone = { bg: string; line: string; fg: string; solid?: boolean; dim?: boolean; live?: boolean };
type Phase = 'past' | 'now' | 'next';

const z = (n: number) => (n < 10 ? '0' : '') + n;
const pct = (n: number) => `${n}%` as `${number}%`;
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const daysInMonth = (mk: string) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const weekStart = (k: string) => addDays(k, -keyToDate(k).getDay());
const fmtShort = (k: string) => Number(k.slice(8)) + ' ' + MON_SHORT[Number(k.slice(5, 7)) - 1];
const wdOf = (k: string) => WD3[keyToDate(k).getDay()];
const nightsLbl = (x: Stay) => (x.sameDay ? 'day use' : x.nights + ' night' + (x.nights === 1 ? '' : 's'));

/* The flats a stay occupies: "3103, 3028" is two. With no unit recorded, the
   property's own unit number stands in, so the stay still lands on a row.
   The form writes the trailing number of a flat's name, which for
   "403, Plot no 685, Sector 45" and "101, …, Sector 45" is "45" for both; the
   stay property is already resolved, so that number maps back to its own flat. */
const unitsOf = (x: Stay) => {
  const own = unitNo(x.prop) || x.prop;
  const tail = unitNumberOf(x.prop);
  const u = String(x.unit ?? '').split(/[,/]/).map((v) => v.trim()).filter(Boolean)
    .map((v) => (v === x.prop || (tail && v === tail) ? own : v));
  return u.length ? [...new Set(u)] : [own];
};

export default function CalendarScreen() {
  const s = useStore();
  const tk = todayIso();
  const [view, setView] = useState<CalView>('month');
  const [anchor, setAnchor] = useState(tk);            // the date every view centres on
  const [unit, setUnit] = useState('All');
  const [picker, setPicker] = useState(false);
  const [openWeeks, setOpenWeeks] = useState<Record<string, boolean>>({});
  const mk = anchor.slice(0, 7);

  const monthScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  useEffect(() => { monthScroll.current?.scrollTo({ y: 0, animated: true }); }, [s.retapSig]);
  /* Re-tapping the tab also brings you back to today. */
  useEffect(() => { if (s.retapSig) setAnchor(todayIso()); }, [s.retapSig]);

  const b = s.logs?.bookings || null;
  const { stays: allStays, undated } = useMemo(() => computeStays(b, 'All'), [b]);

  /* Our own flats come first and are always listed, even when empty: an empty
     row is the point of the view. Host flats join only when a guest stayed in
     one. */
  const ownUnits = useMemo(() => {
    const out: string[] = [];
    s.props.forEach((p) => { const u = unitNo(p.name) || p.name; if (!out.includes(u)) out.push(u); });
    return out;
  }, [s.props]);
  const units = useMemo(() => {
    const n: Record<string, number> = {};
    allStays.forEach((x) => unitsOf(x).forEach((u) => { n[u] = (n[u] || 0) + 1; }));
    const others = Object.keys(n).filter((u) => !ownUnits.includes(u)).sort((a, b2) => (n[b2] - n[a]) || a.localeCompare(b2));
    return [...ownUnits, ...others];
  }, [allStays, ownUnits]);
  useEffect(() => { if (unit !== 'All' && !units.includes(unit)) setUnit('All'); }, [units, unit]);

  const stays = useMemo(
    () => (unit === 'All' ? allStays : allStays.filter((x) => unitsOf(x).includes(unit))),
    [allStays, unit]
  );

  const colorOf = useMemo(() => {
    const names = s.props.map((p) => p.name);
    allStays.forEach((x) => { if (x.prop && !names.includes(x.prop)) names.push(x.prop); });
    const m: Record<string, typeof LANE_COLORS[0]> = {};
    names.forEach((n, i) => { m[n] = LANE_COLORS[i % LANE_COLORS.length]; });
    return m;
  }, [s.props, allStays]);

  const phaseOf = (x: Stay): Phase => (x.outK < tk ? 'past' : x.inK > tk ? 'next' : 'now');
  const toneOf = (x: Stay): Tone => {
    const c = colorOf[x.prop] || LANE_COLORS[0];
    const ph = phaseOf(x);
    if (ph === 'past') return { bg: '#F1F0EC', line: '#DDDBD4', fg: '#9A99A1', dim: true };
    if (ph === 'now') return { bg: c.line, line: c.line, fg: '#FFFFFF', solid: true, live: true };
    return { bg: c.bg, line: c.line, fg: c.fg };
  };

  /* ── occupancy, per unit, on stay nights ── */
  const occFor = (fromK: string, toK: string, list: string[]) => {
    const days = Math.round((keyToDate(toK).getTime() - keyToDate(fromK).getTime()) / 86400000);
    return list.map((u) => {
      let nights = 0;
      allStays.forEach((x) => { if (unitsOf(x).includes(u)) nights += nightsInRange(x, fromK, toK); });
      return { unit: u, nights: Math.min(nights, days), days, pct: days ? Math.round((Math.min(nights, days) / days) * 100) : 0 };
    });
  };
  const monthStart = mk + '-01';
  const monthEnd = addMonth(mk, 1) + '-01';
  const monthOcc = useMemo(() => {
    const scope = unit === 'All' ? units : [unit];
    return occFor(monthStart, monthEnd, scope).filter((r) => r.nights > 0 || ownUnits.includes(r.unit));
  }, [allStays, units, unit, mk]);
  /* The headline figure is our own flats only: a host flat we used for two
     nights would otherwise drag the average down as if it sat empty. */
  const headOcc = useMemo(() => {
    const rows = unit === 'All' ? monthOcc.filter((r) => ownUnits.includes(r.unit)) : monthOcc;
    const n = rows.reduce((a, r) => a + r.nights, 0), d = rows.reduce((a, r) => a + r.days, 0);
    return d ? Math.round((n / d) * 100) : 0;
  }, [monthOcc, ownUnits, unit]);

  /* ── navigation ── */
  const shift = (k: string, dir: number, v: CalView) => {
    if (v === 'month') { const nm = addMonth(k.slice(0, 7), dir); return nm === thisMonthIso() ? todayIso() : nm + '-01'; }
    if (v === 'week') return addDays(k, 7 * dir);
    return addDays(k, dir);
  };
  const viewRef = useRef(view); viewRef.current = view;
  const anchorRef = useRef(anchor); anchorRef.current = anchor;
  const [bodyW, setBodyW] = useState(0);
  const wRef = useRef(0); wRef.current = bodyW;
  const swipeX = useSharedValue(0);
  const busy = useRef(false);
  const step = (dir: 1 | -1, animate = true) => {
    if (busy.current) return;
    const v = viewRef.current;
    if (!animate || (v !== 'month' && v !== 'week')) { setAnchor(shift(anchorRef.current, dir, v)); return; }
    busy.current = true;
    const w = wRef.current || 360;
    swipeX.value = withTiming(-dir * w, { duration: 150, easing: Easing.in(Easing.quad) });
    setTimeout(() => {
      setAnchor(shift(anchorRef.current, dir, viewRef.current));
      swipeX.value = dir * w;
      swipeX.value = withSpring(0, { damping: 20, stiffness: 190 });
      busy.current = false;
    }, 160);
  };
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
    onPanResponderMove: (_, g) => { if (!busy.current) swipeX.value = g.dx * 0.9; },
    onPanResponderRelease: (_, g) => {
      const w = wRef.current || 360;
      if (g.dx < -w * 0.22 || g.vx < -0.6) step(1);
      else if (g.dx > w * 0.22 || g.vx > 0.6) step(-1);
      else swipeX.value = withSpring(0, { damping: 18, stiffness: 220 });
    },
    onPanResponderTerminate: () => { swipeX.value = withSpring(0); },
  })).current;
  const swipeStyle = useAnimatedStyle(() => (Math.abs(swipeX.value) < 0.5 ? { transform: [], opacity: 1 } : {
    transform: [{ translateX: swipeX.value }],
    opacity: interpolate(Math.abs(swipeX.value), [0, (wRef.current || 360)], [1, 0.3]),
  }));

  /* ── Day view: grows out of the tapped cell, or simply appears ── */
  const bodyRef = useRef<React.ComponentRef<typeof View>>(null);
  const cellRefs = useRef<Record<string, React.ComponentRef<typeof View> | null>>({});
  const progress = useSharedValue(0);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [from, setFrom] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });
  const backTo = useRef<CalView>('month');
  const goDay = (k: string, cellKey?: string) => {
    setAnchor(k);
    if (view !== 'day') backTo.current = view;
    const cell = cellKey ? cellRefs.current[cellKey] : null;
    const body = bodyRef.current;
    if (cell && body) {
      body.measureInWindow((bx, by) => {
        cell.measureInWindow((cx, cy, cw, ch) => {
          setFrom({ x: cx - bx, y: cy - by, w: cw, h: ch });
          setView('day');
          playOpen(progress);
        });
      });
    } else {
      setFrom({ x: 0, y: 0, w: area.w, h: area.h });
      progress.value = 1;
      setView('day');
    }
  };
  const pickView = (v: CalView) => {
    setPicker(false);
    if (v === view) { setAnchor(todayIso()); return; }
    if (v === 'day') { goDay(anchor); return; }
    if (view === 'day') {
      closeDay(progress, () => setView(v));
      return;
    }
    setView(v);
  };
  const depth = useAnimatedStyle(() => (progress.value < 0.001 || view !== 'day' ? { opacity: 1, transform: [] } : {
    opacity: interpolate(progress.value, [0, 0.6], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.94]) }],
  }));

  const showStay = (x: Stay) => s.openBooking(x.row);

  /* ── header title per view ── */
  const ws = weekStart(anchor);
  const title = view === 'month' ? monthTitle(mk)
    : view === 'week' ? (ws.slice(5, 7) === addDays(ws, 6).slice(5, 7)
      ? Number(ws.slice(8)) + ' – ' + fmtShort(addDays(ws, 6))
      : fmtShort(ws) + ' – ' + fmtShort(addDays(ws, 6))) + ' ' + addDays(ws, 6).slice(0, 4)
      : view === 'day' ? wdOf(anchor) + ', ' + fmtShort(anchor) + (anchor.slice(0, 4) !== tk.slice(0, 4) ? ' ' + anchor.slice(0, 4) : '')
        : 'Schedule';
  const showsToday = view === 'month' ? mk === tk.slice(0, 7)
    : view === 'week' ? ws === weekStart(tk)
      : view === 'day' ? anchor === tk : true;
  const kicker = view === 'day' && anchor === tk ? 'TODAY' : view === 'month' && mk === tk.slice(0, 7) ? 'THIS MONTH'
    : view === 'week' && showsToday ? 'THIS WEEK' : view === 'schedule' ? 'FROM TODAY' : ' ';

  return (
    <View style={{ flex: 1 }}>
      {/* ── fixed header: title, today, arrows; views; unit ── */}
      <View style={st.top}>
        <View style={st.titleRow}>
          <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={() => view !== 'schedule' && setPicker((p) => !p)}
            accessibilityLabel="Jump to a month">
            <Text style={st.kicker}>{kicker}</Text>
            <Text style={st.title} numberOfLines={1}>{title}{view !== 'schedule' ? <Text style={st.caret}>  {picker ? '▴' : '▾'}</Text> : null}</Text>
          </TouchableOpacity>
          {!showsToday ? (
            <TouchableOpacity style={st.todayBtn} onPress={() => { setPicker(false); setAnchor(todayIso()); }} activeOpacity={0.7}>
              <Text style={st.todayTxt}>Today</Text>
            </TouchableOpacity>
          ) : null}
          {view !== 'schedule' ? (
            <>
              <TouchableOpacity style={st.nav} onPress={() => step(-1)} accessibilityLabel="Previous" hitSlop={6}><Text style={st.navTxt}>‹</Text></TouchableOpacity>
              <TouchableOpacity style={st.nav} onPress={() => step(1)} accessibilityLabel="Next" hitSlop={6}><Text style={st.navTxt}>›</Text></TouchableOpacity>
            </>
          ) : null}
        </View>

        <View style={st.seg}>
          {VIEWS.map((v) => {
            const on = v.key === view;
            return (
              <TouchableOpacity key={v.key} style={[st.segBtn, on && st.segOn]} onPress={() => pickView(v.key)} activeOpacity={0.8}
                accessibilityRole="tab" accessibilityState={{ selected: on }}>
                <Text style={[st.segTxt, on && st.segTxtOn]}>{v.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {units.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={st.unitRow}>
            {['All', ...units].map((u) => {
              const on = u === unit;
              const own = u === 'All' || ownUnits.includes(u);
              return (
                <TouchableOpacity key={u} style={[st.uChip, on && st.uChipOn, !own && !on && st.uChipHost]} onPress={() => setUnit(u)} activeOpacity={0.7}>
                  <Text style={[st.uTxt, on && st.uTxtOn]}>{u === 'All' ? 'All units' : u}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      <View style={{ flex: 1 }} ref={bodyRef} collapsable={false}
        onLayout={(e) => { const { width, height } = e.nativeEvent.layout; setBodyW(width); setArea({ w: width, h: height }); }}>
        <Animated.View style={[{ flex: 1 }, depth]} pointerEvents={view === 'day' ? 'none' : 'auto'}>
          {view === 'schedule' ? (
            <ScheduleView stays={stays} tk={tk} toneOf={toneOf} phaseOf={phaseOf} colorOf={colorOf} onOpen={showStay} onDay={(k) => goDay(k)} />
          ) : view === 'week' ? (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
              <Animated.View style={swipeStyle} {...swipe.panHandlers}>
                <WeekTimeline ws={ws} tk={tk} units={unit === 'All' ? units : [unit]} ownUnits={ownUnits} stays={stays}
                  width={bodyW} toneOf={toneOf} occFor={occFor} onOpen={showStay} onDay={(k) => goDay(k)} />
              </Animated.View>
              <Legend />
            </ScrollView>
          ) : (
            <ScrollView ref={monthScroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
              <View style={st.occHead}>
                <View style={st.track}><View style={[st.fill, { width: pct(Math.min(100, headOcc)) }]} /></View>
                <Text style={st.occTxt}>
                  <Text style={st.occPct}>{headOcc}%</Text> of nights booked{unit === 'All' ? ' in our units' : ' in ' + unit}
                </Text>
              </View>
              <View style={st.wdRow}>{WD.map((d, i) => <Text key={i} style={st.wd}>{d}</Text>)}</View>
              <Animated.View style={[st.grid, swipeStyle]} {...swipe.panHandlers}>
                <MonthGrid mk={mk} tk={tk} sel={anchor} stays={stays} width={bodyW} toneOf={toneOf} openWeeks={openWeeks}
                  toggleWeek={(k) => setOpenWeeks((o) => ({ ...o, [k]: !o[k] }))}
                  cellRef={(k, r) => { cellRefs.current[k] = r; }} onDay={(k) => goDay(k, k)} onOpen={showStay} />
              </Animated.View>
              <Legend />
              <UnitOccupancy rows={monthOcc} ownUnits={ownUnits} title={'Occupancy by unit · ' + MON_SHORT[Number(mk.slice(5, 7)) - 1]}
                selected={unit} onPick={(u) => setUnit(unit === u ? 'All' : u)} />
              {undated > 0 ? (
                <Text style={st.note}>
                  {undated} booking{undated === 1 ? ' has' : 's have'} no check-in date, so {undated === 1 ? 'it is' : 'they are'} not on the calendar.
                </Text>
              ) : null}
            </ScrollView>
          )}
        </Animated.View>

        {view === 'day' && area.w ? (
          <DayView bare dayKey={anchor} stays={stays} from={from} area={area} progress={progress} toneOf={toneOf}
            onClose={() => pickView(backTo.current)} onOpen={showStay} onDay={(k) => setAnchor(k)} />
        ) : null}

        {picker ? (
          <MonthPicker cur={mk} tk={tk} stays={allStays} ownUnits={ownUnits} unit={unit}
            onPick={(m) => { setPicker(false); setAnchor(m === tk.slice(0, 7) ? tk : m + '-01'); }}
            onClose={() => setPicker(false)} />
        ) : null}
      </View>
    </View>
  );
}

/* ── Month ─────────────────────────────────────────────────────────────── */
type Seg = { stay: Stay; from: number; to: number; realStart: boolean; realEnd: boolean };

function timeFrac(t: string) {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return 0.5;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return Math.min(1 - EDGE, Math.max(EDGE, (h * 60 + min) / 1440));
}

/* A stay as fractional columns across seven day keys: 3.85 is "day 3, 85% of
   the way across", which is where a 10pm arrival belongs. */
function segsFor(days: (string | null)[], stays: Stay[]) {
  const first = days.find(Boolean) as string | undefined;
  const last = [...days].reverse().find(Boolean) as string | undefined;
  const segs: Seg[] = [];
  if (!first || !last) return segs;
  stays.forEach((stay) => {
    if (stay.outK < first || stay.inK > last) return;
    const startsHere = stay.inK >= first;
    const endsHere = stay.outK <= last;
    const c0 = startsHere ? days.indexOf(stay.inK) : days.indexOf(first);
    const c1 = endsHere ? days.indexOf(stay.outK) : days.indexOf(last);
    if (c0 < 0 || c1 < 0) return;
    const f = startsHere ? c0 + timeFrac(stay.inT) : c0;
    const t = endsHere ? c1 + timeFrac(stay.outT) : c1 + 1;
    segs.push({ stay, from: f, to: Math.max(f + 0.18, t), realStart: startsHere, realEnd: endsHere });
  });
  return segs;
}
function laneUp(segs: Seg[]) {
  const lanes: Seg[][] = [];
  [...segs].sort((a, b) => (a.from - b.from) || (b.to - a.to)).forEach((sg) => {
    let lane = lanes.find((L) => L[L.length - 1].to <= sg.from);
    if (!lane) { lane = []; lanes.push(lane); }
    lane.push(sg);
  });
  return lanes;
}
function monthWeeks(mk: string) {
  const [y, m] = mk.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const n = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= n; d++) cells.push(mk + '-' + z(d));
  while (cells.length % 7) cells.push(null);
  const out: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
  return out;
}

function MonthGrid({ mk, tk, sel, stays, width, toneOf, openWeeks, toggleWeek, cellRef, onDay, onOpen }: {
  mk: string; tk: string; sel: string; stays: Stay[]; width: number; toneOf: (x: Stay) => Tone;
  openWeeks: Record<string, boolean>; toggleWeek: (k: string) => void;
  cellRef: (k: string, r: any) => void; onDay: (k: string) => void; onOpen: (x: Stay) => void;
}) {
  const weeks = useMemo(() => monthWeeks(mk).map((days) => ({ days, lanes: laneUp(segsFor(days, stays)) })), [mk, stays]);
  return (
    <>
      {weeks.map((w, wi) => {
        const wkey = mk + ':' + wi;
        const expanded = !!openWeeks[wkey];
        const cap = expanded ? 99 : MAX_LANES;
        const shown = w.lanes.slice(0, cap);
        const hidden: Record<string, number> = {};
        w.lanes.slice(cap).forEach((lane) => lane.forEach((sg) => {
          for (let c = Math.floor(sg.from); c <= Math.min(6, Math.ceil(sg.to) - 1); c++) {
            const k = w.days[c]; if (k) hidden[k] = (hidden[k] || 0) + 1;
          }
        }));
        const more = Object.keys(hidden).length > 0;
        const rows = shown.length + (more || expanded && w.lanes.length > MAX_LANES ? 1 : 0);
        const h = Math.max(CELL_MIN_H, DATE_H + rows * (BAR_H + BAR_GAP) + 8);
        return (
          <View key={wi} style={[st.week, { minHeight: h }]}>
            {w.days.map((k, ci) => (
              <TouchableOpacity key={ci} ref={(r: any) => { if (k) cellRef(k, r); }}
                style={[st.cell, !k && st.cellDead, !!k && k < tk && st.cellPast, k === sel && st.cellSel]}
                activeOpacity={k ? 0.75 : 1} disabled={!k} onPress={() => k && onDay(k)}>
                {k ? (
                  <View style={[st.dateWrap, k === tk && st.dateToday]}>
                    <Text style={[st.date, k < tk && st.datePast, k === tk && st.dateTodayTxt]}>{Number(k.slice(8))}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}

            {shown.map((lane, li) => lane.map((sg) => (
              <Bar key={sg.stay.row + ':' + li} sg={sg} tone={toneOf(sg.stay)} top={DATE_H + li * (BAR_H + BAR_GAP)}
                height={BAR_H} gridW={width} cols={7} offset={0} onPress={() => onOpen(sg.stay)} />
            )))}

            {/* "+N" exactly on the days that have more; tapping opens the week */}
            {more ? w.days.map((k, ci) => (k && hidden[k] ? (
              <TouchableOpacity key={'m' + ci} onPress={() => toggleWeek(wkey)} activeOpacity={0.7}
                style={[st.more, { left: pct((ci / 7) * 100), top: DATE_H + shown.length * (BAR_H + BAR_GAP) }]}>
                <Text style={st.moreTxt}>+{hidden[k]} more</Text>
              </TouchableOpacity>
            ) : null)) : expanded && w.lanes.length > MAX_LANES ? (
              <TouchableOpacity onPress={() => toggleWeek(wkey)} activeOpacity={0.7}
                style={[st.more, st.less, { top: DATE_H + shown.length * (BAR_H + BAR_GAP) }]}>
                <Text style={st.moreTxt}>Show less ▴</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

/* One stay segment, shared by Month and Week. */
function Bar({ sg, tone, top, height, gridW, cols, offset, onPress, big }: {
  sg: Seg; tone: Tone; top: number; height: number; gridW: number; cols: number; offset: number;
  onPress: () => void; big?: boolean;
}) {
  const x = sg.stay;
  const colW = (gridW - offset) / cols;
  const px = (sg.to - sg.from) * colW;
  const nm = x.guest || x.id;
  const label = px >= (big ? 60 : 74) ? (sg.realStart ? '' : '‹ ') + nm : px >= 24 ? initials(nm) : '';
  const r = big ? 7 : 5;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress} accessibilityLabel={nm + ', ' + x.inK + ' to ' + x.outK}
      style={[st.bar, {
        height, top, left: offset + sg.from * colW, width: px,
        backgroundColor: tone.bg, borderColor: tone.line,
        borderTopLeftRadius: sg.realStart ? r : 0, borderBottomLeftRadius: sg.realStart ? r : 0,
        borderTopRightRadius: sg.realEnd ? r : 0, borderBottomRightRadius: sg.realEnd ? r : 0,
        borderLeftWidth: sg.realStart ? (tone.solid || tone.dim ? 1 : 3) : 0, borderRightWidth: sg.realEnd ? 1 : 0,
      }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {tone.live && sg.realStart && px >= 30 ? <View style={st.liveDot} /> : null}
        <Text style={[big ? st.barTxtBig : st.barTxt, { color: tone.fg, flexShrink: 1 }]} numberOfLines={1}>{label}</Text>
      </View>
      {x.pending > 0 && sg.realEnd && px >= 14 ? <View style={st.dueDot} /> : null}
    </TouchableOpacity>
  );
}

function Legend() {
  const c = LANE_COLORS[0];
  return (
    <View style={st.legend}>
      <View style={st.lgItem}><View style={[st.lgSw, { backgroundColor: c.line }]}><View style={[st.liveDot, { width: 5, height: 5 }]} /></View><Text style={st.lgTxt}>In house</Text></View>
      <View style={st.lgItem}><View style={[st.lgSw, { backgroundColor: c.bg, borderLeftWidth: 3, borderColor: c.line }]} /><Text style={st.lgTxt}>Upcoming</Text></View>
      <View style={st.lgItem}><View style={[st.lgSw, { backgroundColor: '#F1F0EC', borderWidth: 1, borderColor: '#DDDBD4' }]} /><Text style={st.lgTxt}>Past</Text></View>
      <View style={st.lgItem}><View style={[st.dueDot, { position: 'relative', top: 0, right: 0 }]} /><Text style={st.lgTxt}>Money due</Text></View>
    </View>
  );
}

/* How full each unit was, on stay nights. Tap a row to see only that unit. */
function UnitOccupancy({ rows, ownUnits, title, selected, onPick }: {
  rows: { unit: string; nights: number; days: number; pct: number }[]; ownUnits: string[];
  title: string; selected: string; onPick: (u: string) => void;
}) {
  if (!rows.length) return null;
  const own = rows.filter((r) => ownUnits.includes(r.unit));
  const host = rows.filter((r) => !ownUnits.includes(r.unit)).sort((a, b) => b.nights - a.nights);
  const row = (r: typeof rows[0]) => (
    <TouchableOpacity key={r.unit} style={[st.oRow, selected === r.unit && st.oRowOn]} activeOpacity={0.75} onPress={() => onPick(r.unit)}>
      <Text style={st.oUnit} numberOfLines={1}>{r.unit}</Text>
      <View style={st.oTrack}>
        <View style={[st.oFill, { width: pct(r.pct), backgroundColor: r.pct >= 70 ? C.green : r.pct >= 40 ? G.gold2 : '#C9C6BD' }]} />
      </View>
      <Text style={st.oPct}>{r.pct}%</Text>
      <Text style={st.oN}>{r.nights}/{r.days}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={st.oCard}>
      <Text style={st.oTitle}>{title}</Text>
      <Text style={st.oSub}>Nights slept in each unit, by stay dates</Text>
      {own.map(row)}
      {host.length ? <Text style={st.oGroup}>HOST FLATS USED</Text> : null}
      {host.map(row)}
    </View>
  );
}

/* ── Week: one row per unit ───────────────────────────────────────────────
   The view an availability question needs: seven columns, a row per flat,
   and the white space between bars is what is free to sell. */
function WeekTimeline({ ws, tk, units, ownUnits, stays, width, toneOf, occFor, onOpen, onDay }: {
  ws: string; tk: string; units: string[]; ownUnits: string[]; stays: Stay[]; width: number;
  toneOf: (x: Stay) => Tone;
  occFor: (a: string, b: string, u: string[]) => { unit: string; nights: number; days: number; pct: number }[];
  onOpen: (x: Stay) => void; onDay: (k: string) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ws, i)), [ws]);
  const we = addDays(ws, 7);
  const rows = useMemo(() => units.map((u) => {
    const mine = stays.filter((x) => unitsOf(x).includes(u));
    return { unit: u, lanes: laneUp(segsFor(days, mine)) };
  }).filter((r) => r.lanes.length || ownUnits.includes(r.unit) || units.length === 1), [units, stays, days, ownUnits]);
  const occ = useMemo(() => {
    const m: Record<string, number> = {};
    occFor(ws, we, rows.map((r) => r.unit)).forEach((o) => { m[o.unit] = o.nights; });
    return m;
  }, [rows, ws]);
  const colW = width ? (width - LABEL_W) / 7 : 0;
  /* Free own units each night: the number to sell. */
  const freeOf = (k: string) => ownUnits.filter((u) => units.includes(u)).filter((u) =>
    !stays.some((x) => unitsOf(x).includes(u) && x.inK <= k && x.outK > k)).length;
  const ownShown = ownUnits.filter((u) => units.includes(u)).length;

  return (
    <View>
      <View style={st.wHead}>
        <View style={{ width: LABEL_W }} />
        {days.map((k) => {
          const today = k === tk;
          return (
            <TouchableOpacity key={k} style={st.wDay} onPress={() => onDay(k)} activeOpacity={0.7}>
              <Text style={[st.wDayWd, today && { color: C.green }]}>{WD3[keyToDate(k).getDay()].toUpperCase()}</Text>
              <View style={[st.wDayNo, today && st.dateToday]}>
                <Text style={[st.wDayNoTxt, k < tk && st.datePast, today && st.dateTodayTxt]}>{Number(k.slice(8))}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={st.wGrid}>
        {rows.map((r) => {
          const n = Math.max(1, r.lanes.length);
          const h = 12 + n * (WBAR_H + 4);
          const own = ownUnits.includes(r.unit);
          return (
            <View key={r.unit} style={[st.wRow, { height: h }]}>
              <View style={[st.wLbl, { width: LABEL_W }]}>
                <Text style={[st.wUnit, !own && { color: C.bark }]} numberOfLines={1}>{r.unit}</Text>
                <Text style={st.wOcc}>{occ[r.unit] || 0}/7 nights</Text>
              </View>
              {days.map((k, i) => (
                <TouchableOpacity key={k} activeOpacity={0.6} onPress={() => onDay(k)}
                  style={[st.wCell, { left: LABEL_W + i * colW, width: colW }, k < tk && st.cellPast, k === tk && st.wToday]} />
              ))}
              {r.lanes.map((lane, li) => lane.map((sg) => (
                <Bar key={sg.stay.row + ':' + li} sg={sg} tone={toneOf(sg.stay)} top={6 + li * (WBAR_H + 4)} height={WBAR_H}
                  gridW={width} cols={7} offset={LABEL_W} onPress={() => onOpen(sg.stay)} big />
              )))}
              {!r.lanes.length ? <Text style={[st.wFree, { left: LABEL_W + 8 }]}>Free all week</Text> : null}
            </View>
          );
        })}
        {ownShown > 1 ? (
          <View style={st.wFoot}>
            <Text style={[st.wFootLbl, { width: LABEL_W }]}>Free{'\n'}tonight</Text>
            {days.map((k) => {
              const f = freeOf(k);
              return (
                <View key={k} style={st.wDay}>
                  <Text style={[st.wFootN, { color: f === 0 ? C.green : k < tk ? C.muted : C.ink }]}>{f === 0 ? 'Full' : f}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Schedule: what happens next, day by day ── */
function ScheduleView({ stays, tk, toneOf, phaseOf, colorOf, onOpen, onDay }: {
  stays: Stay[]; tk: string; toneOf: (x: Stay) => Tone; phaseOf: (x: Stay) => Phase;
  colorOf: Record<string, typeof LANE_COLORS[0]>; onOpen: (x: Stay) => void; onDay: (k: string) => void;
}) {
  const [back, setBack] = useState(0);       // days of history shown
  const [ahead, setAhead] = useState(45);
  const fromK = addDays(tk, -back), toK = addDays(tk, ahead);
  const inHouse = stays.filter((x) => x.inK < tk && x.outK > tk);
  const groups = useMemo(() => {
    const m: Record<string, { stay: Stay; kind: 'in' | 'out' | 'use'; t: string }[]> = {};
    const push = (k: string, e: { stay: Stay; kind: 'in' | 'out' | 'use'; t: string }) => { (m[k] = m[k] || []).push(e); };
    stays.forEach((x) => {
      if (x.sameDay) { if (x.inK >= fromK && x.inK < toK) push(x.inK, { stay: x, kind: 'use', t: x.inT }); return; }
      if (x.inK >= fromK && x.inK < toK) push(x.inK, { stay: x, kind: 'in', t: x.inT });
      if (x.outK >= fromK && x.outK < toK && !x.assumedOut) push(x.outK, { stay: x, kind: 'out', t: x.outT });
    });
    const mins = (t: string, kind: string) => {
      const mm = String(t || '').match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (!mm) return kind === 'out' ? 660 : 840;
      let h = parseInt(mm[1], 10); const ap = (mm[3] || '').toLowerCase();
      if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
      return h * 60 + parseInt(mm[2], 10);
    };
    return Object.keys(m).sort().map((k) => ({ k, items: m[k].sort((a, b) => mins(a.t, a.kind) - mins(b.t, b.kind)) }));
  }, [stays, fromK, toK]);
  const dayHead = (k: string) => {
    const rel = k === tk ? 'Today' : k === addDays(tk, 1) ? 'Tomorrow' : k === addDays(tk, -1) ? 'Yesterday' : '';
    return { rel, full: wdOf(k) + ', ' + fmtShort(k) + (k.slice(0, 4) !== tk.slice(0, 4) ? ' ' + k.slice(0, 4) : '') };
  };
  const nightOf = (x: Stay) => Math.round((keyToDate(tk).getTime() - keyToDate(x.inK).getTime()) / 86400000) + 1;
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const hasToday = groups.some((g) => g.k === tk);

  return (
    <ScrollView ref={scroller} style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 36 }}>
      <TouchableOpacity style={st.loadBtn} onPress={() => setBack((b) => b + 14)} activeOpacity={0.7}>
        <Text style={st.loadTxt}>↑ Show earlier ({back ? 'two more weeks' : 'past two weeks'})</Text>
      </TouchableOpacity>

      {inHouse.length ? (
        <View style={st.nowCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={st.liveDotBig} /><Text style={st.nowTitle}>In house now · {inHouse.length}</Text>
          </View>
          {inHouse.map((x) => {
            const c = colorOf[x.prop] || LANE_COLORS[0];
            return (
              <TouchableOpacity key={x.row} style={st.nowRow} onPress={() => onOpen(x)} activeOpacity={0.75}>
                <View style={[st.stripe, { backgroundColor: c.line }]} />
                <View style={{ flex: 1 }}>
                  <Text style={st.sName} numberOfLines={1}>{x.guest || x.id}</Text>
                  <Text style={st.sSub} numberOfLines={1}>{unitsOf(x).join(', ')} · night {nightOf(x)} of {x.nights} · leaves {wdOf(x.outK)} {fmtShort(x.outK)}{x.outT ? ' ' + x.outT : ''}</Text>
                </View>
                {x.pending > 0 ? <Text style={st.sDue}>{inr(x.pending)} due</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}

      {!hasToday && back === 0 ? (
        <View style={st.dayBlock}>
          <TouchableOpacity onPress={() => onDay(tk)} activeOpacity={0.7} style={st.dayHeadRow}>
            <Text style={[st.dayRel, { color: C.green }]}>Today</Text><Text style={st.dayFull}>{dayHead(tk).full}</Text>
          </TouchableOpacity>
          <Text style={st.quiet}>No arrivals or departures today.</Text>
        </View>
      ) : null}

      {groups.map(({ k, items }) => {
        const h = dayHead(k);
        const pastDay = k < tk;
        return (
          <View key={k} style={[st.dayBlock, pastDay && { opacity: 0.6 }]}>
            <TouchableOpacity onPress={() => onDay(k)} activeOpacity={0.7} style={st.dayHeadRow}>
              {h.rel ? <Text style={[st.dayRel, k === tk && { color: C.green }]}>{h.rel}</Text> : null}
              <Text style={st.dayFull}>{h.full}</Text>
            </TouchableOpacity>
            {items.map((e) => {
              const x = e.stay;
              const tone = toneOf(x);
              const c = colorOf[x.prop] || LANE_COLORS[0];
              const ph = phaseOf(x);
              const verb = e.kind === 'in' ? 'Check-in' : e.kind === 'out' ? 'Check-out' : 'Day use';
              return (
                <TouchableOpacity key={e.kind + x.row} style={st.sRow} onPress={() => onOpen(x)} activeOpacity={0.75}>
                  <View style={st.sTime}>
                    <Text style={[st.sKind, { color: e.kind === 'out' ? G.gold3 : C.green }]}>{e.kind === 'out' ? 'OUT' : 'IN'}</Text>
                    <Text style={st.sT}>{e.t || '—'}</Text>
                  </View>
                  <View style={[st.stripe, { backgroundColor: ph === 'past' ? '#D3D1CB' : c.line }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[st.sName, tone.dim && { color: C.bark }]} numberOfLines={1}>{x.guest || x.id}</Text>
                    <Text style={st.sSub} numberOfLines={1}>
                      {verb} · {unitsOf(x).join(', ')} · {nightsLbl(x)}
                      {e.kind === 'in' && !x.sameDay ? ' · till ' + fmtShort(x.outK) : ''}
                      {x.channel ? ' · ' + x.channel : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    {e.kind === 'in' ? <Text style={st.sNet}>{inr(x.net)}</Text> : null}
                    {x.pending > 0 ? <Text style={st.sDue}>{inr(x.pending)} due</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}

      {!groups.length ? <Text style={st.quiet}>Nothing booked in the next {ahead} days.</Text> : null}
      <TouchableOpacity style={st.loadBtn} onPress={() => setAhead((a) => a + 30)} activeOpacity={0.7}>
        <Text style={st.loadTxt}>↓ Show later (until {fmtShort(addDays(toK, 30))})</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

/* ── Jump to a month: a year of months, each with how full it was ── */
function MonthPicker({ cur, tk, stays, ownUnits, unit, onPick, onClose }: {
  cur: string; tk: string; stays: Stay[]; ownUnits: string[]; unit: string;
  onPick: (mk: string) => void; onClose: () => void;
}) {
  const [year, setYear] = useState(Number(cur.slice(0, 4)));
  const scope = unit === 'All' ? ownUnits : [unit];
  const occ = (mk: string) => {
    const a = mk + '-01', b2 = addMonth(mk, 1) + '-01';
    let n = 0;
    stays.forEach((x) => { if (unitsOf(x).some((u) => scope.includes(u))) n += nightsInRange(x, a, b2); });
    const cap = daysInMonth(mk) * Math.max(1, scope.length);
    return Math.min(100, Math.round((n / cap) * 100));
  };
  return (
    <>
      <TouchableOpacity style={st.scrim} activeOpacity={1} onPress={onClose} />
      <View style={st.picker}>
        <View style={st.pickHead}>
          <TouchableOpacity style={st.nav} onPress={() => setYear(year - 1)}><Text style={st.navTxt}>‹</Text></TouchableOpacity>
          <Text style={st.pickYear}>{year}</Text>
          <TouchableOpacity style={st.nav} onPress={() => setYear(year + 1)}><Text style={st.navTxt}>›</Text></TouchableOpacity>
        </View>
        <View style={st.pickGrid}>
          {MON_SHORT.map((m, i) => {
            const mk = year + '-' + z(i + 1);
            const o = occ(mk);
            const on = mk === cur, now = mk === tk.slice(0, 7);
            return (
              <TouchableOpacity key={m} style={[st.pickCell, on && st.pickOn]} onPress={() => onPick(mk)} activeOpacity={0.75}>
                <Text style={[st.pickM, on && { color: '#fff' }, now && !on && { color: C.green }]}>{m}</Text>
                <View style={[st.pickTrack, on && { backgroundColor: 'rgba(255,255,255,0.25)' }]}>
                  <View style={[st.pickFill, { width: pct(o) }, on && { backgroundColor: '#fff' }]} />
                </View>
                <Text style={[st.pickPct, on && { color: 'rgba(255,255,255,0.85)' }]}>{o ? o + '%' : '—'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text style={st.pickNote}>Nights booked in {unit === 'All' ? 'our units' : unit}</Text>
      </View>
    </>
  );
}

const st = StyleSheet.create({
  top: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8, gap: 10, borderBottomWidth: 1, borderBottomColor: C.hair, backgroundColor: C.bg, zIndex: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  kicker: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.4, color: G.gold2 },
  title: { fontFamily: F.xbold, fontSize: 22, color: C.ink, letterSpacing: -0.5 },
  caret: { fontSize: 13, color: C.muted },
  todayBtn: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  todayTxt: { fontFamily: F.bold, fontSize: 12, color: C.ink },
  nav: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  navTxt: { fontSize: 20, lineHeight: 22, color: C.bark, fontFamily: F.bold },

  seg: { flexDirection: 'row', backgroundColor: C.bone, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 9, alignItems: 'center' },
  segOn: { backgroundColor: '#fff', shadowColor: G.shadow, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segTxt: { fontFamily: F.semi, fontSize: 13, color: C.bark },
  segTxtOn: { color: C.ink, fontFamily: F.bold },

  unitRow: { gap: 6, alignItems: 'center' },
  uChip: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line, backgroundColor: '#fff' },
  uChipHost: { borderStyle: 'dashed' },
  uChipOn: { backgroundColor: C.navy, borderColor: C.navy },
  uTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  uTxtOn: { color: '#fff', fontFamily: F.bold },

  occHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  occTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.bark },
  occPct: { fontFamily: F.xbold, color: C.green },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.hair, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: C.green, borderRadius: 3 },

  wdRow: { flexDirection: 'row', paddingBottom: 6 },
  wd: { flex: 1, textAlign: 'center', fontFamily: F.semi, fontSize: 11, color: C.muted },
  grid: { borderTopWidth: 1, borderTopColor: C.line },
  week: { flexDirection: 'row', position: 'relative' },
  cell: { flex: 1, minHeight: CELL_MIN_H, borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.line, paddingHorizontal: 3, paddingTop: 4, backgroundColor: C.card },
  cellDead: { backgroundColor: C.warm },
  cellPast: { backgroundColor: C.warm2 },
  cellSel: { backgroundColor: '#FBF5E9' },
  dateWrap: { alignSelf: 'flex-start', minWidth: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  dateToday: { backgroundColor: C.green },
  date: { fontFamily: F.semi, fontSize: 12, color: C.ink },
  datePast: { color: '#B9B8BE' },
  dateTodayTxt: { color: '#fff', fontFamily: F.bold },

  bar: { position: 'absolute', justifyContent: 'center', borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 5, overflow: 'hidden' },
  barTxt: { fontFamily: F.semi, fontSize: 9.5 },
  barTxtBig: { fontFamily: F.bold, fontSize: 11.5 },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveDotBig: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.green },
  dueDot: { position: 'absolute', top: 2, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: C.red, borderWidth: 1, borderColor: '#fff' },
  more: { position: 'absolute', marginLeft: 3, height: 16, borderRadius: 8, paddingHorizontal: 5, backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center' },
  less: { left: 3 },
  moreTxt: { fontFamily: F.bold, fontSize: 9.5, color: C.bark },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 14, paddingTop: 12 },
  lgItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lgSw: { width: 20, height: 11, borderRadius: 3, alignItems: 'center', justifyContent: 'center' },
  lgTxt: { fontFamily: F.semi, fontSize: 11, color: C.bark },

  oCard: { marginHorizontal: 14, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: C.hair },
  oTitle: { fontFamily: F.xbold, fontSize: 15, color: C.ink },
  oSub: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 2, marginBottom: 8 },
  oGroup: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 1, color: C.muted, marginTop: 12, marginBottom: 2 },
  oRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 10 },
  oRowOn: { backgroundColor: C.amberbg },
  oUnit: { width: 52, fontFamily: F.bold, fontSize: 13, color: C.ink },
  oTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: C.hair, overflow: 'hidden' },
  oFill: { height: 8, borderRadius: 4 },
  oPct: { width: 40, textAlign: 'right', fontFamily: F.xbold, fontSize: 13, color: C.ink },
  oN: { width: 42, textAlign: 'right', fontFamily: F.med, fontSize: 11, color: C.muted },

  wHead: { flexDirection: 'row', paddingTop: 10, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: C.line },
  wDay: { flex: 1, alignItems: 'center' },
  wDayWd: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.6, color: C.muted },
  wDayNo: { marginTop: 3, minWidth: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  wDayNoTxt: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  wGrid: {},
  wRow: { position: 'relative', borderBottomWidth: 1, borderBottomColor: C.line },
  wLbl: { position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center', paddingLeft: 12, backgroundColor: C.bg, borderRightWidth: 1, borderRightColor: C.line, zIndex: 1 },
  wUnit: { fontFamily: F.xbold, fontSize: 14, color: C.ink },
  wOcc: { fontFamily: F.med, fontSize: 9.5, color: C.muted, marginTop: 1 },
  wCell: { position: 'absolute', top: 0, bottom: 0, borderRightWidth: 1, borderRightColor: C.hair, backgroundColor: '#fff' },
  wToday: { backgroundColor: '#F3F8F5' },
  wFree: { position: 'absolute', top: 0, bottom: 0, textAlignVertical: 'center', lineHeight: 34, fontFamily: F.semi, fontSize: 11, color: '#B9B8BE' },
  wFoot: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  wFootLbl: { paddingLeft: 12, fontFamily: F.bold, fontSize: 9, letterSpacing: 0.5, color: C.muted, textTransform: 'uppercase' },
  wFootN: { fontFamily: F.xbold, fontSize: 13 },

  loadBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: C.bone, marginVertical: 6 },
  loadTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  nowCard: { marginTop: 8, padding: 12, borderRadius: 16, backgroundColor: C.greenbg, borderWidth: 1, borderColor: 'rgba(51,115,92,0.18)' },
  nowTitle: { fontFamily: F.bold, fontSize: 12, letterSpacing: 0.4, color: C.green, textTransform: 'uppercase' },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10 },
  dayBlock: { marginTop: 16 },
  dayHeadRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  dayRel: { fontFamily: F.xbold, fontSize: 15, color: C.ink },
  dayFull: { fontFamily: F.semi, fontSize: 12.5, color: C.muted },
  sRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair },
  sTime: { width: 58 },
  sKind: { fontFamily: F.bold, fontSize: 9.5, letterSpacing: 0.8 },
  sT: { fontFamily: F.semi, fontSize: 12, color: C.ink, marginTop: 1 },
  stripe: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  sName: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  sSub: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 2 },
  sNet: { fontFamily: F.bold, fontSize: 13, color: C.green },
  sDue: { fontFamily: F.semi, fontSize: 11, color: C.red, marginTop: 1 },
  quiet: { fontFamily: F.med, fontSize: 12.5, color: C.muted, paddingVertical: 6 },

  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,22,26,0.18)', zIndex: 60 },
  picker: {
    position: 'absolute', top: 0, left: 10, right: 10, zIndex: 61, padding: 14, borderRadius: 18, backgroundColor: '#fff',
    shadowColor: G.shadow, shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 12,
  },
  pickHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  pickYear: { fontFamily: F.xbold, fontSize: 18, color: C.ink },
  pickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickCell: { width: '31.5%', paddingVertical: 9, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.warm2, borderWidth: 1, borderColor: C.hair },
  pickOn: { backgroundColor: C.navy, borderColor: C.navy },
  pickM: { fontFamily: F.bold, fontSize: 13, color: C.ink },
  pickTrack: { height: 4, borderRadius: 2, backgroundColor: C.hair, marginTop: 6, overflow: 'hidden' },
  pickFill: { height: 4, borderRadius: 2, backgroundColor: C.green },
  pickPct: { fontFamily: F.semi, fontSize: 10.5, color: C.muted, marginTop: 4 },
  pickNote: { fontFamily: F.med, fontSize: 11, color: C.muted, marginTop: 10, textAlign: 'center' },

  note: { fontFamily: F.med, fontSize: 11.5, color: C.muted, margin: 14, lineHeight: 17 },
});
