/**
 * Suite for the booking page helpers (src/logic.ts): bannerUnitOf, stayPhase, ageFrom.
 * Run: bash qa/run-tests.sh
 */
import { ageFrom, bannerUnitOf, stayPhase } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}
const cells = (o: { prop?: string; unit?: string; stayProp?: string }) => {
  const c: any[] = new Array(30).fill('');
  c[1] = o.prop || ''; c[24] = o.unit ?? '';
  if (o.stayProp) { c[28] = o.stayProp; c[29] = 500; }
  return c;
};

/* ══ banner unit ══ */
eq('typed stay unit wins', bannerUnitOf(cells({ prop: 'Spira 3028', unit: ' 3130 ' })), '3130');
eq('no unit → number in the property name', bannerUnitOf(cells({ prop: 'Spira 2212' })), '2212');
eq('address-style name', bannerUnitOf(cells({ prop: '403, Plot no 685, Sector 45' })), '403');
eq('split booking → the stay property', bannerUnitOf(cells({ prop: 'Spira 3028', stayProp: '101, Plot no 685, Sector 45' })), '101');
eq('no number anywhere', bannerUnitOf(cells({ prop: 'Villa' })), '');

/* ══ stay phase ══ */
const d = (s: string) => new Date(s + 'T00:00:00');
const now = new Date('2026-11-23T15:00:00');
eq('no dates', stayPhase(null, null, now).phase, 'none');
eq('tomorrow', stayPhase(d('2026-11-24'), d('2026-11-26'), now).label, 'Arrives tomorrow');
eq('in 5 days', stayPhase(d('2026-11-28'), d('2026-11-30'), now).label, 'Arrives in 5 days');
eq('arriving today', stayPhase(d('2026-11-23'), d('2026-11-25'), now).label, 'Arriving today');
eq('day use today', stayPhase(d('2026-11-23'), d('2026-11-23'), now).label, 'Day use today');
eq('in-house', stayPhase(d('2026-11-21'), d('2026-11-25'), now).label, 'In-house · night 3 of 4');
eq('leaving today', stayPhase(d('2026-11-20'), d('2026-11-23'), now).label, 'Checking out today');
eq('past', stayPhase(d('2026-11-01'), d('2026-11-03'), now).phase, 'past');

/* ══ age ══ */
eq('age', ageFrom('1994', now), '32');
eq('blank year', ageFrom('', now), '');
eq('nonsense year', ageFrom('3020', now), '');

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
