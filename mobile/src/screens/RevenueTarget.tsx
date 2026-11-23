import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { C, F, inr } from '../theme';
import { useStore, authStore } from '../store';
import { api } from '../api';
import {
  shiftDay, dayKeyOf, dayWindow, revenueByDay, targetSummary, cardOf, CI_MON, RevBasis, DayRev,
} from '../logic';
import { Btn, Hint, Panel, PanelTitle, Segmented, Sheet, useToast } from '../ui';
import { Field, TxtInput } from '../fields';
import { TargetChart, kShort } from '../charts';

/* ── Daily revenue vs target ──
   "Are we making our number?" — one panel on the Report, answering it two ways
   (Booking date / Stay date, see revenueByDay) over the last 7 days, the last
   30, or the month so far.

   The window is COMPLETE days: it ends yesterday. Today is drawn on the chart,
   faded, but kept out of the average and the hit count — at 10 am today's
   bookings are a fraction of the day, and counting it would make every
   morning look like a miss.

   The target is a daily ₹ figure per Report scope ('All' or one property),
   stored on the server so every device sees the same one. Until the server
   has been updated to know about targets, it falls back to this device. */

type Win = '7' | '30' | 'mtd';
type Targets = Record<string, { daily: number; updatedAt?: string; updatedBy?: string }>;
const LOCAL_KEY = 'rih_revenue_targets';
/* Matches CalendarScreen: wait for a sheet's dismissal to finish before a tab
   switch, or the Modal is left as a dead window over the app. */
const SHEET_DISMISS_MS = 320;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (k: string) => {
  const p = k.split('-'); const d = new Date(+p[0], +p[1] - 1, +p[2]);
  return WD[d.getDay()] + ' ' + d.getDate() + ' ' + CI_MON[d.getMonth()];
};

async function readLocal(): Promise<Targets> {
  try { return JSON.parse((await authStore.getItemAsync(LOCAL_KEY)) || '{}') || {}; } catch { return {}; }
}

