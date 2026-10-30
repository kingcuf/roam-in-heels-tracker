/**
 * Edge-case suite for the earnings calendar (src/calendar.tsx + computeCalendar in src/logic.ts).
 * Runs the REAL app code in Node (react-native is stubbed at require time by run-tests.sh).
 * Run: bash qa/run-tests.sh
 */
import { computeCalendar, CalData, LogBlock } from '../src/logic';
import { calAggregate, kfmt, buildWeeks, addMonth, monthTitle, fmtDayKey } from '../src/calendar';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

/* Bookings row builder — 26 cols, indexes per the sheet contract:
   0 date · 1 property · 2 guest · 3 type · 4 channel · 9 net · 10 comm · 11 pending ·
   18 booking id · 20 check-in date · 22 ci time · 23 co time */
let rowN = 1;
function bk(over: Record<number, any>): { r: number; cells: any[] } {
  const c: any[] = Array(26).fill('');
  c[0] = '2026-07-10'; c[1] = 'PropA'; c[2] = 'Guest'; c[3] = 'Stay'; c[4] = 'Airbnb';
  c[9] = 1000; c[18] = 'B' + String(rowN).padStart(3, '0');
  Object.entries(over).forEach(([i, v]) => { c[Number(i)] = v; });
  return { r: ++rowN, cells: c };
}
const block = (rows: { r: number; cells: any[] }[]): LogBlock => ({ headers: [], rows });

/* ── 1. empty / null input ── */
{
  const c0 = computeCalendar(null, 'All');
  eq('empty: null block → no days', Object.keys(c0.days).length, 0);
  eq('empty: minMonth blank', c0.minMonth, '');
  const c1 = computeCalendar(block([]), 'All');
  eq('empty: zero rows → no days', Object.keys(c1.days).length, 0);
  const ag = calAggregate(c1, new Set(['2026-07-13']));
  eq('empty: aggregate over empty data', [ag.net, ag.bk, ag.byDate.length], [0, 0, 0]);
}

/* ── 2. rows without a Booking ID are excluded ── */
{
  const c = computeCalendar(block([bk({ 18: '' }), bk({ 18: null })]), 'All');
  eq('no booking id → excluded entirely', Object.keys(c.days).length, 0);
}

/* ── 3. property filter ── */
{
  const rows = [bk({ 1: 'PropA', 9: 100 }), bk({ 1: 'PropB', 9: 200 })];
  eq('filter All → both nets', computeCalendar(block(rows), 'All').days['2026-07-10'].net, 300);
  eq('filter PropB → only its net', computeCalendar(block(rows), 'PropB').days['2026-07-10'].net, 200);
  eq('filter no match → no days', Object.keys(computeCalendar(block(rows), 'PropC').days).length, 0);
}

/* ── 4. numeric parsing: formatted strings, blanks, negatives, zero ── */
{
  const rows = [
    bk({ 9: '₹2,760', 10: '', 11: '' }),            // formatted net, blank comm/pending
    bk({ 0: '2026-07-11', 9: -500 }),                // refund day
    bk({ 0: '2026-07-12', 9: 0 }),                   // zero-net booking still annotates
  ];
  const c = computeCalendar(block(rows), 'All');
  eq('₹2,760 string parses to 2760', c.days['2026-07-10'].net, 2760);
  eq('blank comm/pending → 0', [c.days['2026-07-10'].comm, c.days['2026-07-10'].pending], [0, 0]);
  eq('negative net kept', c.days['2026-07-11'].net, -500);
  eq('zero-net day still has the booking', c.days['2026-07-12'].bookings.length, 1);
}

/* ── 5. same-day sums + pending rollup ── */
{
  const rows = [
    bk({ 9: 1200, 10: 100, 11: 1200 }),
    bk({ 9: 5097, 10: 903, 11: '' }),
  ];
  const d = computeCalendar(block(rows), 'All').days['2026-07-10'];
  eq('same day: net sums', d.net, 6297);
  eq('same day: comm sums', d.comm, 1003);
  eq('same day: pending sums only real pendings', d.pending, 1200);
  eq('same day: bookings listed', d.bookings.length, 2);
}

/* ── 6. check-ins anchor on col U; extend the month range ── */
{
  const rows = [bk({ 0: '2026-07-30', 20: '2026-08-02', 22: '2:00 PM', 23: '11:00 AM' })];
  const c = computeCalendar(block(rows), 'All');
  eq('earnings on booking date', c.days['2026-07-30'].net, 1000);
  eq('check-in recorded on check-in date', c.days['2026-08-02'].checkins.length, 1);
  eq('check-in day has no earnings of its own', c.days['2026-08-02'].bookings.length, 0);
  eq('check-in carries times', [c.days['2026-08-02'].checkins[0].inT, c.days['2026-08-02'].checkins[0].outT], ['2:00 PM', '11:00 AM']);
  eq('maxMonth extended by future check-in', c.maxMonth, '2026-08');
  eq('minMonth from booking date', c.minMonth, '2026-07');
}

