/**
 * Cross-unit commission split — tests against the LOCAL worker + local D1.
 *
 * Sibling of rbac-tests.mjs and run the same way:
 *   npx wrangler d1 execute spira --local --file=migrations/0008_cross_unit_split.sql
 *   npx wrangler dev --port 8799 --local
 *   node scripts/split-tests.mjs
 *
 * Every booking it creates is deleted again at the end, so the suite can be run
 * repeatedly against the same local database.
 *
 * The invariant these tests exist to defend: a split moves money between units
 * and never creates or destroys any. Whatever the per-unit views say, the
 * all-properties total must be the number it was before the rule existed.
 */
const API = process.env.NEW_API || 'http://127.0.0.1:8799/';
const OWNER_PIN = process.env.PIN;

if (!/127\.0\.0\.1|localhost/.test(API)) {
  console.error('Refusing to run against a non-local API:', API);
  process.exit(2);
}

const sfx = Date.now().toString(36).slice(-5);
const OWNER = { user: '', pin: OWNER_PIN };
const A = 'Spira 3028';          // the unit that takes the booking
const B = 'Spira 2212';          // the flat the guest is given
const FEE = 500;

async function call(who, action, params = {}) {
  const u = new URL(API);
  u.searchParams.set('action', action);
  u.searchParams.set('pin', who.pin);
  if (who.user) u.searchParams.set('user', who.user);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return (await fetch(u)).json();
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
}
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

/* The two appended columns, by the index the clients read them at. */
const STAY_PROP = 28, SPLIT_FEE = 29;
const rowOf = async (r) => (await call(OWNER, 'logs')).bookings.rows.find((x) => x.r === r);
const created = [];
async function add(d) {
  const r = await call(OWNER, 'addBooking', { payload: { channel: 'Offline', ...d } });
  if (r.row) created.push(r.row);
  return r;
}
/* Revenue for one property view, straight out of the dashboard the app reads. */
const revOf = async (prop) => (await call(OWNER, 'dashboard', prop ? { property: prop } : {})).revenue.total;
const bookingsOf = async (prop) => (await call(OWNER, 'dashboard', prop ? { property: prop } : {})).kpis.bookings;

const revBeforeAll = await revOf('');
const revBeforeA = await revOf(A);
const revBeforeB = await revOf(B);
const cntBeforeAll = await bookingsOf('');

/* ── the rule fires ── */
console.log('cross-unit split');
let r = await add({ property: A, date: '2026-09-03', type: 'Stay', net: 9294, pending: 9294,
                    stayUnit: '2212', guest: 'Split ' + sfx });
const splitRow = r.row;
check('booking saved', r.ok, r);
let cells = (await rowOf(splitRow)).cells;
check('stay property resolved to the other owned unit', cells[STAY_PROP] === B, cells[STAY_PROP]);
check('fee frozen onto the booking at save time', near(cells[SPLIT_FEE], FEE), cells[SPLIT_FEE]);

check('receiving unit earns the fee', near(await revOf(A) - revBeforeA, FEE));
check('stay unit earns the rest', near(await revOf(B) - revBeforeB, 9294 - FEE));
check('all-properties total is the whole net — the split moved nothing out',
  near(await revOf('') - revBeforeAll, 9294));
check('per-property shares sum to the unsplit net',
  near((await revOf(A) - revBeforeA) + (await revOf(B) - revBeforeB), 9294));
check('the booking is counted once, against the unit that took it',
  (await bookingsOf('')) === cntBeforeAll + 1);

/* ── it does not fire ── */
console.log('when the rule must not fire');
const cases = [
  ['stay unit is a third-party flat (2121 is a real flat, NOT a typo for 2212)', { stayUnit: '2121' }],
  ['stay unit is the unit that took the booking', { stayUnit: '3028' }],
  ['stay unit written as the property name it already is', { stayUnit: 'Spira 3028' }],
  ['stay unit left blank', { stayUnit: '' }],
  ['stay unit names two flats ("3103, 3028")', { stayUnit: '3103, 3028' }],
  ['stay unit has trailing words ("2212 studio")', { stayUnit: '2212 studio' }],
  ['a Resold booking into an unowned flat', { stayUnit: '4230', type: 'Resold' }],
];
for (const [name, extra] of cases) {
  const c = await add({ property: A, date: '2026-09-04', type: 'Stay', net: 5000,
                        guest: 'NoSplit ' + sfx, ...extra });
  const cc = (await rowOf(c.row)).cells;
  check(name, cc[STAY_PROP] === '' && (cc[SPLIT_FEE] === '' || cc[SPLIT_FEE] === null), cc.slice(28));
}

console.log('matching is strict but forgiving of whitespace');
for (const [name, unit] of [['" 2212 "', ' 2212 '], ['"Spira 2212"', 'Spira 2212'], ['"SPIRA-2212"', 'SPIRA-2212']]) {
  const c = await add({ property: A, date: '2026-09-04', type: 'Stay', net: 5000,
                        guest: 'Ws ' + sfx, stayUnit: unit });
  const cc = (await rowOf(c.row)).cells;
  check(`${name} identifies ${B}`, cc[STAY_PROP] === B && near(cc[SPLIT_FEE], FEE), cc.slice(28));
}

/* ── the cap ── */
console.log('the fee is a cap, never a transfer');
const aCap = await revOf(A), bCap = await revOf(B);
const small = await add({ property: A, date: '2026-09-05', type: 'Stay', net: 300, pending: 300,
                          stayUnit: '2212', guest: 'Cap ' + sfx });
const capCells = (await rowOf(small.row)).cells;
check('a net under the fee stores the net as the fee', near(capCells[SPLIT_FEE], 300), capCells[SPLIT_FEE]);
check('receiving unit keeps the whole net', near(await revOf(A) - aCap, 300));
check('stay unit gets zero, not a negative share', near(await revOf(B) - bCap, 0));

