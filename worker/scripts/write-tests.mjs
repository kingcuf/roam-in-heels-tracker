/**
 * Write-path tests against the LOCAL worker + local D1.
 *
 * Parity-diffing only proves the read side; these exercise every mutating
 * action and assert the resulting row, then clean up after themselves.
 * Destructive by design — point it at the local dev server only.
 *
 *   npx wrangler dev --port 8799 --local
 *   node scripts/write-tests.mjs
 */
const API = process.env.NEW_API || 'http://127.0.0.1:8799/';
const PIN = process.env.PIN;

if (!/127\.0\.0\.1|localhost/.test(API)) {
  console.error('Refusing to run write tests against a non-local API:', API);
  process.exit(2);
}

const call = async (action, params = {}) => {
  const u = new URL(API);
  u.searchParams.set('action', action);
  u.searchParams.set('pin', PIN);
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  return (await fetch(u)).json();
};
const logs = () => call('logs');
const inv  = () => call('invData');

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

/* ── bookings ───────────────────────────────────────────── */
console.log('bookings');
const before = (await logs()).bookings.rows.length;
let res = await call('addBooking', { payload: {
  property: 'Spira 3028', date: '2026-08-01', type: 'Stay', channel: 'Airbnb',
  guest: 'TEST Guest', net: 1000, guestPaid: 1200, phone: '0812345678',
  leadBirthYr: '1990', guests: 2, stayUnit: '3028', repeat: true
}});
check('addBooking returns ok + generated id', res.ok && /^Booking B\d{3} added$/.test(res.message), JSON.stringify(res));

let rows = (await logs()).bookings.rows;
check('row count +1', rows.length === before + 1);
const mine = rows[rows.length - 1];
check('commission derived as guestPaid - net (1200-1000=200)', mine.cells[10] === 200, `got ${mine.cells[10]}`);
check('month derived from date', mine.cells[19] === 'Aug 2026', `got ${mine.cells[19]}`);
check('leading-zero phone preserved as text', mine.cells[13] === '0812345678', `got ${JSON.stringify(mine.cells[13])}`);
check('repeat flag stored', mine.cells[25] === 1, `got ${mine.cells[25]}`);
check('booking id is sequential, not colliding', mine.cells[18] === res.message.match(/B\d{3}/)[0]);

res = await call('updateBooking', { row: mine.r, payload: {
  property: 'Spira 3028', date: '2026-08-02', type: 'Resold', net: 500, guest: 'TEST Guest 2', pending: 300
}});
check('updateBooking ok', res.ok, JSON.stringify(res));
let upd = (await logs()).bookings.rows.find(r => r.r === mine.r);
check('update preserved the booking id', upd.cells[18] === mine.cells[18]);
check('update changed type', upd.cells[3] === 'Resold');
check('update recomputed month', upd.cells[19] === 'Aug 2026');
check('pending amount set', upd.cells[11] === 300);

res = await call('setPayouts', { payload: { rows: [mine.r] } });
check('setPayouts reports 1 payment', res.ok && /^1 payment marked paid$/.test(res.message), JSON.stringify(res));
upd = (await logs()).bookings.rows.find(r => r.r === mine.r);
check('pending cleared to blank (not 0)', upd.cells[11] === '', `got ${JSON.stringify(upd.cells[11])}`);

res = await call('deleteBooking', { row: mine.r });
check('deleteBooking ok', res.ok);
check('row count back to baseline', (await logs()).bookings.rows.length === before);

/* Deleting by id must not disturb its neighbours — the sheet's row-shifting
   behaviour was the main hazard this migration removes. */
const survivors = (await logs()).bookings.rows;
check('ids of remaining rows unchanged after delete', survivors[0].r === 1 && survivors.at(-1).r === before);

/* ── validation ─────────────────────────────────────────── */
console.log('validation');
check('addBooking rejects missing net',
  (await call('addBooking', { payload: { property: 'X', date: '2026-01-01', type: 'Stay' } })).error === 'Net Earned is required');
check('addBooking rejects missing property',
  (await call('addBooking', { payload: { date: '2026-01-01', type: 'Stay', net: 1 } })).error === 'Property is required');
check('wrong PIN rejected', (await call('logs', { pin: 'nope' })).error !== undefined);
check('unknown action rejected', /^Unknown action/.test((await call('bogus')).error || ''));
check('update on missing row rejected', (await call('updateBooking', { row: 999999, payload: { date: '2026-01-01', type: 'Stay', net: 1 } })).error === 'Booking not found');
check('delete on missing row rejected', (await call('deleteBooking', { row: 999999 })).error === 'Row not found');
check('setPayouts with no rows rejected', (await call('setPayouts', { payload: { rows: [] } })).error === 'No rows given');

/* ── expenses ───────────────────────────────────────────── */
console.log('expenses');
const eBefore = (await logs()).expenses.rows.length;
res = await call('addExpense', { payload: {
  property: 'Spira 3028', item: 'TEST item', amount: 250, type: 'Deposit',
  expenseMonth: '2026-8', category: 'Other', quantity: 2
}});
check('addExpense ok', res.ok, JSON.stringify(res));
let er = (await logs()).expenses.rows.at(-1);
check('expense month zero-padded to YYYY-MM-01', er.cells[1] === '2026-08-01', `got ${er.cells[1]}`);
check('Deposit defaults refundable=Yes', er.cells[9] === 'Yes', `got ${er.cells[9]}`);
res = await call('updateExpense', { row: er.r, payload: {
  property: 'Spira 3028', item: 'TEST item 2', amount: 400, type: 'Recurring', expenseMonth: '2026-09'
}});
check('updateExpense ok', res.ok, JSON.stringify(res));
er = (await logs()).expenses.rows.find(r => r.r === er.r);
check('non-deposit defaults refundable=No', er.cells[9] === 'No');
check('amount updated', er.cells[6] === 400);
check('addExpense rejects missing month',
  (await call('addExpense', { payload: { property: 'X', item: 'i', amount: 1, type: 'One-time' } })).error === 'Expense month is required');