/* ── 7. epoch time junk (1899-12-30) must be hidden ── */
{
  const c = computeCalendar(block([bk({ 20: '2026-07-15', 22: '1899-12-30', 23: '' })]), 'All');
  eq('1899 epoch time hidden', c.days['2026-07-15'].checkins[0].inT, '');
}

/* ── 8. garbage / missing dates ── */
{
  const rows = [
    bk({ 0: 'not a date', 20: '2026-07-20' }),   // bad booking date, valid check-in
    bk({ 0: '', 20: '' }),                        // no dates at all
  ];
  const c = computeCalendar(block(rows), 'All');
  eq('bad booking date → no earnings day', Object.keys(c.days).filter((k) => c.days[k].bookings.length).length, 0);
  eq('bad booking date but valid check-in → check-in still shows', c.days['2026-07-20'].checkins.length, 1);
}

/* ── 9. cross-year month range + navigation ── */
{
  const rows = [bk({ 0: '2025-12-28' }), bk({ 0: '2026-01-03' })];
  const c = computeCalendar(block(rows), 'All');
  eq('minMonth across years', c.minMonth, '2025-12');
  eq('addMonth back across year', addMonth('2026-01', -1), '2025-12');
  eq('addMonth forward across year', addMonth('2025-12', 1), '2026-01');
  eq('addMonth +13', addMonth('2025-12', 13), '2027-01');
  eq('monthTitle', monthTitle('2026-07'), 'July 2026');
}

/* ── 10. multi-select aggregation ── */
{
  const rows = [
    bk({ 0: '2026-07-12', 9: 1200, 10: 100, 11: 1200 }),
    bk({ 0: '2026-07-12', 9: 5097, 10: 0 }),
    bk({ 0: '2026-07-14', 9: 1840, 11: 1840, 20: '2026-07-14' }),
  ];
  const c = computeCalendar(block(rows), 'All');
  const ag = calAggregate(c, new Set(['2026-07-14', '2026-07-12', '2026-07-13', '2026-06-01']));
  eq('aggregate: net over selected', ag.net, 8137);
  eq('aggregate: bookings count', ag.bk, 3);
  eq('aggregate: pending total', ag.pending, 3040);
  eq('aggregate: check-ins counted', ag.ci, 1);
  eq('aggregate: empty dates skipped from byDate', ag.byDate.map((x) => x.k), ['2026-07-12', '2026-07-14']);
}

/* ── 11. grid construction ── */
{
  const jul = buildWeeks('2026-07');   // 1 Jul 2026 = Wednesday, 31 days
  eq('Jul 2026: 5 rows', jul.length, 5);
  eq('Jul 2026: leading blanks', jul[0].slice(0, 3), [null, null, null]);
  eq('Jul 2026: 1st on Wednesday', jul[0][3], 1);
  eq('Jul 2026: ends on 31', jul[4].filter((x) => x !== null).pop(), 31);
  const feb26 = buildWeeks('2026-02'); // 1 Feb 2026 = Sunday, 28 days → perfect 4 rows
  eq('Feb 2026: exactly 4 full rows', [feb26.length, feb26[0][0], feb26[3][6]], [4, 1, 28]);
  const feb24 = buildWeeks('2024-02'); // leap year
  eq('Feb 2024 leap: has 29', feb24.flat().includes(29), true);
  const aug = buildWeeks('2026-08');   // 1 Aug 2026 = Saturday, 31 days → 6 rows
  eq('Aug 2026: 6 rows', aug.length, 6);
  const total = jul.flat().length;
  eq('rows always ×7 cells', total % 7, 0);
}

/* ── 12. compact ₹ formatting ── */
{
  eq('kfmt 0', kfmt(0), '₹0');
  eq('kfmt 999', kfmt(999), '₹999');
  eq('kfmt 1000', kfmt(1000), '₹1K');
  eq('kfmt 1150', kfmt(1150), '₹1.2K');
  eq('kfmt 3200', kfmt(3200), '₹3.2K');
  eq('kfmt 99940', kfmt(99940), '₹99.9K');
  eq('kfmt 100000', kfmt(100000), '₹1L');
  eq('kfmt 150000', kfmt(150000), '₹1.5L');
  eq('kfmt negative', kfmt(-3200), '-₹3.2K');
  eq('fmtDayKey', fmtDayKey('2026-07-05'), '5 Jul 2026');
}

/* ── 13. ISO datetime strings (defensive: raw Date serialisation) ── */
{
  const c = computeCalendar(block([bk({ 0: '2026-07-09T00:00:00' })]), 'All');
  eq('ISO datetime → date prefix parsed', c.days['2026-07-09']?.net, 1000);
}

/* ── report ── */
console.log(`\n${pass} passed, ${fail} failed\n`);
failures.forEach((f) => console.log(f + '\n'));
if (fail) process.exit(1);
