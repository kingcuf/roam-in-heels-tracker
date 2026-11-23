/**
 * Suite for the Report's "Daily revenue vs target" maths (src/logic.ts):
 * revenueByDay (booking date vs stay date), dayWindow and targetSummary.
 *
 * Run: bash qa/run-tests.sh
 * Expected values are derived by hand in the comments.
 */
import { revenueByDay, dayWindow, targetSummary, shiftDay, dayKeyOf, LogBlock } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/* A booking row: 0 booked · 1 property · 3 type · 9 net · 18 id · 20 in · 21 out
   (· 28 split stay property · 29 split fee). */
function bk(o: { id?: string; booked?: string; prop?: string; net: number; inD?: string; outD?: string; split?: [string, number] }) {
  const c: any[] = new Array(30).fill('');
  c[0] = o.booked || ''; c[1] = o.prop || 'Spira 3028'; c[3] = 'Stay'; c[9] = o.net;
  c[18] = o.id === undefined ? 'B' + Math.random() : o.id;
  c[20] = o.inD || ''; c[21] = o.outD || '';
  if (o.split) { c[28] = o.split[0]; c[29] = o.split[1]; }
  return c;
}
const block = (rows: any[][]): LogBlock => ({ headers: [], rows: rows.map((cells, i) => ({ r: i + 2, cells })) });

/* ══ booking date ══ */
{
  const b = block([
    bk({ booked: '2026-11-10', net: 6000, inD: '2026-11-20', outD: '2026-11-23' }),
    bk({ booked: '2026-11-10', net: 2000 }),
    bk({ booked: '2026-11-11', net: 1500 }),
    bk({ booked: '2026-11-11', net: 999, id: '' }),       // no Booking ID → not counted
    bk({ booked: '', net: 700 }),                          // no booking date → unplaced
  ]);
  const r = revenueByDay(b, 'All', 'booked');
  // 10th: 6000 + 2000 = 8000 from 2 bookings; 11th: 1500 (the ID-less 999 is skipped)
  eq('booked: 10 Nov total', r.days['2026-11-10'].rev, 8000);
  eq('booked: 10 Nov count', r.days['2026-11-10'].n, 2);
  eq('booked: ID-less row skipped', r.days['2026-11-11'].rev, 1500);
  eq('booked: blank booking date is unplaced', [r.unplaced, r.unplacedAmt], [1, 700]);
  eq('booked: stay dates ignored', r.days['2026-11-20'], undefined);
}

/* ══ stay date ══ */
{
  const b = block([
    // 3 nights (20, 21, 22) → 6000 / 3 = 2000 per night; checkout day 23 earns nothing
    bk({ booked: '2026-11-10', net: 6000, inD: '2026-11-20', outD: '2026-11-23' }),
    // overlaps the 22nd: 1 night → 900 on the 22nd
    bk({ booked: '2026-11-12', net: 900, inD: '2026-11-22', outD: '2026-11-23' }),
    // same-day (a Pass): whole 500 on check-in day
    bk({ booked: '2026-11-12', net: 500, inD: '2026-11-21', outD: '2026-11-21' }),
    // no checkout: whole 400 on check-in day
    bk({ booked: '2026-11-12', net: 400, inD: '2026-11-24' }),
    // no check-in: unplaced
    bk({ booked: '2026-11-12', net: 300 }),
  ]);
  const r = revenueByDay(b, 'All', 'stay');
  eq('stay: night 1', r.days['2026-11-20'].rev, 2000);
  eq('stay: night 2 + same-day pass', r.days['2026-11-21'].rev, 2500);
  eq('stay: night 3 + overlapping 1-night stay', r.days['2026-11-22'].rev, 2900);
  eq('stay: overlapping stays both counted', r.days['2026-11-22'].n, 2);
  eq('stay: checkout day earns nothing', r.days['2026-11-23'], undefined);
  eq('stay: missing checkout → check-in day', r.days['2026-11-24'].rev, 400);
  eq('stay: missing check-in → unplaced', [r.unplaced, r.unplacedAmt], [1, 300]);
  eq('stay: booking date ignored', r.days['2026-11-10'], undefined);
  // every placed rupee is accounted for: 6000 + 900 + 500 + 400
  const placed = Object.values(r.days).reduce((a, d) => a + d.rev, 0);
  eq('stay: placed total conserves net', near(placed, 7800), true);
}

