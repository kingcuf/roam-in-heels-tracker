// Airbnb-style earnings calendar — replaces the Today / Upcoming / Daily
// Earnings sections on the Dashboard. Booking dates carry the day's net as a
// label; check-ins show as guest-initial bubbles; past days are grey-filled,
// today gets a filled circle, future days are white-bordered. Tapping dates
// multi-selects; the floating bar aggregates and opens the detail sheet.
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, inr } from './theme';
import { CalData, CalDay, CI_MON, thisMonthIso, todayIso } from './logic';
import { H4, Hint, Panel, Sheet, SumLine } from './ui';

const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WD = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const z = (n: number) => (n < 10 ? '0' : '') + n;
const todayKey = todayIso;
const curMonthKey = thisMonthIso;
export function addMonth(mk: string, n: number) {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + z(d.getMonth() + 1);
}
export function monthTitle(mk: string) {
  const [y, m] = mk.split('-').map(Number);
  return MONTH_FULL[m - 1] + ' ' + y;
}
export function fmtDayKey(k: string) {
  const [y, m, d] = k.split('-').map(Number);
  return d + ' ' + CI_MON[m - 1] + ' ' + y;
}
// compact ₹ for the tiny day cells: ₹950 · ₹3.2K · ₹1.5L
export function kfmt(n: number) {
  const neg = n < 0 ? '-' : '';
  const a = Math.abs(n);
  const t = (x: number) => {
    const s = (Math.round(x * 10) / 10).toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  };
  if (a >= 100000) return neg + '₹' + t(a / 100000) + 'L';
  if (a >= 1000) return neg + '₹' + t(a / 1000) + 'K';
  return neg + '₹' + Math.round(a);
}

export function buildWeeks(mk: string): (number | null)[][] {
  const [y, m] = mk.split('-').map(Number);
  const lead = new Date(y, m - 1, 1).getDay();
  const nDays = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= nDays; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/* aggregate the selected dates (skips dates with no data) */
export function calAggregate(cal: CalData, sel: Set<string>) {
  let net = 0, comm = 0, pending = 0, bk = 0, ci = 0;
  const byDate: { k: string; day: CalDay }[] = [];
  Array.from(sel).sort().forEach((k) => {
    const day = cal.days[k];
    if (!day) return;
    net += day.net; comm += day.comm; pending += day.pending;
    bk += day.bookings.length; ci += day.checkins.length;
    byDate.push({ k, day });
  });
  return { net, comm, pending, bk, ci, byDate };
}

/* ── the month grid ── */
export function EarningsCalendar({ cal, sel, onToggle }: {
  cal: CalData; sel: Set<string>; onToggle: (k: string) => void;
}) {
  const cur = curMonthKey();
  const [mk, setMk] = useState(cur);
  const tk = todayKey();
  const minMk = cal.minMonth && cal.minMonth < cur ? cal.minMonth : cur;
  const maxMk = cal.maxMonth && cal.maxMonth > cur ? cal.maxMonth : cur;
  const weeks = buildWeeks(mk);

  return (
    <Panel>
      {/* month pager */}
      <View style={st.nav}>
        <TouchableOpacity
          style={[st.navBtn, mk <= minMk && st.navBtnOff]} disabled={mk <= minMk}
          onPress={() => setMk(addMonth(mk, -1))} activeOpacity={0.7}
        >
          <Text style={st.navChev}>‹</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          <Text style={st.navTitle}>{monthTitle(mk)}</Text>
          {mk !== cur && (
            <TouchableOpacity onPress={() => setMk(cur)} style={st.todayJump} activeOpacity={0.7}>
              <Text style={{ color: C.blue, fontSize: 11, fontFamily: F.bold }}>Today</Text>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[st.navBtn, mk >= maxMk && st.navBtnOff]} disabled={mk >= maxMk}
          onPress={() => setMk(addMonth(mk, 1))} activeOpacity={0.7}
        >
          <Text style={st.navChev}>›</Text>
        </TouchableOpacity>
      </View>

      {/* weekday header */}
      <View style={{ flexDirection: 'row' }}>
        {WD.map((w, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ fontSize: 11, color: C.muted, fontFamily: F.semi }}>{w}</Text>
          </View>
        ))}
      </View>

      {/* day grid */}
      {weeks.map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row' }}>
          {week.map((d, di) => {
            if (d == null) return <View key={di} style={st.cellEmpty} />;
            const k = mk + '-' + z(d);
            const day = cal.days[k];
            const isToday = k === tk, isPast = k < tk, seld = sel.has(k);
            return (
              <Pressable
                key={di}
                onPress={() => onToggle(k)}
                style={[st.cell, isPast && st.cellPast, seld && st.cellSel]}
              >
                <View style={[st.numWrap, isToday && st.todayCircle]}>
                  <Text style={[st.num, isPast && !isToday && { color: C.muted }, isToday && { color: '#fff' }]}>
                    {d}
                  </Text>
                </View>
                {!!day && day.bookings.length > 0 && (
                  <Text style={st.amt} numberOfLines={1}>{kfmt(day.net)}</Text>
                )}
                {!!day && day.pending > 0 && (
                  <Text style={st.pend} numberOfLines={1}>{kfmt(day.pending)}</Text>
                )}
                {!!day && day.checkins.length > 0 && <View style={st.ciDot} />}
              </Pressable>
            );
          })}
        </View>
      ))}

      <Hint>
        ₹ = net booked that day · red = payment still due · gold dot = check-in that day.
        Tap dates to select (tap again to unselect) — the bar below aggregates and opens the details.
      </Hint>
    </Panel>
  );
}