await call('deleteExpense', { row: er.r });
check('expenses back to baseline', (await logs()).expenses.rows.length === eBefore);

/* ── savings ────────────────────────────────────────────── */
console.log('savings');
const sBefore = (await logs()).savings.rows.length;
res = await call('addSaving', { payload: { date: '2026-08-01', amount: 5000, scheme: 'FDs', platform: 'Groww' } });
check('addSaving ok', res.ok, JSON.stringify(res));
let sr = (await logs()).savings.rows.at(-1);
check('created_at stamped', /^\d{4}-\d{2}-\d{2}$/.test(String(sr.cells[7])), `got ${sr.cells[7]}`);
check('Active saving carries no returns', sr.cells[5] === '', `got ${JSON.stringify(sr.cells[5])}`);
check('rejects invalid scheme',
  (await call('addSaving', { payload: { date: '2026-08-01', amount: 1, scheme: 'Crypto' } })).error === 'Invalid scheme: Crypto');
/* Mirrors the original's two-step check: blank -> 'Amount is required',
   present-but-zero -> 'Amount must be greater than 0' (gas/Code.js:414-416). */
check('rejects zero amount',
  (await call('addSaving', { payload: { date: '2026-08-01', amount: 0 } })).error === 'Amount must be greater than 0');
check('rejects blank amount',
  (await call('addSaving', { payload: { date: '2026-08-01', amount: '' } })).error === 'Amount is required');
const origCreated = sr.cells[7];
await call('updateSaving', { row: sr.r, payload: { date: '2026-08-02', amount: 6000, status: 'Matured', returns: 500 } });
sr = (await logs()).savings.rows.find(r => r.r === sr.r);
check('update never rewrites created_at', sr.cells[7] === origCreated);
check('matured saving keeps returns', sr.cells[5] === 500);
await call('deleteSaving', { row: sr.r });
check('savings back to baseline', (await logs()).savings.rows.length === sBefore);

/* ── inventory ──────────────────────────────────────────── */
console.log('inventory');
const iBefore = (await inv()).items.length;
res = await call('invAddItem', { payload: {
  item: 'TEST Lamp', property: 'Spira 2212', category: 'Lights',
  type: 'Consumable', requiredQty: 10, reorderLevel: 3, openingQty: 5
}});
check('invAddItem ok with prefixed id', res.ok && /^LGT-\d+$/.test(res.id), JSON.stringify(res));
let iv = await inv();
let item = iv.items.find(i => i.id === res.id);
check('opening balance became a movement', iv.movements.some(m => m.key === res.key && m.movement === 'Opening Balance' && m.qty === 5));
check('in_stock derived from movements (=5)', item.inStock === 5, `got ${item.inStock}`);
check('pending = required - stock (10-5=5)', item.pending === 5, `got ${item.pending}`);
check('not low: stock 5 > reorder 3', item.low === false);

/* consumption must reduce derived stock */
await call('invAddMovement', { payload: { itemKey: res.key, movement: 'Consumption', qty: 3, date: '2026-08-01' } });
iv = await inv(); item = iv.items.find(i => i.id === res.id);
check('consumption reduces stock (5-3=2)', item.inStock === 2, `got ${item.inStock}`);
check('now low: stock 2 <= reorder 3', item.low === true);
check('Asset type is never flagged low', iv.items.every(i => i.type !== 'Asset' || i.low === false));

/* renaming an item must carry its movement history with it */
await call('invUpdateItem', { row: item.r, payload: {
  item: 'TEST Lamp Renamed', property: 'Spira 2212', category: 'Lights',
  type: 'Consumable', requiredQty: 10, reorderLevel: 3
}});
iv = await inv(); item = iv.items.find(i => i.id === res.id);
check('rename re-points movement keys (stock still 2)', item.inStock === 2, `got ${item.inStock}`);
check('item key reflects new name', item.key === `${res.id} · TEST Lamp Renamed`);

const mv = iv.movements.filter(m => m.key === item.key);
await call('invAddMovement', { payload: { itemKey: item.key, movement: 'Purchase', qty: 4, unitCost: 150 } });
iv = await inv();
const purchase = iv.movements.filter(m => m.key === item.key).at(-1);
check('totalCost derived as qty * unitCost (4*150=600)', purchase.totalCost === 600, `got ${purchase.totalCost}`);
check('movement without date defaults to today', /^\d{4}-\d{2}-\d{2}$/.test(purchase.date));
check('invAddMovement rejects qty 0',
  (await call('invAddMovement', { payload: { itemKey: item.key, movement: 'Purchase', qty: 0 } })).error === 'Qty must be greater than 0');

for (const m of iv.movements.filter(m => m.key === item.key)) await call('invDeleteMovement', { row: m.r });
await call('invDeleteItem', { row: item.r });
check('inventory back to baseline', (await inv()).items.length === iBefore);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
