import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, inr } from '../theme';
import { Btn, Sheet } from '../ui';
import { BookingChecklist } from '../checklist';
import { useStore } from '../store';
import { addMonth, fmtDayKey, monthTitle } from '../calendar';
import { Stay, ciFmtDay, computeStays, dayKeyOf, keyToDate, nightsInRange, thisMonthIso, todayIso } from '../logic';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import DayView, { Rect, closeDay, openDay as playOpen } from './DayView';

/* The Calendar tab — a month grid of bordered day cells with each stay drawn as
   a bar running from check-in to check-out, the way a multi-day event reads in
   Google Calendar.

   Deliberately NOT the earnings calendar on the Dashboard. That one buckets
   money on the booking date and answers "what did we earn that day"; this one
   buckets nights on the stay dates and answers "who is in the flat". Same rows,
   two different questions — see computeStays vs computeCalendar.

   The ends of a bar sit where the times say they do: a 10pm arrival starts near
   the right edge of its cell, a 10:30am departure ends a little under halfway
   into its own. That is what makes a turnaround legible — the guest leaving in
   the morning and the one arriving that evening occupy visibly different parts
   of the same day, instead of two bars colliding. Where no time was recorded the
   bar falls back to midday, which reads as "sometime that day" rather than
   inventing a precise hour. */

const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
/* Bars a week shows before collapsing the rest into "+N" — three is what fits
   while keeping six weeks on one screen. */
const MAX_LANES = 3;
const CELL_MIN_H = 92;
const DATE_H = 24;     // room for the date number, above the bars
const BAR_H = 17;
const BAR_GAP = 3;
/* A bar never shrinks to nothing, and never touches the cell edge it does not
   reach: an 11:59pm checkout still has to look like it ended inside its day. */
const EDGE = 0.1;
/* Long enough to outlast the modal's slide-out (RN animates it over 250ms)
   before the tab switch hides this screen. See editStay. */
const SHEET_DISMISS_MS = 320;

/* Property colours, assigned by position in the property list so a flat keeps
   its colour across months rather than by hashing the name. */
const LANE_COLORS = [
  { bg: '#E4EDE9', line: '#2E5E4E', fg: '#204438' },   // emerald
  { bg: '#F7EFE1', line: '#B98036', fg: '#7A5320' },   // gold
  { bg: '#ECECEF', line: '#4A4A55', fg: '#35353E' },   // graphite
  { bg: '#F2E9E4', line: '#8A5A44', fg: '#5E3B2C' },   // clay
  { bg: '#E9EDF2', line: '#4F5D75', fg: '#39445A' },   // slate
];
const PENDING = { bg: '#F8ECE9', line: '#B4574A', fg: '#8C3F34' };  // money still owed
/* Anything already over recedes to grey — the past is context, not a call to
   action. */
const DONE = { bg: '#F1F0EC', line: '#D3D1CB', fg: '#8F8E95' };

