/**
 * Suite for the Actions list (computeTasks / taskWhen in src/logic.ts).
 * Runs the REAL app code in Node (react-native is stubbed by run-tests.sh).
 * Run: bash qa/run-tests.sh
 *
 * Dates are built relative to "today" rather than hardcoded, because the whole
 * feature is a function of today — a fixed date would pass in August and start
 * failing in September.
 */
import { computeTasks, taskWhen, LogBlock } from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);                 // midday, so DST shifts cannot roll the date
  d.setDate(d.getDate() + offsetDays);
  const z = (n: number) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
};

/* Task cells: 0 name · 1 end date · 2 description · 3 done · 4 done at · 5 created */
let rowN = 1;
const t = (name: string, end: string, done = 0, desc = '') =>
  ({ r: rowN++, cells: [name, end, desc, done, done ? iso(0) : '', iso(-10)] });

const block = (rows: any[]): LogBlock => ({
  headers: ['Action', 'End Date', 'Description', 'Done', 'Done At', 'Created At'],
  rows,
});

/* ── grouping by end date ── */
{
  rowN = 1;
  const d = computeTasks(block([
    t('late', iso(-3)),
    t('today', iso(0)),
    t('soon', iso(2)),
    t('finished', iso(-5), 1),
  ]));
  eq('open excludes done', d.open.map((x) => x.name), ['late', 'today', 'soon']);
  eq('due = overdue + today only', d.due.map((x) => x.name), ['late', 'today']);
  eq('done list', d.done.map((x) => x.name), ['finished']);
  eq('states', d.open.map((x) => x.state), ['overdue', 'today', 'upcoming']);
  eq('all = open then done', d.all.map((x) => x.name), ['late', 'today', 'soon', 'finished']);
}

/* ── sort order: soonest first, undated last ── */
{
  rowN = 1;
  const d = computeTasks(block([
    t('far', iso(30)),
    t('undated', ''),
    t('very late', iso(-9)),
    t('near', iso(1)),
  ]));
  eq('soonest first', d.open.map((x) => x.name), ['very late', 'near', 'far', 'undated']);
  eq('undated is not overdue', d.open[3].state, 'upcoming');
  eq('undated has no day count', d.open[3].days, null);
  eq('undated is not due', d.due.map((x) => x.name), ['very late']);
}

/* ── day counts are whole days from local midnight ── */
{
  rowN = 1;
  const d = computeTasks(block([t('a', iso(-1)), t('b', iso(0)), t('c', iso(1))]));
  eq('days', d.open.map((x) => x.days), [-1, 0, 1]);
}

/* ── wording ── */
{
  rowN = 1;
  const d = computeTasks(block([
    t('a', iso(-1)), t('b', iso(-2)), t('c', iso(0)), t('d', iso(1)), t('e', iso(5)),
  ]));
  const say = (n: string) => taskWhen(d.open.filter((x) => x.name === n)[0]);
  eq('overdue singular', say('a'), 'Overdue by 1 day');
  eq('overdue plural', say('b'), 'Overdue by 2 days');
  eq('today', say('c'), 'Due today');
  eq('tomorrow', say('d'), 'Due in 1 day');
  eq('later', say('e'), 'Due in 5 days');

  const done = computeTasks(block([t('z', iso(-1), 1)])).done[0];
  eq('done wording', taskWhen(done), 'Done · ' + iso(0));
}

/* ── rubbish in, nothing out ── */
{
  rowN = 1;
  eq('null block', computeTasks(null).all, []);
  eq('empty rows', computeTasks(block([])).all, []);
  const d = computeTasks(block([t('  ', iso(0)), t('real', iso(0))]));
  eq('nameless rows are dropped', d.all.map((x) => x.name), ['real']);
}

/* ── description round-trips, done flag is read as 0/1 ── */
{
  rowN = 1;
  const d = computeTasks(block([t('a', iso(0), 0, 'some detail'), t('b', iso(0), 1)]));
  eq('description', d.open[0].desc, 'some detail');
  eq('open flag', d.open[0].done, false);
  eq('done flag', d.done[0].done, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