export default function RevenueTarget() {
  const s = useStore();
  const toast = useToast();
  const [basis, setBasis] = useState<RevBasis>('booked');
  const [win, setWin] = useState<Win>('7');
  const [sel, setSel] = useState<string | null>(null);
  const [targets, setTargets] = useState<Targets>({});
  const [localOnly, setLocalOnly] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  /* The day sheet: which day's bookings are listed. A booking opens on its
     own page (BookingPage); its back button reopens this day. */
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navTimer.current) clearTimeout(navTimer.current); }, []);
  const isAdmin = s.me?.role === 'Admin';
  const scope = s.filter || 'All';
  const scopeName = scope === 'All' ? 'All properties' : scope;

  const loadTargets = async () => {
    try {
      const r = await api.getTargets(s.pin);
      setTargets(r.targets || {});
      setLocalOnly(false);
    } catch (e: any) {
      /* An API that predates targets refuses the action by name; anything else
         (offline, timeout) keeps whatever was showing. */
      if (/unknown action/i.test(String(e?.message))) {
        setLocalOnly(true);
        setTargets(await readLocal());
      }
    }
  };
  useEffect(() => { if (s.loggedIn && s.pin) loadTargets(); }, [s.loggedIn, s.pin]);

  const target = targets[scope]?.daily ?? null;

  /* Day 1 of the month has no complete day in "this month" yet. */
  const now = new Date();
  const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = shiftDay(todayD, -1);
  const count = win === '7' ? 7 : win === '30' ? 30 : todayD.getDate() - 1;

  const by = useMemo(() => revenueByDay(s.logs?.bookings || null, scope, basis), [s.logs, scope, basis]);
  const days = useMemo(() => dayWindow(by, end, count), [by, count, dayKeyOf(end)]);
  const todayKey = dayKeyOf(todayD);
  const today: DayRev = by.days[todayKey] ? { ...by.days[todayKey] } : { key: todayKey, rev: 0, n: 0, items: [] };
  const sum = targetSummary(days, target);
  const prev = win === 'mtd' ? null : targetSummary(dayWindow(by, shiftDay(end, -count), count), target);

  /* A fresh view clears the tap; the day card then shows the latest complete day. */
  useEffect(() => { setSel(null); }, [basis, win, scope]);

  const openEdit = () => { setDraft(target ? String(target) : ''); setEditing(true); };
  const save = async (value: number | null) => {
    setSaving(true);
    try {
      if (localOnly) {
        const next = { ...targets };
        if (value === null) delete next[scope]; else next[scope] = { daily: value };
        await authStore.setItemAsync(LOCAL_KEY, JSON.stringify(next));
        setTargets(next);
      } else {
        await api.setTarget(s.pin, scope, value);
        await loadTargets();
      }
      toast(value === null ? 'Target removed' : 'Target saved', true);
      setEditing(false);
    } catch (e: any) {
      toast(String(e?.message || e), false);
    } finally {
      setSaving(false);
    }
  };
  const draftNum = parseFloat(draft);
  const draftOk = isFinite(draftNum) && draftNum > 0;

  const unit = basis === 'booked' ? ['booking', 'bookings'] : ['stay', 'stays'];
  const cardKey = sel ?? (days.length ? days[days.length - 1].key : todayKey);
  const selDay = cardKey === todayKey ? today : days.find((d) => d.key === cardKey) || null;
  const winLbl = win === '7' ? 'last 7 days' : win === '30' ? 'last 30 days' : 'this month';
  const avgLbl = win === 'mtd' ? 'the month’s average' : 'the ' + count + '-day average';
  const pctTxt = (p: number) => (p >= 100 ? '▲ ' + Math.round(p - 100) + '% above' : '▼ ' + Math.round(100 - p) + '% below');

  /* ── day sheet ── */
  const openDay = (k: string) => { setSel(k); setDayOpen(k); };
  const closeDay = () => setDayOpen(null);
  const rowsById = useMemo(() => {
    const m = new Map<number, { r: number; cells: any[] }>();
    for (const o of s.logs?.bookings?.rows || []) m.set(o.r, o);
    return m;
  }, [s.logs]);
  const openDayRev: DayRev | null = dayOpen
    ? (by.days[dayOpen] || { key: dayOpen, rev: 0, n: 0, items: [] })
    : null;
  const dayItems = (openDayRev?.items || [])
    .map((it) => { const o = rowsById.get(it.r); return o ? { it, c: cardOf(o) } : null; })
    .filter((x): x is { it: DayRev['items'][number]; c: ReturnType<typeof cardOf> } => !!x)
    .sort((a, b) => b.it.amt - a.it.amt);
  const sheetTitle = dayOpen ? (dayOpen === todayKey ? 'Today, so far' : dayLabel(dayOpen)) : '';
  const sheetValue = openDayRev ? inr(openDayRev.rev) + ' · ' + openDayRev.n + ' ' + (openDayRev.n === 1 ? unit[0] : unit[1]) : '';
  /* Close the sheet, let its dismissal finish (two Modals on top of each
     other leave dead windows behind), then open the booking page; its back
     button brings this day back. */
  const openBookingOf = (row: number) => {
    const day = dayOpen;
    closeDay();
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      s.openBooking(row, day ? () => openDay(day) : undefined);
    }, SHEET_DISMISS_MS);
  };
  /* Leaving the Report with the sheet open closes it, as on the Calendar. */
  useEffect(() => { if (s.tab !== 'dash') closeDay(); }, [s.tab]);

  if (!s.logs) {
    return (
      <Panel>
        <PanelTitle>Daily revenue vs target</PanelTitle>
        <Text style={st.muted}>Loading bookings…</Text>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelTitle right={isAdmin ? <Btn kind="mini" title={target ? 'Edit target' : 'Set target'} onPress={openEdit} /> : undefined}>
        Daily revenue vs target
      </PanelTitle>

      <Segmented
        segments={[{ key: 'booked', label: 'Booking date' }, { key: 'stay', label: 'Stay date' }]}
        value={basis} onChange={(k) => setBasis(k as RevBasis)}
      />
      <View style={st.chips}>
        {([['7', 'Last 7 days'], ['30', 'Last 30 days'], ['mtd', 'This month']] as [Win, string][]).map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => setWin(k)} activeOpacity={0.7}
            style={[st.chip, win === k && st.chipOn]} accessibilityState={{ selected: win === k }}>
            <Text style={[st.chipTxt, win === k && st.chipTxtOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* the three numbers that answer the question */}
      <View style={st.stats}>
        <View style={st.stat}>
          <Text style={st.statLbl}>Daily average</Text>
          <Text style={[st.statVal, sum.pct !== null && { color: sum.pct >= 100 ? C.green : C.amber }]} numberOfLines={1} adjustsFontSizeToFit>
            {sum.avg === null ? '—' : inr(sum.avg)}
          </Text>
          {sum.pct !== null ? (
            <Text style={[st.statSub, { color: sum.pct >= 100 ? C.green : C.amber }]}>{pctTxt(sum.pct)} target</Text>
          ) : null}
          {prev && prev.avg !== null && sum.avg !== null ? (
            <Text style={st.statSub}>prev {count}d: {kShort(prev.avg)}</Text>
          ) : null}
        </View>
        <View style={st.stat}>
          <Text style={st.statLbl}>Days on target</Text>
          <Text style={[st.statVal, sum.hit !== null && sum.n > 0 && { color: sum.hit * 2 >= sum.n ? C.green : C.amber }]}>
            {sum.hit === null ? '—' : sum.hit + ' / ' + sum.n}
          </Text>
          <Text style={st.statSub}>{target ? 'at ' + kShort(target) + ' a day' : 'no target set'}</Text>
        </View>
        <View style={st.stat}>
          <Text style={st.statLbl}>Total</Text>
          <Text style={st.statVal} numberOfLines={1} adjustsFontSizeToFit>{inr(sum.total)}</Text>
          {sum.gap !== null ? (
            <Text style={[st.statSub, { color: sum.gap >= 0 ? C.green : C.red }]}>
              {inr(Math.abs(sum.gap)) + (sum.gap >= 0 ? ' over' : ' short')}
            </Text>
          ) : <Text style={st.statSub}>{winLbl}</Text>}
        </View>
      </View>

      {!target && (
        <View style={st.noTarget}>
          <Text style={st.noTargetTxt}>
            {isAdmin
              ? 'No daily target set for ' + scopeName + '. Set one to see which days hit it.'
              : 'No daily target set for ' + scopeName + '. An admin can set one.'}
          </Text>
          {isAdmin && <Btn kind="mini" title="Set target" onPress={openEdit} />}
        </View>
      )}

      {count === 0 && (
        <Text style={st.muted}>The month started today — no complete day yet. Today so far is on the chart.</Text>
      )}

      <TargetChart days={days} today={today} target={target} avg={sum.avg} selected={sel} onSelect={openDay} />

      {/* the tapped day, in words */}
      {selDay && (
        <TouchableOpacity style={st.dayCard} activeOpacity={0.7} onPress={() => openDay(selDay.key)}
          accessibilityRole="button" accessibilityLabel="Show this day's bookings">
          <View style={{ flex: 1 }}>
            <Text style={st.dayLbl}>{cardKey === todayKey ? 'Today, so far' : dayLabel(selDay.key)}</Text>
            <Text style={st.daySub}>
              {selDay.n + ' ' + (selDay.n === 1 ? unit[0] : unit[1])}
              {sum.avg !== null && cardKey !== todayKey ? ' · ' + (selDay.rev >= sum.avg ? 'above' : 'below') + ' ' + avgLbl : ''}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={st.dayVal}>{inr(selDay.rev)}</Text>
            {target ? (
              <Text style={[st.dayDiff, { color: selDay.rev >= target ? C.green : C.red }]}>
                {Math.round(selDay.rev) === Math.round(target) ? '✓ on target'
                  : selDay.rev >= target ? '✓ ' + inr(selDay.rev - target) + ' over' : inr(target - selDay.rev) + ' short'}
              </Text>
            ) : null}
          </View>
          <Text style={st.chev}>›</Text>
        </TouchableOpacity>
      )}

      <Hint>
        {basis === 'booked'
          ? 'Booking date: each booking’s full net counts on the day it was booked.'
          : 'Stay date: each booking’s net is spread evenly over its nights (check-in to the night before check-out).'}
        {' '}Average and days on target use complete days only; today is shown faded and is not counted. Tap a bar to see that day’s bookings.
      </Hint>
      {basis === 'stay' && by.unplaced > 0 && (
        <Hint>
          {by.unplaced + ' booking' + (by.unplaced === 1 ? ' has' : 's have') + ' no check-in date (' + inr(by.unplacedAmt) +
            ') and cannot be placed on a stay day — add the dates to include them.'}
        </Hint>
      )}
      {localOnly && (
        <Hint>The server doesn’t store targets yet, so this target is saved on this device only.</Hint>
      )}

      <Sheet visible={!!dayOpen} title={sheetTitle} value={sheetValue} onClose={closeDay}>
        {openDayRev ? (
          <View>
            {target ? (
              <Text style={[st.share, { color: openDayRev.rev >= target ? C.green : C.red }]}>
                {Math.round(openDayRev.rev) === Math.round(target)
                  ? '✓ Exactly on the ' + kShort(target) + ' target'
                  : openDayRev.rev >= target
                  ? '✓ ' + inr(openDayRev.rev - target) + ' over the ' + kShort(target) + ' target'
                  : inr(target - openDayRev.rev) + ' short of the ' + kShort(target) + ' target'}
              </Text>
            ) : null}
            {dayItems.length === 0 ? (
              <Text style={[st.muted, { paddingVertical: 14 }]}>
                {basis === 'booked' ? 'No bookings were made on this day.' : 'Nobody stayed on this night.'}
              </Text>
            ) : dayItems.map(({ it, c }) => (
              <TouchableOpacity key={it.r + ':' + (it.night || 0)} style={st.bRow} activeOpacity={0.6}
                onPress={() => openBookingOf(it.r)} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={st.bGuest} numberOfLines={1}>{c.guest || c.id || 'Booking'}</Text>
                  <Text style={st.bSub} numberOfLines={1}>
                    {[c.prop, c.type, c.channel].filter(Boolean).join(' · ')}
                    {it.nights ? ' · night ' + it.night + ' of ' + it.nights : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={st.bAmt}>{inr(it.amt)}</Text>
                  {it.nights && Math.round(it.amt) !== Math.round(c.net) ? (
                    <Text style={st.bOf}>{'of ' + inr(c.net)}</Text>
                  ) : null}
                </View>
                <Text style={st.chev}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </Sheet>

      <Sheet visible={editing} title="Daily revenue target" value={scopeName} onClose={() => setEditing(false)}>
        <View style={{ paddingTop: 8 }}>
          <Field label="Target per day (₹)" hint="Net earned, the same figure as Total Revenue.">
            <TxtInput value={draft} onChange={setDraft} money placeholder="e.g. 12000" autoFocus />
          </Field>
          {draftOk && (
            <Text style={st.muted}>
              {'= ' + inr(draftNum * 7) + ' a week · ' + inr(draftNum * 30) + ' over 30 days'}
            </Text>
          )}
          <Text style={[st.muted, { marginTop: 6 }]}>
            {'Applies to ' + scopeName + ' only. Each property, and All, has its own target.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Btn title={saving ? 'Saving…' : 'Save target'} onPress={() => save(Math.round(draftNum))} disabled={!draftOk || saving} style={{ flex: 1 }} />
            {target ? <Btn kind="ghost" title="Remove" onPress={() => save(null)} disabled={saving} /> : null}
          </View>
        </View>
      </Sheet>
    </Panel>
  );
}

const st = StyleSheet.create({
  muted: { color: C.muted, fontFamily: F.med, fontSize: 12.5, marginVertical: 4 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 12, flexWrap: 'wrap' },
  chip: {
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: C.bone,
    borderWidth: 1, borderColor: 'transparent', minHeight: 32, justifyContent: 'center',
  },
  chipOn: { backgroundColor: '#fff', borderColor: C.blue },
  chipTxt: { fontFamily: F.semi, fontSize: 12.5, color: C.bark },
  chipTxtOn: { color: C.blue2, fontFamily: F.bold },
  stats: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 14, padding: 10, borderWidth: 1, borderColor: C.hair },
  statLbl: { fontFamily: F.semi, fontSize: 11, color: C.bark },
  statVal: { fontFamily: F.xbold, fontSize: 18, color: C.ink, marginTop: 3, letterSpacing: -0.4 },
  statSub: { fontFamily: F.semi, fontSize: 10.5, color: C.muted, marginTop: 2 },
  noTarget: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.amberbg,
    borderRadius: 12, padding: 10, marginBottom: 10,
  },
  noTargetTxt: { flex: 1, fontFamily: F.med, fontSize: 12.5, color: C.bark, lineHeight: 17 },
  dayCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 12,
    borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: C.line,
  },
  dayLbl: { fontFamily: F.bold, fontSize: 14, color: C.ink },
  daySub: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  dayVal: { fontFamily: F.xbold, fontSize: 18, color: C.ink },
  dayDiff: { fontFamily: F.bold, fontSize: 12, marginTop: 2 },
  chev: { fontFamily: F.bold, fontSize: 20, color: C.muted, marginLeft: 6 },
  back: { paddingVertical: 8, alignSelf: 'flex-start' },
  backTxt: { fontFamily: F.bold, fontSize: 13.5, color: C.blue2 },
  share: { fontFamily: F.semi, fontSize: 12.5, color: C.bark, marginTop: 4, marginBottom: 6 },
  bRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.hair, minHeight: 56,
  },
  bGuest: { fontFamily: F.bold, fontSize: 14.5, color: C.ink },
  bSub: { fontFamily: F.med, fontSize: 12, color: C.muted, marginTop: 2 },
  bAmt: { fontFamily: F.xbold, fontSize: 15, color: C.ink },
  bOf: { fontFamily: F.med, fontSize: 11, color: C.muted, marginTop: 1 },
});