const unitsOf = (x: Stay) => String(x.unit ?? '').split(/[,/]/).map((u) => u.trim()).filter(Boolean);
/* Past stays keep their property colour, just quieter. */
const past = (c: { bg: string; line: string; fg: string }) => ({ bg: c.bg, line: c.line + '66', fg: c.fg + 'B3', dim: true });
const solid = (c: { bg: string; line: string; fg: string }) => ({ bg: c.line, line: c.line, fg: '#FFFFFF', solid: true });
const initials = (n: string) => n.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const todayKey = todayIso;
const curMonthKey = thisMonthIso;
const daysInMonth = (mk: string) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };
const z = (n: number) => (n < 10 ? '0' : '') + n;
const pct = (n: number) => `${n}%` as `${number}%`;
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function CalendarScreen() {
  const s = useStore();
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [mk, setMk] = useState(curMonthKey());
  const [sel, setSel] = useState<string | null>(todayKey());
  const [sheet, setSheet] = useState(false);
  const [stay, setStay] = useState<Stay | null>(null);
  /* The calendar's own property scope. Independent of the Report tab on
     purpose: choosing one flat to look at a month should not silently re-cut
     every figure on the Report. */
  const [prop, setProp] = useState('All');
  /* A property covers several flats ("Spira 3028" also lets 3903, 3306 …), and
     an availability question is usually about one of them, not the building. */
  const [unit, setUnit] = useState('All');

  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: true }); }, [s.retapSig]);

  const b = s.logs?.bookings || null;
  const { stays: propStays, undated } = useMemo(() => computeStays(b, prop), [b, prop]);

  /* Units offered are the ones this property actually let — a fixed list would
     go stale the moment a new flat is added, and would offer 3903 while looking
     at 2212. */
  const units = useMemo(() => {
    const n: Record<string, number> = {};
    /* Trimmed, and a stay in two flats ("3103, 3028") counts under each — the
       data has " 3028" and "3028 " too, which used to show as extra chips. */
    propStays.forEach((x) => unitsOf(x).forEach((u) => { n[u] = (n[u] || 0) + 1; }));
    /* Busiest first, not alphabetical: "Spira 3028" has let 28 different flats
       but 67 of the stays are in 3028 itself, and an A-Z list would put that
       behind two dozen one-off units nobody is looking for. */
    return Object.keys(n).sort((a, b) => (n[b] - n[a]) || a.localeCompare(b));
  }, [propStays]);

  /* Changing property can strand a unit that does not exist under it. */
  useEffect(() => { if (unit !== 'All' && !units.includes(unit)) setUnit('All'); }, [units, unit]);

  const stays = useMemo(
    () => (unit === 'All' ? propStays : propStays.filter((x) => unitsOf(x).includes(unit))),
    [propStays, unit]
  );

  const colorOf = useMemo(() => {
    const names = s.props.map((p) => p.name);
    stays.forEach((x) => { if (x.prop && !names.includes(x.prop)) names.push(x.prop); });
    const m: Record<string, typeof LANE_COLORS[0]> = {};
    names.forEach((n, i) => { m[n] = LANE_COLORS[i % LANE_COLORS.length]; });
    return m;
  }, [s.props, stays]);

  const tk = todayKey();
  const nDays = daysInMonth(mk);
  const monthStart = mk + '-01';
  const monthEnd = addMonth(mk, 1) + '-01';


  const occ = useMemo(() => {
    let nights = 0;
    const seen = new Set<string>();
    stays.forEach((x) => {
      const n = nightsInRange(x, monthStart, monthEnd);
      if (n > 0) { nights += n; seen.add(x.prop + '·' + x.unit); }
    });
    /* Capacity counts the units actually let this month, not the property list:
       "Spira 3028" covers several flats and routinely runs two stays at once, so
       a per-property denominator would report 200% occupancy as 100%. */
    /* With one unit picked the denominator is that single flat; otherwise it is
       however many were actually let this month. */
    const nUnits = unit !== 'All'
      ? 1
      : Math.max(seen.size, prop === 'All' ? s.props.length : 1, 1);
    return Math.round((nights / (nUnits * nDays)) * 100);
  }, [stays, mk, s.props, prop, unit]);

  /* Months in the strip: everything the data touches, plus the current month
     and three ahead so a forward booking is always reachable. */
  const months = useMemo(() => {
    /* One unbroken run from the first stay to three months past the last —
       a month with no bookings still gets its chip. */
    const keys = [curMonthKey(), mk];
    stays.forEach((x) => { keys.push(x.inK.slice(0, 7)); keys.push(x.outK.slice(0, 7)); });
    keys.sort();
    const first = keys[0];
    const last = addMonth(keys[keys.length - 1], 3);
    const out: string[] = [];
    for (let k = first; k <= last && out.length < 120; k = addMonth(k, 1)) out.push(k);
    return out;
  }, [stays, mk]);

  const weeks = useMemo(() => buildWeekSegments(mk, stays), [mk, stays]);

  const day = useMemo(() => {
    if (!sel) return null;
    return {
      arrivals: stays.filter((x) => x.inK === sel),
      departures: stays.filter((x) => x.outK === sel),
      inHouse: stays.filter((x) => x.inK < sel && x.outK > sel),
    };
  }, [stays, sel]);

  /* Tapping a date grows that cell into the full-screen hourly DayView. */
  const rootRef = useRef<React.ComponentRef<typeof View>>(null);
  const cellRefs = useRef<Record<string, React.ComponentRef<typeof View> | null>>({});
  const progress = useSharedValue(0);
  const [gridW, setGridW] = useState(0);

  /* Swipe the month grid left/right to change month. The grid follows the
     finger, then slides out and the new month slides in from the other side.
     Only horizontal drags are claimed, so taps and vertical scrolling work as
     before. */
  const swipeX = useSharedValue(0);
  const mkRef = useRef(mk); mkRef.current = mk;
  const wRef = useRef(0); wRef.current = gridW;
  const busySwipe = useRef(false);
  const goMonth = (dir: 1 | -1) => {
    if (busySwipe.current) return;
    busySwipe.current = true;
    const w = wRef.current || 360;
    swipeX.value = withTiming(-dir * w, { duration: 160, easing: Easing.in(Easing.quad) });
    setTimeout(() => {
      setMk(addMonth(mkRef.current, dir));
      swipeX.value = dir * w;
      swipeX.value = withSpring(0, { damping: 20, stiffness: 190 });
      busySwipe.current = false;
    }, 170);
  };
  const swipe = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
    onPanResponderMove: (_, g) => { if (!busySwipe.current) swipeX.value = g.dx * 0.9; },
    onPanResponderRelease: (_, g) => {
      const w = wRef.current || 360;
      if (g.dx < -w * 0.22 || g.vx < -0.6) goMonth(1);
      else if (g.dx > w * 0.22 || g.vx > 0.6) goMonth(-1);
      else swipeX.value = withSpring(0, { damping: 18, stiffness: 220 });
    },
    onPanResponderTerminate: () => { swipeX.value = withSpring(0); },
  })).current;
  const swipeStyle = useAnimatedStyle(() => (Math.abs(swipeX.value) < 0.5 ? { transform: [], opacity: 1 } : {
    transform: [{ translateX: swipeX.value }],
    opacity: interpolate(Math.abs(swipeX.value), [0, (wRef.current || 360)], [1, 0.3]),
  }));
  const [dayOpen, setDayOpen] = useState<{ k: string; from: Rect; area: { w: number; h: number } } | null>(null);
  const openDay = (k: string) => {
    setSel(k);
    const cell = cellRefs.current[k];
    const root = rootRef.current;
    if (!cell || !root) return;
    root.measureInWindow((rx, ry, rw, rh) => {
      cell.measureInWindow((cx, cy, cw, ch) => {
        setDayOpen({ k, from: { x: cx - rx, y: cy - ry, w: cw, h: ch }, area: { w: rw, h: rh } });
        playOpen(progress);
      });
    });
  };
  const closeDayView = () => closeDay(progress, () => setDayOpen(null));
  /* Prev/next day inside the view; follow into the neighbouring month. */
  const stepDay = (k: string) => {
    setSel(k);
    if (k.slice(0, 7) !== mk) setMk(k.slice(0, 7));
    setDayOpen((o) => (o ? { ...o, k } : o));
  };
  /* Same hue per property either way: past stays in its light tint, current
     and upcoming ones in its dark shade with white text; money still due
     keeps a solid red so it stands out. */
  const toneOf = (x: Stay) => {
    const base = colorOf[x.prop] || LANE_COLORS[0];
    if (x.outK <= tk) return past(base);
    return solid(x.pending > 0 ? PENDING : base);
  };
  /* The month sinks back while a day is open — the depth half of the 3D move. */
  /* On phones the grid only shrinks and fades out completely: a 3D-transformed
     sibling is depth-sorted by iOS, which drew the month grid THROUGH the open
     day view (the zIndex is ignored inside a 3D rendering context). */
  const NATIVE = Platform.OS !== 'web';
  const depth = useAnimatedStyle(() => (progress.value < 0.001 ? { opacity: 1, transform: [] } : NATIVE ? {
    opacity: interpolate(progress.value, [0, 0.6], [1, 0], 'clamp'),
    transform: [{ scale: interpolate(progress.value, [0, 1], [1, 0.94]) }],
  } : {
    opacity: interpolate(progress.value, [0, 1], [1, 0.35]),
    transform: [
      { perspective: 1200 },
      { scale: interpolate(progress.value, [0, 1], [1, 0.9]) },
      { rotateX: interpolate(progress.value, [0, 1], [0, -6]) + 'deg' },
    ],
  }));

  /* Tapping a booking shows it, it does not open it for editing. A calendar is
     something you read; dropping into a form full of inputs on a stray tap is
     how a wrong value gets saved. Editing is still one deliberate tap away,
     from inside the detail sheet. */
  const showStay = (x: Stay) => { setSheet(false); setStay(x); };

  /* Leaving for the edit form is a two-step move, and the order is the whole
     point.

     A Sheet is a native Modal — its own window on iOS and Android, sitting
     above the app. Switching tabs hides this screen with `display: none`
     (every tab stays mounted so drafts survive). Closing the sheet and
     switching tabs in the same commit therefore asks the platform to dismiss a
     modal whose host view is being torn out from under it in the same frame —
     and the dismissal is dropped. The window stays attached, transparent and
     empty, on top of everything. The calendar underneath renders perfectly and
     nothing is tappable, because every touch lands on that dead window.

     So: close the sheet, let the dismissal actually finish, and only then
     switch tabs. */
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current); }, []);

  const editStay = (row: number) => {
    const o = s.logs?.bookings?.rows?.find((y) => y.r === row);
    if (!o || !s.addSegs.includes('book')) return;   // no booking rights → no form to open
    setSheet(false);
    setStay(null);
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      s.setEditB({ row, bookingId: String(o.cells[18] || ''), from: 'blog', cells: o.cells });
      s.setAddSeg('book');
      s.setTab('add');
    }, SHEET_DISMISS_MS);
  };

  /* Belt and braces for every other way out of this tab (the tab bar itself,
     mostly): if the screen is re-entered with a sheet still open, close it
     here — on the way *in*, while the subtree is visible again, so the modal
     dismisses against a live host rather than a hidden one. Returning to a
     stale sheet you opened ten minutes ago is not wanted either way. */
  useEffect(() => {
    if (s.tab === 'cal') { setSheet(false); setStay(null); }
  }, [s.tab]);

  return (
    <View style={{ flex: 1 }} ref={rootRef} collapsable={false}>
      <Animated.View style={[{ flex: 1 }, depth]} pointerEvents={dayOpen ? 'none' : 'auto'}>
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* month strip — the year lives on the chips, not over them */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.hScroll} contentContainerStyle={st.strip}>
          {months.map((k, i) => {
            const on = k === mk;
            const yearStart = i === 0 || k.slice(5, 7) === '01';
            return (
              <TouchableOpacity
                key={k}
                style={[st.mChip, on && st.mChipOn]}
                onPress={() => setMk(k)}
                activeOpacity={0.7}
              >
                <Text style={[st.mTxt, on && st.mTxtOn]}>
                  {MON_SHORT[Number(k.slice(5, 7)) - 1]}{yearStart ? ' ’' + k.slice(2, 4) : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {units.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.hScroll} contentContainerStyle={st.propRow}>
            <Text style={st.scopeLbl}>UNIT</Text>
            {['All', ...units].map((u) => {
              const on = u === unit;
              return (
                <TouchableOpacity
                  key={u}
                  style={[st.pChip, on && st.uChipOn]}
                  onPress={() => setUnit(u)}
                  activeOpacity={0.7}
                >
                  <Text style={[st.pTxt, on && st.uTxtOn]}>{u === 'All' ? 'All units' : u}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        <View style={st.headWrap}>
          <View style={st.headRow}>
            <Text style={st.month}>{monthTitle(mk)}</Text>
            <View style={{ flex: 1 }} />
            {mk !== curMonthKey() ? (
              <TouchableOpacity style={st.today} onPress={() => { setMk(curMonthKey()); setSel(tk); }} activeOpacity={0.7}>
                <Text style={st.todayTxt}>Today</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {/* An unlabelled bar is a riddle: say what it measures. */}
          <View style={st.occRow}>
            <View style={st.track}>
              <View style={[st.fill, { width: pct(Math.min(100, Math.max(0, occ))) }]} />
            </View>
            <Text style={st.occTxt}><Text style={st.occPct}>{occ}%</Text> of nights booked</Text>
          </View>
        </View>

        <View style={st.wdRow}>
          {WD.map((d, i) => <Text key={i} style={st.wd}>{d}</Text>)}
        </View>

        <Animated.View style={[st.grid, swipeStyle]} onLayout={(e) => setGridW(e.nativeEvent.layout.width)} {...swipe.panHandlers}>
          {weeks.map((w, wi) => {
            const shown = w.lanes.slice(0, MAX_LANES);
            const hidden = countHidden(w, MAX_LANES);
            const rows = shown.length + (Object.keys(hidden).length ? 1 : 0);
            const h = Math.max(CELL_MIN_H, DATE_H + rows * (BAR_H + BAR_GAP) + 8);
            return (
              <View key={wi} style={[st.week, { minHeight: h }]}>
                {/* the cells: borders, date number, and the tap target for the
                    day sheet. Bars are drawn over them. */}
                {w.days.map((k, ci) => (
                  <TouchableOpacity
                    key={ci}
                    ref={(r: any) => { if (k) cellRefs.current[k] = r; }}
                    style={[st.cell, !k && st.cellDead, k === sel && st.cellSel]}
                    activeOpacity={k ? 0.75 : 1}
                    disabled={!k}
                    onPress={() => k && openDay(k)}
                  >
                    {k ? (
                      <View style={[st.dateWrap, k === tk && st.dateToday]}>
                        <Text style={[st.date, k < tk && st.datePast, k === tk && st.dateTodayTxt]}>
                          {Number(k.slice(8))}
                        </Text>
                      </View>
                    ) : null}
                    {k && hidden[k] ? <View style={st.more}><Text style={st.moreTxt}>+{hidden[k]}</Text></View> : null}
                  </TouchableOpacity>
                ))}

                {shown.map((lane, li) =>
                  lane.map((sg) => {
                    const x = sg.stay;
                    const cc: any = toneOf(x);
                    const left = (sg.from / 7) * 100;
                    const width = ((sg.to - sg.from) / 7) * 100;
                    /* Name only where it fits; initials on a short stay; a plain
                       colour chip on a sliver. Full names are in the day view. */
                    const px = ((sg.to - sg.from) / 7) * gridW;
                    const nm = x.guest || x.id;
                    const label = px >= 74 ? (sg.realStart ? '' : '‹ ') + nm : px >= 24 ? initials(nm) : '';
                    return (
                      <TouchableOpacity
                        key={x.row}
                        activeOpacity={0.7}
                        onPress={() => showStay(x)}
                        style={[
                          st.bar,
                          {
                            backgroundColor: cc.bg,
                            borderColor: cc.line,
                            opacity: cc.dim ? 0.8 : 1,
                            top: DATE_H + li * (BAR_H + BAR_GAP),
                            left: pct(left),
                            width: pct(width),
                            borderTopLeftRadius: sg.realStart ? 5 : 0,
                            borderBottomLeftRadius: sg.realStart ? 5 : 0,
                            borderTopRightRadius: sg.realEnd ? 5 : 0,
                            borderBottomRightRadius: sg.realEnd ? 5 : 0,
                            borderLeftWidth: sg.realStart ? 1 : 0,
                            borderRightWidth: sg.realEnd ? 1 : 0,
                          },
                        ]}
                      >
                        <Text style={[st.barTxt, { color: cc.fg }]} numberOfLines={1}>
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            );
          })}
        </Animated.View>

        {undated > 0 ? (
          <Text style={st.note}>
            {undated} booking{undated === 1 ? '' : 's'} with no check-in date {undated === 1 ? 'is' : 'are'} not shown —
            {' '}the booking date says when it was paid, not when anyone stayed.
          </Text>
        ) : null}
      </ScrollView>
      </Animated.View>

      {dayOpen ? (
        <DayView
          dayKey={dayOpen.k}
          stays={stays}
          from={dayOpen.from}
          area={dayOpen.area}
          progress={progress}
          toneOf={toneOf}
          onClose={closeDayView}
          onOpen={showStay}
          onDay={stepDay}
        />
      ) : null}

      {/* Read-only booking detail. Everything the row holds about the stay, and
          one button for the one thing that changes it. */}
      <Sheet
        visible={!!stay}
        title={stay ? (stay.guest || stay.id) : ''}
        value={stay ? (stay.sameDay ? 'Day use' : stay.nights + ' night' + (stay.nights === 1 ? '' : 's')) + ' · ' + inr(stay.net) : ''}
        onClose={() => setStay(null)}
      >
        {stay ? <StayDetail x={stay} onEdit={() => editStay(stay.row)} /> : null}
      </Sheet>
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={st.dRow}>
      <Text style={st.dLbl}>{label}</Text>
      <Text style={[st.dVal, tone ? { color: tone } : null]}>{value || '—'}</Text>
    </View>
  );
}

function StayDetail({ x, onEdit }: { x: Stay; onEdit: () => void }) {
  const when = (k: string, t: string) => ciFmtDay(keyToDate(k)) + (t ? ' · ' + t : '');
  return (
    <View>
      <View style={st.dHead}>
        <View style={st.dPill}>
          <Text style={st.dPillLbl}>BOOKING</Text>
          <Text style={st.dPillTxt} numberOfLines={1}>{x.prop || '—'}</Text>
        </View>
        <View style={[st.dPill, st.dPillGold]}>
          <Text style={[st.dPillLbl, { color: C.blue2 }]}>STAY UNIT</Text>
          <Text style={[st.dPillTxt, { color: C.blue2 }]} numberOfLines={1}>{x.unit || '—'}</Text>
        </View>
        {x.channel ? (
          <View style={st.dSrc}><Text style={st.dSrcTxt}>{x.channel}</Text></View>
        ) : null}
      </View>

      <Row label="Check-in" value={when(x.inK, x.inT)} tone={C.navy} />
      <Row
        label="Check-out"
        value={x.assumedOut ? 'not recorded' : when(x.outK, x.outT)}
        tone={x.assumedOut ? C.muted : C.navy}
      />
      {/* A day-use booking really is zero nights; saying "0" alone reads like a
          missing value. */}
      <Row label="Nights" value={x.sameDay ? 'Day use · 0 nights' : String(x.nights)} />
      <Row label="Guests" value={x.guests ? String(x.guests) : ''} />
      {x.coGuest ? <Row label="Co-guest" value={x.coGuest} /> : null}
      <Row label="Type" value={x.type} />
      {x.type === 'Resold' && x.referrer ? <Row label="Resold" value={x.referrer} tone={C.blue2} /> : null}
      {x.type !== 'Resold' && x.referrer ? <Row label="Source" value={x.referrer} /> : null}
      <Row label="Total paid" value={x.paid ? inr(x.paid) : ''} />
      <Row label="Net earning" value={inr(x.net)} tone={C.green} />
      <Row label="Awaiting payout" value={x.pending > 0 ? inr(x.pending) : '—'} tone={x.pending > 0 ? C.red : C.muted} />
      {x.notes ? <Row label="Notes" value={x.notes} /> : null}

      <BookingChecklist row={x.row} />

      <Btn title="Edit this booking" onPress={onEdit} style={{ marginTop: 16 }} />
    </View>
  );
}

/* ── layout ────────────────────────────────────────────────────────────────
   A stay becomes one segment per week it touches. `from`/`to` are in columns,
   fractional: 3.85 means "day 3, 85% of the way across", which is how a 10pm
   arrival ends up hugging the right edge of its cell. */
type Seg = {
  stay: Stay; from: number; to: number;
  realStart: boolean; realEnd: boolean;   // does the stay begin / end in this week
};

/* '10:30 AM' -> 0.4375 of the way through the day. Anything unparseable is
   midday: the record does not say, and the bar should not pretend it does. */
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

function buildWeekSegments(mk: string, stays: Stay[]) {
  const [y, m] = mk.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const n = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= n; d++) cells.push(mk + '-' + z(d));
  while (cells.length % 7) cells.push(null);

  const weeks: { days: (string | null)[]; lanes: Seg[][] }[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const days = cells.slice(i, i + 7);
    const first = days.find(Boolean) as string | undefined;
    const last = [...days].reverse().find(Boolean) as string | undefined;
    const lanes: Seg[][] = [];
    if (first && last) {
      const segs: Seg[] = [];
      stays.forEach((stay) => {
        /* Half-open at the start of the week: a stay that checked out on the
           first day of it did still occupy part of that day, so it belongs —
           but one that ended before the week began does not. */
        if (stay.outK < first || stay.inK > last) return;
        const startsHere = stay.inK >= first;
        const endsHere = stay.outK <= last;
        const c0 = startsHere ? days.indexOf(stay.inK) : 0;
        const c1 = endsHere ? days.indexOf(stay.outK) : 6;
        if (c0 < 0 || c1 < 0) return;
        const from = startsHere ? c0 + timeFrac(stay.inT) : 0;
        /* A departure with no recorded time lands at midday; one at 11:59pm
           still stops just short of the cell edge (EDGE), so the day it ends on
           never looks fully occupied when it was not. */
        const to = endsHere ? c1 + timeFrac(stay.outT) : 7;
        segs.push({ stay, from, to: Math.max(from + 0.18, to), realStart: startsHere, realEnd: endsHere });
      });
      /* Greedy sweep: earliest start first, then longest, each dropping into the
         first lane whose last bar has already finished. */
      segs.sort((a, b) => (a.from - b.from) || (b.to - a.to));
      segs.forEach((sg) => {
        let lane = lanes.find((L) => L[L.length - 1].to <= sg.from);
        if (!lane) { lane = []; lanes.push(lane); }
        lane.push(sg);
      });
    }
    weeks.push({ days, lanes });
  }
  return weeks;
}

/* Stays that did not fit inside the lane cap, counted per day so the cell can
   say "+2" exactly where they were dropped — never a silent truncation. */
function countHidden(w: { days: (string | null)[]; lanes: Seg[][] }, cap: number) {
  const out: Record<string, number> = {};
  w.lanes.slice(cap).forEach((lane) => {
    lane.forEach((sg) => {
      for (let c = Math.floor(sg.from); c <= Math.min(6, Math.ceil(sg.to) - 1); c++) {
        const k = w.days[c];
        if (k) out[k] = (out[k] || 0) + 1;
      }
    });
  });
  return out;
}

function dayValue(day: { arrivals: Stay[]; departures: Stay[]; inHouse: Stay[] } | null) {
  if (!day) return '';
  const bits: string[] = [];
  if (day.arrivals.length) bits.push(day.arrivals.length + ' arriving');
  if (day.departures.length) bits.push(day.departures.length + ' leaving');
  if (day.inHouse.length) bits.push(day.inHouse.length + ' staying');
  return bits.length ? bits.join(' · ') : 'Free';
}

function DayGroup({ title, items, kind, colorOf, onOpen }: {
  title: string; items: Stay[]; kind: 'in' | 'out' | 'stay';
  colorOf: Record<string, typeof LANE_COLORS[0]>;
  onOpen: (x: Stay) => void;
}) {
  if (!items.length) return null;
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={st.grpTitle}>{title} · {items.length}</Text>
      {items.map((x) => {
        const cc = colorOf[x.prop] || LANE_COLORS[0];
        const when = kind === 'in' ? x.inT : kind === 'out' ? x.outT : '';
        return (
          <TouchableOpacity key={kind + x.row} style={st.stayRow} activeOpacity={0.75} onPress={() => onOpen(x)}>
            <View style={[st.stayDot, { backgroundColor: cc.line }]} />
            <View style={{ flex: 1 }}>
              <Text style={st.stayName} numberOfLines={1}>{x.guest || x.id}</Text>
              <Text style={st.staySub} numberOfLines={1}>
                {x.prop}{x.unit ? ' · Unit ' + x.unit : ''} ·{' '}
                {x.sameDay ? 'day use' : x.nights + ' night' + (x.nights === 1 ? '' : 's')}
                {x.channel ? ' · ' + x.channel : ''}
              </Text>
              <Text style={st.stayDates} numberOfLines={1}>
                {x.sameDay
                  ? ciFmtDay(keyToDate(x.inK)) + (x.inT && x.outT ? ' · ' + x.inT + ' → ' + x.outT : '')
                  : ciFmtDay(keyToDate(x.inK)) + ' → ' + ciFmtDay(keyToDate(x.outK))}
                {x.assumedOut ? ' · no check-out recorded' : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {when ? <Text style={st.stayWhen}>{when}</Text> : null}
              <Text style={st.stayNet}>{inr(x.net)}</Text>
              {x.pending > 0 ? <Text style={st.stayPend}>{inr(x.pending)} due</Text> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  /* Horizontal rows never grow vertically — they used to absorb the spare
     height of a short page as big empty bands. */
  hScroll: { flexGrow: 0, flexShrink: 0 },
  strip: { paddingHorizontal: 12, paddingTop: 16, gap: 8, alignItems: 'center' },
  mChip: {
    paddingVertical: 7, paddingHorizontal: 17, borderRadius: 999,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
  },
  mChipOn: { backgroundColor: C.navy, borderColor: C.navy },
  mTxt: { fontFamily: F.semi, fontSize: 13, color: C.bark },
  mTxtOn: { color: '#fff', fontFamily: F.bold },
  year: { fontFamily: F.bold, fontSize: 14, color: C.muted, marginLeft: 8 },

  propRow: { paddingHorizontal: 12, paddingTop: 10, gap: 8, alignItems: 'center' },
  pChip: {
    paddingVertical: 6, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1, borderColor: C.line, backgroundColor: C.card,
  },
  pChipOn: { backgroundColor: C.amberbg, borderColor: C.copper },
  uChipOn: { backgroundColor: C.skybg, borderColor: C.sky },
  uTxtOn: { color: C.sky, fontFamily: F.bold },
  scopeLbl: { fontFamily: F.semi, fontSize: 9, color: C.muted, letterSpacing: 0.9, marginRight: 2 },
  pTxt: { fontFamily: F.semi, fontSize: 12, color: C.bark },
  pTxtOn: { color: C.blue2, fontFamily: F.bold },

  headWrap: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  month: { fontFamily: F.xbold, fontSize: 20, color: C.ink, letterSpacing: -0.4 },
  occRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  occTxt: { fontFamily: F.semi, fontSize: 11.5, color: C.bark },
  occPct: { fontFamily: F.xbold, color: C.green },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: C.hair, overflow: 'hidden' },
  fill: { height: 5, backgroundColor: C.green, borderRadius: 3 },
  today: { paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.navy },
  todayTxt: { color: '#fff', fontFamily: F.semi, fontSize: 11 },

  wdRow: { flexDirection: 'row', paddingBottom: 6 },
  wd: { flex: 1, textAlign: 'center', fontFamily: F.semi, fontSize: 11, color: C.muted },

  /* Hairline boxes, like a wall planner: the borders do the separating, so the
     cells themselves stay plain. */
  grid: { borderTopWidth: 1, borderTopColor: C.line },
  week: { flexDirection: 'row', position: 'relative' },
  cell: {
    flex: 1, minHeight: CELL_MIN_H,
    borderBottomWidth: 1, borderRightWidth: 1, borderColor: C.line,
    paddingHorizontal: 3, paddingTop: 4, paddingBottom: 3,
    backgroundColor: C.card,
  },
  cellDead: { backgroundColor: C.warm },
  cellSel: { backgroundColor: '#FBF7EF' },

  dateWrap: {
    alignSelf: 'flex-start', minWidth: 21, height: 21, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  dateToday: { backgroundColor: C.green },
  date: { fontFamily: F.semi, fontSize: 12, color: C.ink },
  datePast: { color: '#B9B8BE' },
  dateTodayTxt: { color: '#fff', fontFamily: F.bold },

  bar: {
    position: 'absolute', height: BAR_H, justifyContent: 'center',
    borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: 5,
  },
  barTxt: { fontFamily: F.semi, fontSize: 9.5 },
  /* Sits on the date line, so it reads as "this day has more". */
  more: {
    position: 'absolute', top: 5, right: 3, minWidth: 20, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: C.bone, alignItems: 'center', justifyContent: 'center',
  },
  moreTxt: { fontFamily: F.bold, fontSize: 9.5, color: C.bark },

  empty: { fontFamily: F.med, fontSize: 12.5, color: C.muted, marginTop: 10 },
  grpTitle: {
    fontFamily: F.bold, fontSize: 11.5, color: C.muted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
  },
  stayRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.hair,
  },
  stayDot: { width: 8, height: 34, borderRadius: 4 },
  stayName: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  staySub: { fontFamily: F.med, fontSize: 11.5, color: C.muted, marginTop: 2 },
  stayDates: { fontFamily: F.med, fontSize: 11, color: C.bark, marginTop: 2 },
  stayWhen: { fontFamily: F.bold, fontSize: 12, color: C.navy },
  stayNet: { fontFamily: F.bold, fontSize: 13, color: C.green, marginTop: 2 },
  stayPend: { fontFamily: F.semi, fontSize: 10.5, color: C.red, marginTop: 1 },

  note: { fontFamily: F.med, fontSize: 11.5, color: C.muted, margin: 14, lineHeight: 17 },

  dHead: { flexDirection: 'row', gap: 8, marginTop: 4, marginBottom: 8 },
  dPill: { flex: 1, backgroundColor: C.bone, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 },
  dPillGold: { backgroundColor: C.amberbg, borderWidth: 1, borderColor: C.copper },
  dPillLbl: { fontFamily: F.semi, fontSize: 9, color: C.muted, letterSpacing: 0.9 },
  dPillTxt: { fontFamily: F.bold, fontSize: 14.5, color: C.ink, marginTop: 3 },
  dSrc: { justifyContent: 'center', backgroundColor: C.navy, borderRadius: 12, paddingHorizontal: 12 },
  dSrcTxt: { fontFamily: F.bold, fontSize: 11.5, color: '#fff' },
  dRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.hair, gap: 14,
  },
  dLbl: { fontFamily: F.med, fontSize: 12.5, color: C.muted },
  dVal: { fontFamily: F.bold, fontSize: 14, color: C.ink, flexShrink: 1, textAlign: 'right' },
});
