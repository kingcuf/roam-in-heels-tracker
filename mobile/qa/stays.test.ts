/**
 * Suite for computeStays — the Calendar tab's view of a booking (src/logic.ts).
 * Runs the REAL app code in Node (react-native is stubbed by run-tests.sh).
 * Run: bash qa/run-tests.sh
 *
 * The case that brought this file into existence: B173 / B177 are day-use
 * bookings — in at 2:30pm, out at 9pm the SAME day. The old `outK <= inK` test
 * lumped them in with "no check-out recorded", threw the recorded checkout
 * away, and pushed the departure to the next morning.
 */
import { computeStays, nightsInRange, LogBlock } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

/* Bookings row: 0 date · 1 property · 2 guest · 18 id · 20 check-in date ·
   21 check-out date · 22 check-in time · 23 check-out time · 24 unit */
let rowN = 1;
function bk(o: {
  id: string; prop?: string; guest?: string;
  inD?: string; outD?: string; inT?: string; outT?: string;
}) {
  const c: any[] = new Array(27).fill('');
  c[0] = o.inD || ''; c[1] = o.prop || 'Spira 3028'; c[2] = o.guest || 'Guest';
  c[18] = o.id; c[20] = o.inD || ''; c[21] = o.outD || '';
  c[22] = o.inT || ''; c[23] = o.outT || '';
  return { r: rowN++, cells: c };
}
const block = (rows: any[]): LogBlock => ({ headers: [], rows });
const one = (rows: any[]) => computeStays(block(rows), 'All').stays[0];

/* ── the day-use booking (B177: in 11 Aug 11:00 AM, out 11 Aug 7:30 PM) ── */
{
  rowN = 1;
  const x = one([bk({ id: 'B177', inD: '2026-08-11', outD: '2026-08-11', inT: '11:00 AM', outT: '7:30 PM' })]);
  eq('day use is a real checkout', x.assumedOut, false);
  eq('day use flagged', x.sameDay, true);
  eq('checkout day is the day itself', x.outK, '2026-08-11');
  eq('checkout is not pushed to tomorrow', x.outK === x.inK, true);
  eq('zero nights', x.nights, 0);
  eq('checkout time survives', x.outT, '7:30 PM');
  eq('check-in time survives', x.inT, '11:00 AM');
}

/* ── a day-use stay occupies no NIGHTS, so occupancy must not count it ── */
{
  rowN = 1;
  const x = one([bk({ id: 'B177', inD: '2026-08-11', outD: '2026-08-11' })]);
  eq('no nights in the month', nightsInRange(x, '2026-08-01', '2026-09-01'), 0);
}

/* ── the ordinary overnight stay is untouched ── */
{
  rowN = 1;
  const x = one([bk({ id: 'B100', inD: '2026-08-09', outD: '2026-08-10', inT: '10:00 PM', outT: '6:00 PM' })]);
  eq('one night', x.nights, 1);
  eq('not same-day', x.sameDay, false);
  eq('not assumed', x.assumedOut, false);
  eq('checkout day', x.outK, '2026-08-10');
}
{
  rowN = 1;
  const x = one([bk({ id: 'B101', inD: '2026-08-01', outD: '2026-08-06' })]);
  eq('five nights', x.nights, 5);
  eq('five nights in range', nightsInRange(x, '2026-08-01', '2026-09-01'), 5);
}

/* ── a missing check-out is still assumed to be one night ── */
{
  rowN = 1;
  const x = one([bk({ id: 'B102', inD: '2026-08-11' })]);
  eq('assumed', x.assumedOut, true);
  eq('not same-day', x.sameDay, false);
  eq('assumed to tomorrow', x.outK, '2026-08-12');
  eq('assumed one night', x.nights, 1);
}

/* ── a checkout BEFORE check-in is contradictory: keep the old fallback ── */
{
  rowN = 1;
  const x = one([bk({ id: 'B103', inD: '2026-08-11', outD: '2026-08-09' })]);
  eq('backwards dates are assumed', x.assumedOut, true);
  eq('backwards is not same-day', x.sameDay, false);
  eq('backwards falls back to one night', x.outK, '2026-08-12');
}

/* ── a booking with no check-in date is counted, never silently dropped ── */
{
  rowN = 1;
  const d = computeStays(block([
    bk({ id: 'B178' }),                                     // nothing recorded at all
    bk({ id: 'B177', inD: '2026-08-11', outD: '2026-08-11' }),
  ]), 'All');
  eq('undated counted', d.undated, 1);
  eq('only the dated one is drawn', d.stays.map((x) => x.id), ['B177']);
}

/* ── the property filter is on the booking's property, not its stay unit ── */
{
  rowN = 1;
  const rows = [bk({ id: 'B177', prop: 'Spira 3028', inD: '2026-08-11', outD: '2026-08-11' })];
  eq('matches its own property', computeStays(block(rows), 'Spira 3028').stays.length, 1);
  eq('hidden under another property', computeStays(block(rows), 'Spira 2212').stays.length, 0);
  eq('visible under All', computeStays(block(rows), 'All').stays.length, 1);
}

/* ── month bounds come from real dates, not the assumed ones ── */
{
  rowN = 1;
  const d = computeStays(block([
    bk({ id: 'A', inD: '2026-07-30', outD: '2026-08-02' }),
    bk({ id: 'B', inD: '2026-08-11', outD: '2026-08-11' }),
  ]), 'All');
  eq('min month', d.minMonth, '2026-07');
  eq('max month', d.maxMonth, '2026-08');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