/* ── floating selection bar (render OUTSIDE the ScrollView) ── */
export function CalendarBar({ cal, sel, onClear, onDetails }: {
  cal: CalData; sel: Set<string>; onClear: () => void; onDetails: () => void;
}) {
  if (!sel.size) return null;
  const ag = calAggregate(cal, sel);
  return (
    <View style={st.bar}>
      <View style={{ flex: 1 }}>
        <Text style={st.barVal}>{inr(ag.net)}</Text>
        <Text style={st.barSub} numberOfLines={1}>
          {sel.size} {sel.size === 1 ? 'date' : 'dates'} · {ag.bk} bk · comm {inr(ag.comm)}
          {ag.pending > 0 ? ' · due ' + inr(ag.pending) : ''}
        </Text>
      </View>
      <TouchableOpacity style={st.barBtn} onPress={onDetails} activeOpacity={0.8}>
        <Text style={{ color: C.navy, fontSize: 13, fontFamily: F.bold }}>Details</Text>
      </TouchableOpacity>
      <TouchableOpacity style={st.barX} onPress={onClear} activeOpacity={0.8}>
        <Text style={{ color: '#fff', fontSize: 17, lineHeight: 20 }}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

/* ── detail bottom sheet: totals + booking-wise breakdown per date ── */
export function CalendarSheet({ cal, sel, visible, onClose }: {
  cal: CalData; sel: Set<string>; visible: boolean; onClose: () => void;
}) {
  const ag = calAggregate(cal, sel);
  const keys = Array.from(sel).sort();
  const title = keys.length === 1 ? fmtDayKey(keys[0]) : keys.length + ' dates selected';
  return (
    <Sheet visible={visible} title={title} value={inr(ag.net)} onClose={onClose}>
      <SumLine label="Bookings" amt={String(ag.bk)} raw />
      <SumLine label="Total earning (net)" amt={ag.net} />
      <SumLine label="Total commission" amt={ag.comm} />
      <SumLine label="Pending (awaiting payment)" amt={ag.pending} tot />
      {ag.byDate.length === 0 && (
        <Text style={{ color: '#bbb', fontSize: 13, paddingVertical: 10 }}>
          No bookings or check-ins on the selected date{keys.length === 1 ? '' : 's'}.
        </Text>
      )}
      {ag.byDate.map(({ k, day }) => (
        <View key={k}>
          <H4>{fmtDayKey(k)}{day.net ? '  ·  ' + inr(day.net) : ''}</H4>
          {day.bookings.map((b, i) => (
            <View key={'b' + i} style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowG}>{b.guest || '—'}</Text>
                <Text style={st.rowS} numberOfLines={1}>
                  {b.type}{b.channel ? ' · ' + b.channel : ''} · {b.prop} · {b.id}
                  {b.pending > 0 ? ' · pending ' + inr(b.pending) : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: F.bold, color: C.blue }}>{inr(b.net)}</Text>
                {b.comm !== 0 && <Text style={st.rowS}>comm {inr(b.comm)}</Text>}
              </View>
            </View>
          ))}
          {day.checkins.map((c2, i) => (
            <View key={'c' + i} style={st.row}>
              <View style={{ flex: 1 }}>
                <Text style={st.rowG}>
                  {c2.guest || '—'} <Text style={{ color: C.blue, fontSize: 11, fontFamily: F.bold }}>· check-in</Text>
                </Text>
                <Text style={st.rowS} numberOfLines={1}>
                  {c2.prop}{c2.inT ? ' · ' + c2.inT : ''}{c2.outT ? ' → ' + c2.outT : ''} · {c2.id}
                </Text>
              </View>
              {!!c2.net && <Text style={{ fontFamily: F.semi, color: C.ink }}>{inr(c2.net)}</Text>}
            </View>
          ))}
        </View>
      ))}
      <Hint>Earnings anchor on the booking date (same basis as the old Daily Earnings chart); check-ins on the check-in date.</Hint>
    </Sheet>
  );
}

const st = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  navBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: C.bone,
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnOff: { opacity: 0.35 },
  navChev: { fontSize: 20, color: C.ink, lineHeight: 24, fontFamily: F.bold },
  navTitle: { fontSize: 16, fontFamily: F.xbold, color: C.ink },
  todayJump: { backgroundColor: C.amberbg, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },

  cellEmpty: { flex: 1, margin: 1.5 },
  cell: {
    flex: 1, margin: 1.5, minHeight: 62, borderRadius: 12, paddingVertical: 5, paddingHorizontal: 1,
    alignItems: 'center', backgroundColor: '#fff', borderWidth: 1, borderColor: C.line, gap: 2,
  },
  cellPast: { backgroundColor: C.bone, borderColor: C.bone },
  cellSel: { borderColor: C.blue, borderWidth: 2, backgroundColor: C.amberbg },
  numWrap: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  todayCircle: { backgroundColor: C.navy },
  num: { fontSize: 13, fontFamily: F.semi, color: C.ink },
  amt: { fontSize: 10, fontFamily: F.bold, color: C.bark },
  pend: { fontSize: 9, fontFamily: F.bold, color: C.red },
  ciDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.blue },

  bar: {
    position: 'absolute', left: 14, right: 14, bottom: 12,
    backgroundColor: C.navy, borderRadius: 18, paddingVertical: 11, paddingHorizontal: 15,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    shadowColor: C.navy, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  barVal: { color: '#fff', fontSize: 17, fontFamily: F.xbold },
  barSub: { color: 'rgba(255,255,255,.75)', fontSize: 11, fontFamily: F.med, marginTop: 1 },
  barBtn: { backgroundColor: C.copper, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 15 },
  barX: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,.16)',
    alignItems: 'center', justifyContent: 'center',
  },

  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.hair, gap: 10,
  },
  rowG: { fontFamily: F.semi, color: C.ink },
  rowS: { fontSize: 11, color: C.muted, marginTop: 2 },
});
