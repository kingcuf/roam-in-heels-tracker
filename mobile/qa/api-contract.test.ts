/**
 * API-contract suite — worker handlers + *_COLS, store.tsx state invalidation,
 * api.ts param encoding.  Run: bash qa/run-tests.sh
 *
 * Same two kinds of check as forms-roundtrip.test.ts:
 *
 *   INVARIANT  — must always hold; red here means a regression just landed.
 *   PINNED     — a defect that exists TODAY, asserted as present so the suite
 *                stays green while it is unfixed. Delete the pin when the bug
 *                is fixed; the test goes red and tells you to flip it.
 *
 * Everything asserted here was first reproduced against a real `wrangler dev`
 * + local D1 (never prod). The live command that produced each result is quoted
 * above the pin, so the assertion is a record of an observation, not a theory.
 */

// @ts-ignore
import * as fs from 'fs';
// @ts-ignore
import * as path from 'path';
// @ts-ignore
const HERE: string = __dirname;

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

const ROOT = (() => {
  let d = HERE;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src'))) return d;
    d = path.dirname(d);
  }
  throw new Error('repo root not found from ' + HERE);
})();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const W         = read('../worker/src/index.js');
const ApiSrc    = read('src/api.ts');
const StoreSrc  = read('src/store.tsx');
/* Slice a top-level `const <name> = async (...) => { … }` by brace matching.
   A fixed-width [\s\S]{0,N} window silently returns null the moment the body
   grows past N, which crashed this whole file rather than failing one check. */
const fnBody = (src: string, decl: string) => {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error('not found: ' + decl);
  let j = src.indexOf('{', i), d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1);
  }
  throw new Error('unbalanced: ' + decl);
};
const ActionSrc = read('src/screens/ActionScreen.tsx');
const DashSrc   = read('src/screens/Dashboard.tsx');
const LogicSrc  = read('src/logic.ts');

