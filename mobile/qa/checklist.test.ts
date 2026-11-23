/**
 * Suite for booking checklists (src/logic.ts): checklistFor, propertySteps.
 * Run: bash qa/run-tests.sh
 */
import { checklistFor, propertySteps, ChecklistData, ChecklistItemRow, REVIEW_COL } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++;
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

/* Booking row cells: 0 booked · 1 property · 15 co-guest · 17 guests · 18 id ·
   20 in · 21 out · 26 review · 28/29 split. */
function bk(o: { r?: number; prop?: string; inD?: string; outD?: string; guests?: number; review?: string; stayProp?: string }) {
  const c: any[] = new Array(30).fill('');
  c[0] = '2026-11-01'; c[1] = o.prop || 'Spira 3028'; c[18] = 'B1';
  c[20] = o.inD || '2026-11-20'; c[21] = o.outD || '2026-11-22';
  c[17] = o.guests || 1; c[REVIEW_COL] = o.review || '';
  if (o.stayProp) { c[28] = o.stayProp; c[29] = 500; }
  return { r: o.r || 7, cells: c };
}
let nid = 0;
function item(o: Partial<ChecklistItemRow>): ChecklistItemRow {
  return {
    id: ++nid, property: '', booking_row: 0, preset: '', label: 'Step ' + nid, stage: 'checkin', sort: 0,
    created_at: '2026-01-01T00:00:00Z', removed_at: '', ...o,
  } as ChecklistItemRow;
}
const labels = (es: { label: string }[]) => es.map((e) => e.label);

/* ══ which steps a booking gets ══ */
{
  const entry = item({ property: 'Spira 3028', preset: 'entry_pass', label: 'Entry pass', stage: 'before' });
  const other = item({ property: 'Unit 403', label: 'Unit 403 only' });
  const own = item({ booking_row: 7, label: 'Airport pickup', stage: 'stay' });
  const ownOther = item({ booking_row: 99, label: 'Someone else’s' });
  const data: ChecklistData = { items: [own, other, entry, ownOther], ticks: [] };
  eq('property steps + own steps only', labels(checklistFor(bk({}), data, {})), ['Entry pass', 'Airport pickup']);
  eq('own step is flagged own', checklistFor(bk({}), data, {}).map((e) => e.own), [false, true]);
  // cross-unit: booked on 3028, stayed in 403 → follows the guest
  eq('split booking follows the stay property', labels(checklistFor(bk({ stayProp: 'Unit 403' }), data, {})), ['Unit 403 only', 'Airport pickup']);
}

/* ══ "edits apply to upcoming bookings" ══ */
{
  const late = item({ property: 'Spira 3028', label: 'Added 25 Nov', created_at: '2026-11-25T06:00:00Z' });
  const gone = item({ property: 'Spira 3028', label: 'Removed 25 Nov', removed_at: '2026-11-25T06:00:00Z' });
  const goneEarly = item({ property: 'Spira 3028', label: 'Removed 10 Nov', removed_at: '2026-11-10T06:00:00Z' });
  const data: ChecklistData = { items: [late, gone, goneEarly], ticks: [] };
  // stay 20–22 Nov: over before 25 Nov
  eq('past booking: not given a step added later; keeps one removed later', labels(checklistFor(bk({}), data, {})), ['Removed 25 Nov']);
  // stay 26–28 Nov: upcoming on 25 Nov
  eq('upcoming booking: gets the new step, loses the removed ones',
    labels(checklistFor(bk({ inD: '2026-11-26', outD: '2026-11-28' }), data, {})), ['Added 25 Nov']);
  // a tick keeps a step whatever happened to it
  const ticked: ChecklistData = { items: [goneEarly], ticks: [{ booking_row: 7, item_id: goneEarly.id, done_by: 'mgr', done_at: '2026-11-09T10:00:00Z' }] };
  eq('a ticked step always stays', labels(checklistFor(bk({}), ticked, {})), ['Removed 10 Nov']);
}

/* ══ ticks ══ */
{
  const a = item({ property: 'Spira 3028', label: 'A' });
  const data: ChecklistData = { items: [a], ticks: [{ booking_row: 7, item_id: a.id, done_by: 'ravi', done_at: '2026-11-20T09:00:00Z' }] };
  const e = checklistFor(bk({}), data, {})[0];
  eq('tick → done with who', [e.done, e.doneBy], [true, 'ravi']);
  eq('tick on another booking does not count', checklistFor(bk({ r: 8 }), data, {})[0].done, false);
}

/* ══ linked steps ══ */
{
  const ids = item({ property: 'Spira 3028', preset: 'ids', label: 'IDs' });
  const rev = item({ property: 'Spira 3028', preset: 'review', label: 'Review', stage: 'checkout' });
  const data: ChecklistData = { items: [ids, rev], ticks: [] };
  // two guests → two IDs needed
  const two = checklistFor(bk({ guests: 2 }), data, { '7': ['lead'] });
  eq('ids: 1 of 2 → not done', [two[0].done, two[0].note], [false, '1 of 2 IDs uploaded']);
  eq('ids: both → done', checklistFor(bk({ guests: 2 }), data, { '7': ['lead', 'co'] })[0].done, true);
  eq('ids: linked, never hand-ticked', !!two[0].linked, true);
  eq('review pending → not done', [two[1].done, two[1].note], [false, 'Not asked yet']);
  eq('review requested → done', checklistFor(bk({ review: 'requested' }), data, {})[1].done, true);
  eq('review skipped → done', checklistFor(bk({ review: 'skipped' }), data, {})[1].note, 'Review skipped');
}

/* ══ order: stage, then property steps before one-off, then age ══ */
{
  const s1 = item({ property: 'Spira 3028', label: 'checkout', stage: 'checkout' });
  const s2 = item({ property: 'Spira 3028', label: 'before', stage: 'before' });
  const s3 = item({ booking_row: 7, label: 'own before', stage: 'before' });
  const s4 = item({ property: 'Spira 3028', label: 'stay', stage: 'stay' });
  eq('ordered by stage', labels(checklistFor(bk({}), { items: [s1, s3, s4, s2], ticks: [] }, {})),
    ['before', 'own before', 'stay', 'checkout']);
  eq('propertySteps: live only, ordered', labels(propertySteps({ items: [s1, s3, s4, s2, item({ property: 'Spira 3028', label: 'x', removed_at: '2026-01-02T00:00:00Z' })], ticks: [] }, 'Spira 3028')),
    ['before', 'stay', 'checkout']);
}

/* ══ no data (an API that predates checklists) ══ */
eq('no checklist block → empty', checklistFor(bk({}), undefined, {}), []);

console.log(failures.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