const aZero = await revOf(A), bZero = await revOf(B);
const loss = await add({ property: A, date: '2026-09-05', type: 'Resold', net: -713,
                         stayUnit: '2212', guest: 'Loss ' + sfx });
check('a loss stays whole with the unit that took it', near(await revOf(A) - aZero, -713));
check('…and never lands on the stay unit', near(await revOf(B) - bZero, 0));

/* ── editing moves the attribution ── */
console.log('editing a booking');
const aEdit = await revOf(A), bEdit = await revOf(B);
r = await call(OWNER, 'updateBooking', { row: splitRow, payload: { stayUnit: '2121' } });
check('edit accepted', r.ok, r);
cells = (await rowOf(splitRow)).cells;
check('stay unit changed to an unowned flat clears the split',
  cells[STAY_PROP] === '' && (cells[SPLIT_FEE] === '' || cells[SPLIT_FEE] === null), cells.slice(28));
check('…and the whole net goes back to the unit that took it', near(await revOf(A) - aEdit, 9294 - FEE));
check('…and off the stay unit', near(await revOf(B) - bEdit, -(9294 - FEE)));

r = await call(OWNER, 'updateBooking', { row: splitRow, payload: { stayUnit: '2212' } });
cells = (await rowOf(splitRow)).cells;
check('setting it back re-applies the split', cells[STAY_PROP] === B && near(cells[SPLIT_FEE], FEE), cells.slice(28));
r = await call(OWNER, 'updateBooking', { row: splitRow, payload: { net: 400 } });
cells = (await rowOf(splitRow)).cells;
check('dropping the net under the fee re-caps the stored fee', near(cells[SPLIT_FEE], 400), cells[SPLIT_FEE]);
await call(OWNER, 'updateBooking', { row: splitRow, payload: { net: 9294 } });
cells = (await rowOf(splitRow)).cells;
check('raising it again restores the full fee', near(cells[SPLIT_FEE], FEE), cells[SPLIT_FEE]);

/* ── the invariant, over everything created above ── */
console.log('per-property sums');
const all = await revOf(''), pa = await revOf(A), pb = await revOf(B);
check('every property view sums to the all-properties total', near(pa + pb, all), { pa, pb, all });
const d = await call(OWNER, 'dashboard', { property: B });
check('the stay unit shows the split revenue under the booking type it was',
  near(d.byType.Stay.net + d.byType.Resold.net + d.byType.Pass.net, d.revenue.total), d.byType);

/* ── a Manager's request ── */
console.log('approval flow');
const MGR = { user: 'split_mgr_' + sfx, pin: process.env.MANAGER_PIN };
r = await call(OWNER, 'addUser', { payload: { username: MGR.user, pin: MGR.pin, role: 'Manager', managerId: 0 } });
check('manager created', r.ok, r);
r = await call(OWNER, 'setRoleRights', { payload: { role: 'Manager',
  rights: (await call(OWNER, 'users')).roles.find((x) => x.name === 'Manager').rights } });

const MB = { property: A, date: '2026-09-06', type: 'Stay', net: 9294, pending: 9294,
             stayUnit: '2212', guest: 'MgrSplit ' + sfx, channel: 'Offline' };
r = await call(MGR, 'addBooking', { payload: MB });
check("a Manager's booking becomes a request", r.ok && r.pendingApproval && r.ticket > 0, r);
const tid = r.ticket;
const tk = (await call(OWNER, 'tickets')).review.find((t) => t.id === tid);
check('the request exists for the approver', !!tk, tid);
const splitRowTxt = tk && tk.changes.find((c) => c.field === 'Cross-unit split');
const pendRowTxt = tk && tk.changes.find((c) => c.field === 'Pending split');
check('the approval card shows BOTH shares before she approves',
  !!splitRowTxt && /Spira 3028 ₹500/.test(splitRowTxt.to) && /Spira 2212 ₹8,794/.test(splitRowTxt.to),
  splitRowTxt);
check('…and the pending split too',
  !!pendRowTxt && /Spira 3028 ₹500/.test(pendRowTxt.to) && /Spira 2212 ₹8,794/.test(pendRowTxt.to),
  pendRowTxt);

const aPre = await revOf(A), bPre = await revOf(B), allPre = await revOf('');
r = await call(OWNER, 'approveTicket', { row: tid });
check('approved', r.ok, r);
const mgrRow = (await call(OWNER, 'logs')).bookings.rows.filter((x) => x.cells[2] === MB.guest).at(-1);
if (mgrRow) created.push(mgrRow.r);
check('approval stores exactly the split the card showed',
  mgrRow && mgrRow.cells[STAY_PROP] === B && near(mgrRow.cells[SPLIT_FEE], FEE), mgrRow && mgrRow.cells.slice(28));
check('…and applies identically to a direct save',
  near(await revOf(A) - aPre, FEE) && near(await revOf(B) - bPre, 9294 - FEE));
check('…with the all-properties total still the whole net', near(await revOf('') - allPre, 9294));

/* ── clean up ── */
for (const row of created) await call(OWNER, 'deleteBooking', { row });
const mgrId = (await call(OWNER, 'users')).users.find((u) => u.username === MGR.user);
if (mgrId) await call(OWNER, 'updateUser', { row: mgrId.id, payload: { active: false } });
console.log('cleanup');
check('every property view is back to where it started',
  near(await revOf(''), revBeforeAll) && near(await revOf(A), revBeforeA) && near(await revOf(B), revBeforeB),
  { all: await revOf(''), a: await revOf(A), b: await revOf(B) });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