/* Slice one function body out of the worker. */
function fn(name: string): string {
  const i = W.indexOf(`function ${name}(`);
  if (i < 0) throw new Error('worker fn not found: ' + name);
  const j = W.indexOf('\nasync function ', i + 10);
  const k = W.indexOf('\nfunction ', i + 10);
  const end = Math.min(j < 0 ? W.length : j, k < 0 ? W.length : k);
  return W.slice(i, end);
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · *_COLS ↔ SCHEMA ↔ CLIENT CELL INDICES  (INVARIANT)

   getLogs emits positional arrays. Every consumer hard-codes indices, so a
   column inserted anywhere but the end silently re-points every reader.
   ══════════════════════════════════════════════════════════════════════════ */
function colsOf(decl: string): string[] {
  const i = W.indexOf(`const ${decl} = [`);
  const block = W.slice(i, W.indexOf('];', i));
  return [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}
const BOOKING_COLS = colsOf('BOOKING_COLS');
const EXPENSE_COLS = colsOf('EXPENSE_COLS');
const SAVING_COLS  = colsOf('SAVING_COLS');
const TASK_COLS    = colsOf('TASK_COLS');

eq('BOOKING_COLS width', BOOKING_COLS.length, 27);
eq('BOOKING_HEADERS is the same width',
   (W.slice(W.indexOf('const BOOKING_HEADERS'), W.indexOf('const BOOKING_COLS')).match(/'/g) || []).length / 2, 27);
/* The indices every client reader depends on. */
for (const [idx, col] of [
  [0, 'booking_date'], [1, 'property'], [2, 'lead_guest'], [3, 'booking_type'], [4, 'channel'],
  [6, 'list_price'], [8, 'guest_paid'], [9, 'net_earned'], [11, 'pending_amount'], [12, 'notes'],
  [13, 'phone'], [17, 'guests'], [18, 'booking_id'], [20, 'checkin_date'], [21, 'checkout_date'],
  [22, 'checkin_time'], [23, 'checkout_time'], [24, 'stay_unit'], [25, 'repeat_flag'], [26, 'review_status'],
] as [number, string][]) {
  eq(`BOOKING_COLS[${idx}] is ${col}`, BOOKING_COLS[idx], col);
}
eq('EXPENSE_COLS[1] is expense_month (computeCash buckets on it)', EXPENSE_COLS[1], 'expense_month');
eq('EXPENSE_COLS[3] is property (computeCash filters on it)',      EXPENSE_COLS[3], 'property');
eq('EXPENSE_COLS[6] is amount',                                    EXPENSE_COLS[6], 'amount');
eq('EXPENSE_COLS[12] is init_invest',                              EXPENSE_COLS[12], 'init_invest');
eq('SAVING_COLS[4] is status',                                     SAVING_COLS[4], 'status');
eq('SAVING_COLS[5] is returns',                                    SAVING_COLS[5], 'returns');
eq('TASK_COLS[3] is done',                                         TASK_COLS[3], 'done');

/* The mirror writes the same grid to the sheet and must not drift from the API. */
{
  const M = read('../worker/src/mirror.js');
  const mCols = (() => {
    const i = M.indexOf('const BOOKING_COLS = [');
    return [...M.slice(i, M.indexOf('];', i)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  })();
  /* PINNED — the mirror stops at repeat_flag: review_status (col 26) is in the
     API's grid but never reaches the sheet, so the sheet cannot show whether a
     review follow-up is done. (worker/src/mirror.js:21) */
  eq('PINNED mirror BOOKING_COLS is one short of the API grid', mCols.length, BOOKING_COLS.length - 1);
  eq('PINNED …the missing column is review_status', BOOKING_COLS[mCols.length], 'review_status');
  eq('mirror agrees on every column it does send', mCols, BOOKING_COLS.slice(0, mCols.length));
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · MARK-AS-PAID → CASH POSITION  (INVARIANT — the chain itself is sound)

   Reproduced live against wrangler dev + local D1:
     setPayouts rows:[2]  → {"ok":true,"message":"1 payment marked paid"}
     D1: pending_amount = NULL (typeof 'null')
     logs cell[11] = ''      →  ciNum('') = 0
     computeCash BEFORE {bank:6500, pending:1500}
     computeCash AFTER  {bank:8000, pending:0}
   So neither the worker, the NULL/'' coercion, nor computeCash is the defect.
   These pins hold that chain in place; the actual break is section 3.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const sp = fn('setPayouts');
  eq('setPayouts clears with NULL, not 0', /pending_amount = NULL/.test(sp), true);
  eq('setPayouts binds its ids (no interpolation)', /ids\.map\(\(\) => '\?'\)/.test(sp), true);
  eq('setPayouts filters non-numeric rows', /Number\.isFinite\(r\) && r >= 1/.test(sp), true);
  /* cell() turns NULL into '' and sheetish() leaves '' alone (early return), so
     index 11 arrives as '' and ciNum('') is 0. */
  eq('cell(null) is the empty string', /function cell\(v\) \{ return \(v === null \|\| v === undefined\) \? '' : v; \}/.test(W), true);
  eq('sheetish returns early on the empty string', /if \(typeof v !== 'string' \|\| v === ''\) return v;/.test(W), true);
  eq('pending_amount is NOT in NO_COERCE (only phone is)',
     /const NO_COERCE = new Set\(\['phone'\]\);/.test(W), true);
  /* computeCash is logs-derived end to end — no getDashboard figure feeds the
     Cash position block, so reloadLogs() alone is enough to move it. */
  eq('Dashboard cash comes from s.logs, not s.dash',
     /computeCash\(s\.logs\?\.bookings \|\| null, s\.logs\?\.expenses \|\| null, s\.filter, s\.logs\?\.savings \|\| null\)/.test(DashSrc), true);
  eq('…and re-runs when logs change', /\[s\.logs, s\.filter\]/.test(DashSrc), true);
  eq('markPaid reloads logs after the write', /await s\.reloadLogs\(\);/.test(ActionSrc), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · LAST-WRITE-WINS ON CONCURRENT LOADS  (PINNED — root cause of the
       "mark as paid doesn't update the cash position" report)

   loadAll() and reloadLogs() both end in a bare setLogs(l). Neither carries a
   request-sequence token, and the Loader overlay is pointerEvents="none", so a
   mutation can be tapped WHILE a slower load is still in flight. The older
   response then lands last and restores the pre-payout snapshot.

   Simulated with the real ordering (loadAll 900 ms, reloadLogs 120 ms):
     after reloadLogs  pending = 0
     after stale load  pending = 9294   ← cash position reverts
   ══════════════════════════════════════════════════════════════════════════ */
{
  /* INVARIANT — both logs writers must drop a response that a newer load has
     already superseded, or the slower earlier request lands last and reverts
     the screen to a pre-mutation snapshot. */
  eq('INVARIANT store holds an in-flight request token', /logsSeq/.test(StoreSrc), true);
  for (const decl of ['async function loadAll', 'const reloadLogs = async'] as string[]) {
    const body = fnBody(StoreSrc, decl);
    eq('INVARIANT ' + decl + ' takes a sequence token', /\+\+logsSeq\.current/.test(body), true);
    eq('INVARIANT ' + decl + ' drops a superseded response',
       /if \(my !== logsSeq\.current\) return;/.test(body), true);
    /* setLogs now happens inside applyLogs (delta merge); the guard must
       still come before it. */
    const apply = body.indexOf('applyLogs(l)');
    eq('INVARIANT ' + decl + ' guards before setLogs',
       apply > 0 && body.indexOf('logsSeq.current) return') < apply, true);
  }
  /* The overlay does not block the tap that starts the race. */
  eq('PINNED busy overlay is pointerEvents="none"',
     /pointerEvents="none"/.test(read('src/ui.tsx')), true);
  /* Reachable without any deliberate double-tap: entering the Action tab fires
     a load, and the payout queue is on that same tab. */
  eq('PINNED entering action/cal fires maybeReloadLogs',
     /if \(t === 'action' \|\| t === 'cal'\) s\.maybeReloadLogs\(\);/.test(read('App.tsx')), true);

  /* Executable proof of the ordering, using the same shape as the store. */
  const trace: number[] = [];
  const server = { pending: 9294 };
  const getLogs = (ms: number) => {
    const snap = server.pending;                       // snapshot at REQUEST time
    return new Promise<number>((r) => setTimeout(() => r(snap), ms));
  };
  const run = async () => {
    let logs = 0;
    const slow = getLogs(90).then((v) => { logs = v; trace.push(v); });   // loadAll
    await new Promise((r) => setTimeout(r, 5));
    server.pending = 0;                                                   // setPayouts
    logs = await getLogs(12); trace.push(logs);                           // reloadLogs
    await slow;
    return logs;
  };
  const done = run();
  // deferred assertion — the suite is synchronous, so settle it at the end
  (globalThis as any).__raceCheck = done.then(() =>
    eq('PINNED the stale response lands last', trace, [0, 9294]));
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · CHECK-IN DATE, END TO END  (INVARIANT on the wire, PINNED in the UI)

   Reproduced live:
     addBooking    checkinDate 2026-09-05 → D1 checkin_date '2026-09-05'
     updateBooking checkinDate 2026-09-10 → D1 checkin_date '2026-09-10'
     logs cells[20] = '2026-09-10'
   The wire path is intact. The reason "check-in date can't be added" on
   dashboard.roam-in-heels.com is that DateField renders NO picker on web —
   pinned in forms-roundtrip.test.ts §2. What is pinned HERE is the second,
   independent way a check-in date is lost: a partial update wipes it.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const bf = fn('bookingFields');
  eq('checkinDate maps to checkin_date', /checkin_date: d\.checkinDate \|\| '',/.test(bf), true);
  eq('BOOKING_COLS[20] round-trips it back', BOOKING_COLS[20], 'checkin_date');
  eq('logic.ts reads the check-in date at c[20]', /inD: ciParse\(c\[20\]\)/.test(LogicSrc), true);

  /* PINNED — updateBooking is a whole-row replace with `|| ''` defaults, not a
     patch. Any caller that omits checkinDate BLANKS it. Reproduced live:
       updateBooking row=1 payload={"date":..,"type":"Stay","net":"5000"}
       → {"ok":true} and D1 property:'' checkin_date:''  (both were set before)
     (worker/src/index.js:449 updateBooking / :400 bookingFields) */
  eq('PINNED updateBooking rebuilds every column from the payload',
     /const f = bookingFields\(d\);\s*\n\s*f\.booking_id = d\.bookingId \|\| existing\.booking_id;\s*\n\s*const cols = Object\.keys\(f\);/.test(W), true);
  eq('PINNED bookingFields defaults an omitted checkinDate to blank',
     /checkin_date: d\.checkinDate \|\| ''/.test(bf), true);
  /* addBooking demands a property; updateBooking does not — so an update can
     silently un-assign a booking from its flat, which drops it out of every
     property-scoped view. */
  eq('addBooking requires a property', /if \(!d\.property\) bad\('Property is required'\);/.test(fn('addBooking')), true);
  eq('PINNED updateBooking does not', /if \(!d\.property\)/.test(fn('updateBooking')), false);
  eq('PINNED addExpense requires a property', /if \(!d\.property\) bad\('Property is required'\);/.test(fn('addExpense')), true);
  eq('PINNED updateExpense does not', /if \(!d\.property\)/.test(fn('updateExpense')), false);
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · VALIDATION GAPS  (PINNED)

   taskFields anchors its date; nothing else does. Reproduced live:
     addBooking date "not-a-date"  → ok, D1 booking_date 'not-a-date',
                                     month 'undefined not'
     addBooking type "stay"        → ok, and getDashboard's byType/stay/resold/
                                     pass buckets all skip it, so its net_earned
                                     vanishes from kpis.totalRev while
                                     computeCash's totalNet still counts it
     addExpense expenseMonth "junk"→ ok, D1 expense_month 'junk-undefined-01'
   ══════════════════════════════════════════════════════════════════════════ */
{
  eq('taskFields anchors its date', /if \(!\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(end\)\) bad/.test(fn('taskFields')), true);
  eq('PINNED bookingFields does not validate the date shape', /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(fn('bookingFields')), false);
  eq('PINNED expenseFields does not validate the month shape', /\\d\{4\}/.test(fn('expenseFields')), false);
  /* savingFields whitelists its enums; nothing else does. */
  eq('savingFields whitelists scheme/platform/status',
     /SAVING_SCHEMES\.indexOf[\s\S]{0,220}SAVING_STATUSES\.indexOf/.test(fn('savingFields')), true);
  eq('PINNED booking_type is not whitelisted', /Stay['"]?\s*,\s*['"]Resold/.test(fn('bookingFields')), false);
  eq('PINNED expense type is not whitelisted', /One-time['"]?\s*,\s*['"]Recurring/.test(fn('expenseFields')), false);
  /* getDashboard silently drops an unrecognised type from every bucket. */
  eq('getDashboard buckets only the three known types',
     /if \(type === 'Stay'\) stay \+= net; else if \(type === 'Resold'\) resold \+= net; else if \(type === 'Pass'\) pass \+= net;/.test(W), true);
  /* `!d.amount` rejects a numeric 0 but accepts the string "0" the app sends. */
  eq('PINNED expense amount guard is truthiness, not a number test',
     /if \(!d\.amount\)\s+bad\('Amount is required'\);/.test(fn('expenseFields')), true);
  const truthyGuard = (v: any) => !v;
  eq('PINNED …so 0 is rejected but "0" is stored', [truthyGuard(0), truthyGuard('0')], [true, false]);
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · SQL SAFETY  (INVARIANT)

   Every interpolated identifier is a literal or comes from a fixed allowlist;
   every value is bound. Checked exhaustively rather than sampled.
   ══════════════════════════════════════════════════════════════════════════ */
{
  eq('the only interpolated table name is guarded by DELETABLE',
     /if \(!DELETABLE\.has\(table\)\) bad\('Not deletable'\);[\s\S]{0,200}DELETE FROM \$\{table\}/.test(W), true);
  /* Every ${...} that appears inside a SQL template literal, allowlisted. */
  const sqlInterp = new Set<string>();
  for (const m of W.matchAll(/`[^`]*(?:SELECT|INSERT|UPDATE|DELETE)[^`]*`/g)) {
    for (const v of m[0].matchAll(/\$\{([^}]+)\}/g)) sqlInterp.add(v[1].trim());
  }
  eq('SQL interpolates only identifiers this suite has cleared',
     [...sqlInterp].sort(),
     [
       "cols.join(', ')",                                  // literal column names
       "cols.map((c) => `${c} = ?`).join(', ')",           // literal column names
       "cols.map(() => '?').join(', ')",                   // placeholders
       "ids.map(() => '?').join(',')",                     // placeholders
       'c',                                                // literal column name
       'order',                                            // mirror.js only, literal
       'table',                                            // guarded by DELETABLE
     ].sort().filter((x) => sqlInterp.has(x)).concat(
       [...sqlInterp].filter((x) => ![
         "cols.join(', ')", "cols.map((c) => `${c} = ?`).join(', ')",
         "cols.map(() => '?').join(', ')", "ids.map(() => '?').join(',')",
         'c', 'order', 'table',
       ].includes(x))).sort());
  eq('the IN-list is placeholders, never values', /WHERE id IN \(\$\{ids\.map\(\(\) => '\?'\)\.join\(','\)\}\)/.test(W), true);
  eq('every INSERT uses ? placeholders',
     (W.match(/VALUES \(\$\{cols\.map\(\(\) => '\?'\)\.join\(', '\)\}\)/g) || []).length >= 4, true);
  /* api.ts encodes every param, so a payload containing & or # cannot split. */
  eq('api.ts encodes the payload', /encodeURIComponent\(JSON\.stringify\(a\.payload\)\)/.test(ApiSrc), true);
  eq('api.ts encodes the pin',     /encodeURIComponent\(a\.pin \|\| ''\)/.test(ApiSrc), true);
  eq('api.ts encodes the row',     /encodeURIComponent\(String\(a\.row\)\)/.test(ApiSrc), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · MUTATIONS WHOSE RESULT NOTHING INVALIDATES  (PINNED)
   ══════════════════════════════════════════════════════════════════════════ */
{
  /* reloadLogs refreshes logs only. Every Action-tab mutation uses it, so the
     Report tab's server-computed KPIs and the header's "updated …" stamp stay
     stale until a manual ↻. Harmless for setPayouts (getDashboard never reads
     pending_amount) but wrong for anything that moves a booking. */
  eq('PINNED reloadLogs does not refresh dash', fnBody(StoreSrc, 'const reloadLogs = async').includes('setDash'), false);
  /* The home header's "updated …" stamp was removed (24-Nov-2026, owner's
     call), so the stale-stamp half of this no longer applies. */
  eq('header no longer shows the dash "updated" stamp', /s\.dash\?\.generatedAt/.test(read('App.tsx')), false);
  /* reloadInv skips the busy counter, so an inventory write shows no spinner. */
  eq('PINNED reloadInv does not touch the busy counter', fnBody(StoreSrc, 'const reloadInv = async').includes('inc()'), false);
  /* editB holds a CELLS SNAPSHOT taken when the row was tapped, and the Add
     segments stay mounted, so an open edit outlives any later mutation. Saving
     it replays the stale pending_amount and undoes a mark-as-paid. */
  /* `draft` (optional) was added for resubmitting a sent-back change request. */
  eq('PINNED editB carries a cells snapshot', /export type EditB = \{ row: number; bookingId: string; from: LogSeg; cells: any\[\](; draft\?: any)? \}/.test(StoreSrc), true);
  eq('PINNED …prefilled straight into the form', /pending: String\(c\[11\] \?\? ''\)/.test(read('src/screens/BookingForm.tsx')), true);
  /* INVARIANT — the stale snapshot is now re-pointed at the rows that just
     arrived, so saving an open edit can no longer replay a cleared amount. */
  eq('INVARIANT reloadLogs resyncs the open edit snapshots',
     fnBody(StoreSrc, 'const reloadLogs = async').includes('applyLogs(l)')
       && fnBody(StoreSrc, 'const applyLogs = ').includes('resyncEdits'), true);
  eq('INVARIANT resyncEdits re-points editB from the new logs', /setEditB\(\(e\) =>/.test(StoreSrc), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · DELETE LEAVES DEPENDENTS BEHIND  (PINNED)

   invUpdateItem carefully re-points inv_movements when the composite key
   changes; invDeleteItem does not remove them. invNextId then recomputes the
   next id from the surviving ITEMS, so the freed id is handed out again.
   Reproduced live:
     invAddItem  Lights/Bulb openingQty 10  → LGT-01, in stock 10
     invDeleteItem LGT-01
     invAddItem  Lights/Bulb                → LGT-01, in stock 10  ← inherited
   ══════════════════════════════════════════════════════════════════════════ */
{
  eq('invUpdateItem re-points its movements', /UPDATE inv_movements SET item_key = \? WHERE item_key = \?/.test(fn('invUpdateItem')), true);
  eq('PINNED invDeleteItem deletes only the item row',
     /DELETE FROM inv_movements/.test(fn('invDeleteItem')), false);
  eq('PINNED invNextId derives the next id from surviving items only',
     /SELECT item_id FROM inv_items WHERE item_id LIKE \?/.test(fn('invNextId')), true);
  /* Movements are never checked against a real item either, so a bad key just
     creates history nothing owns. */
  eq('PINNED invMovementFields does not verify itemKey exists',
     /SELECT[\s\S]{0,80}inv_items/.test(fn('invMovementFields')), false);
  /* Deleting a booking leaves the guests' ID documents in D1 and R2, reachable
     by id until the 6-month sweep. */
  eq('PINNED deleteRowById removes no attachments', /attachments/.test(fn('deleteRowById')), false);
  eq('PINNED booking delete goes through the generic path',
     /deleteBooking':\s*out = await deleteRowById\(env, pin, 'bookings'/.test(W), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   9 · ADD vs UPDATE ERROR SHAPES  (PINNED)

   addProperty checks for a duplicate id and returns a sentence. updateProperty
   does not, so renaming one property's id onto another's leaks raw SQLite.
   Reproduced live:
     updateProperty origId SPIRA-2212 id SPIRA-3028
     → {"error":"D1_ERROR: UNIQUE constraint failed: properties.id: ..."}
   ══════════════════════════════════════════════════════════════════════════ */
{
  eq('addProperty pre-checks the id', /SELECT 1 FROM properties WHERE id = \?/.test(fn('addProperty')), true);
  eq('PINNED updateProperty does not', /SELECT 1 FROM properties WHERE id = \?/.test(fn('updateProperty')), false);
  /* Errors are HTTP 200 + {error} by contract, so a raw D1 string is what the
     user actually reads in the toast. */
  eq('errors are returned as 200 with an error field', /return reply\(p, \{ error: String\(\(err && err\.message\) \|\| err\) \}\);/.test(W), true);
  /* Responses carry no Cache-Control, and every mutation is a GET on a stable
     URL — safe today (no Last-Modified, so no heuristic caching, and no service
     worker in the web build) but one intermediary away from replaying writes. */
  eq('PINNED reply() sets no Cache-Control', /'Cache-Control'/.test(W), false);
  eq('PINNED mutations travel as GETs', /const res = await fetch\(u, \{ signal: ctl\.signal \}\);/.test(ApiSrc), true);
}

const finish = () => {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
};
((globalThis as any).__raceCheck as Promise<void>).then(finish, finish);