/* ══ stay date: uneven split keeps the total ══ */
{
  const r = revenueByDay(block([bk({ net: 1000, inD: '2026-11-01', outD: '2026-11-04' })]), 'All', 'stay');
  const t = ['2026-11-01', '2026-11-02', '2026-11-03'].reduce((a, k) => a + r.days[k].rev, 0);
  eq('stay: 1000 over 3 nights sums back to 1000', near(t, 1000), true);
}

/* ══ stay across a month boundary and a DST-style date ══ */
{
  const r = revenueByDay(block([bk({ net: 400, inD: '2026-10-31', outD: '2026-11-02' })]), 'All', 'stay');
  eq('stay: crosses month end', [r.days['2026-10-31'].rev, r.days['2026-11-01'].rev], [200, 200]);
  // shiftDay steps local calendar days, never 24 h blocks
  eq('shiftDay: 29 Mar + 1', dayKeyOf(shiftDay(new Date(2026, 2, 29), 1)), '2026-03-30');
  eq('shiftDay: 1 Mar − 1', dayKeyOf(shiftDay(new Date(2026, 2, 1), -1)), '2026-02-28');
}

/* ══ property scope and the cross-unit split ══ */
{
  // Taken on 3028's listing, guest stayed in 2212: 3028 keeps the 500 fee, 2212 earns 4500.
  const b = block([bk({ booked: '2026-11-05', prop: 'Spira 3028', net: 5000, inD: '2026-11-06', outD: '2026-11-07', split: ['Spira 2212', 500] })]);
  eq('split: receiver keeps the fee (booked)', revenueByDay(b, 'Spira 3028', 'booked').days['2026-11-05'].rev, 500);
  eq('split: stay unit gets the rest (booked)', revenueByDay(b, 'Spira 2212', 'booked').days['2026-11-05'].rev, 4500);
  eq('split: stay unit gets the rest (stay)', revenueByDay(b, 'Spira 2212', 'stay').days['2026-11-06'].rev, 4500);
  eq('split: All sees the whole booking', revenueByDay(b, 'All', 'stay').days['2026-11-06'].rev, 5000);
  eq('scope: other property sees nothing', Object.keys(revenueByDay(b, 'Spira 9999', 'booked').days).length, 0);
}

/* ══ dayWindow ══ */
{
  const r = revenueByDay(block([
    bk({ booked: '2026-11-20', net: 100 }),
    bk({ booked: '2026-11-22', net: 300 }),
  ]), 'All', 'booked');
  const w = dayWindow(r, new Date(2026, 10, 22), 3);
  // 20, 21, 22 oldest first; the 21st had nothing and appears as zero
  eq('window: keys oldest first', w.map((d) => d.key), ['2026-11-20', '2026-11-21', '2026-11-22']);
  eq('window: empty day is zero', w.map((d) => d.rev), [100, 0, 300]);
  eq('window: zero length', dayWindow(r, new Date(2026, 10, 22), 0), []);
}

/* ══ targetSummary ══ */
{
  const days = [
    { key: 'a', rev: 12000, n: 2 }, { key: 'b', rev: 8000, n: 1 }, { key: 'c', rev: 10000, n: 1 },
    { key: 'd', rev: 0, n: 0 },
  ];
  // total 30000 over 4 days → avg 7500; target 10000 → hit a and c (≥) = 2;
  // gap 30000 − 40000 = −10000; pct 75
  const s = targetSummary(days, 10000);
  eq('summary: total', s.total, 30000);
  eq('summary: average', s.avg, 7500);
  eq('summary: days hit counts equal-to-target', s.hit, 2);
  eq('summary: gap', s.gap, -10000);
  eq('summary: pct of target', s.pct, 75);
  eq('summary: best day', s.best && s.best.key, 'a');
  const none = targetSummary(days, null);
  eq('summary: no target → hit/gap/pct null', [none.hit, none.gap, none.pct], [null, null, null]);
  eq('summary: zero target treated as none', targetSummary(days, 0).hit, null);
  const empty = targetSummary([], 5000);
  eq('summary: empty window', [empty.n, empty.avg, empty.pct, empty.best], [0, null, null, null]);
}

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
