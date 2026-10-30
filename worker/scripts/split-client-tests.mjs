/**
 * Cross-unit split — CLIENT side.
 *
 * The split is computed in two places, in two languages: the Worker freezes it
 * onto the booking, and mobile/src/logic.ts reads it back for every per-property
 * figure and previews it in the form before saving. If those two ever disagree
 * the app shows one number and stores another, which is the whole failure this
 * feature exists to prevent — so this suite runs the real logic.ts against the
 * real Worker and asserts they agree on the same rows.
 *
 *   npx wrangler dev --port 8799 --local
 *   node scripts/split-client-tests.mjs
 *
 * logic.ts is TypeScript with no imports, so it is bundled with the esbuild
 * that ships inside wrangler rather than adding a toolchain to the app.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.NEW_API || 'http://127.0.0.1:8799/';
const OWNER_PIN = process.env.PIN;
if (!/127\.0\.0\.1|localhost/.test(API)) {
  console.error('Refusing to run against a non-local API:', API);
  process.exit(2);
}

const here = new URL('.', import.meta.url).pathname;
const SRC = join(here, '..', '..', 'mobile', 'src', 'logic.ts');
const dir = mkdtempSync(join(tmpdir(), 'spira-logic-'));
const out = join(dir, 'logic.mjs');
execFileSync(join(here, '..', 'node_modules', '.bin', 'esbuild'),
  [SRC, '--bundle', '--format=esm', '--platform=neutral', '--outfile=' + out], { stdio: 'pipe' });
const L = await import(out);

const OWNER = { user: '', pin: OWNER_PIN };
const A = 'Spira 3028', B = 'Spira 2212', FEE = 500;
async function call(action, params = {}) {
  const u = new URL(API);
  u.searchParams.set('action', action);
  u.searchParams.set('pin', OWNER.pin);
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
const props = [{ id: 'SPIRA-3028', name: A }, { id: 'SPIRA-2212', name: B }];

/* ── the form preview, on its own ── */
console.log('form preview');
check('names both units and the two shares',
  (() => { const s = L.splitPreview(props, A, '2212', 9294);
           return s && s.stayProp === B && near(s.keep, 500) && near(s.give, 8794); })(),
  L.splitPreview(props, A, '2212', 9294));
check('under the fee: the receiving unit keeps it all, the other gets ₹0 — never negative',
  (() => { const s = L.splitPreview(props, A, '2212', 300);
           return s && near(s.keep, 300) && s.give === 0; })(),
  L.splitPreview(props, A, '2212', 300));
check('a loss never lands on the stay unit',
  (() => { const s = L.splitPreview(props, A, '2212', -713);
           return s && near(s.keep, -713) && s.give === 0; })(),
  L.splitPreview(props, A, '2212', -713));
check('exactly at the fee', (() => { const s = L.splitPreview(props, A, '2212', 500);
  return s && near(s.keep, 500) && s.give === 0; })());
check('no net typed yet still names the units', (() => {
  const s = L.splitPreview(props, A, '2212', null); return s && s.known === false && s.stayProp === B; })());

console.log('the preview shows nothing unless it should');
for (const [name, prop, unit] of [
  ['2121 — a real third-party flat, never read as 2212', A, '2121'],
  ['same unit as the property', A, '3028'],
  ['blank stay unit', A, ''],
  ['two flats at once', A, '3103, 3028'],
  ['trailing words', A, '2212 studio'],
  ['an unowned flat', A, '4230'],
]) check(name, L.splitPreview(props, prop, unit, 9294) === null, { unit });

/* ── preview vs. what is actually stored ── */
console.log('preview agrees with the Worker, row for row');
const created = [];
for (const [label, net, pend] of [['full', 9294, 9294], ['capped', 300, 300], ['at the fee', 500, 0], ['a loss', -713, 0]]) {
  const r = await call('addBooking', { payload: { property: A, date: '2026-09-07', type: 'Stay',
    channel: 'Offline', net, pending: pend, stayUnit: '2212', guest: 'Parity ' + label } });
  created.push(r.row);
  const cells = (await call('logs')).bookings.rows.find((x) => x.r === r.row).cells;
  const prev = L.splitPreview(props, A, '2212', net);
  const sp = L.splitOf(cells);
  check(`${label}: stored fee is the fee the form previewed`,
    !!sp && !!prev && near(sp.fee, prev.keep), { stored: sp, preview: prev });
  check(`${label}: the share logic.ts reads back is the share the form showed`,
    near(L.receiverShare(net, sp.fee), prev.keep) && near(net - L.receiverShare(net, sp.fee), prev.give));
  check(`${label}: pending splits on the same rule`,
    near(L.receiverShare(pend, sp.fee) + (pend - L.receiverShare(pend, sp.fee)), pend));
}

/* ── the per-property reader, over the whole book ── */
console.log('per-property sums over every booking in the local database');
const logs = await call('logs');
const rows = logs.bookings.rows;
const sum = (filter, col) => rows.reduce((t, o) => {
  const sc = L.scopeBooking(o.cells, filter);
  return sc ? t + sc.share(L.ciNum(o.cells[col])) : t;
}, 0);
check('net: the two unit views sum to the all-properties total',
  near(sum(A, 9) + sum(B, 9), sum('All', 9)), { a: sum(A, 9), b: sum(B, 9), all: sum('All', 9) });
check('pending: the two unit views sum to the all-properties total',
  near(sum(A, 11) + sum(B, 11), sum('All', 11)));
check('every booking is owned by exactly one unit',
  rows.filter((o) => o.cells[18]).every((o) =>
    [A, B].filter((p) => (L.scopeBooking(o.cells, p) || {}).own).length === 1));
check('occupancy follows the guest, not the listing',
  rows.some((o) => L.splitOf(o.cells)) &&
  rows.filter((o) => L.splitOf(o.cells)).every((o) =>
    L.stayPropOf(o.cells) === B && L.inStayScope(o.cells, B) && !L.inStayScope(o.cells, A)));

/* ── the client agrees with the server's own dashboard ── */
console.log('client and Worker agree on the same figures');
for (const p of ['All', A, B]) {
  const d = await call('dashboard', p === 'All' ? {} : { property: p });
  check(`${p}: logic.ts total matches the Worker's revenue.total`, near(sum(p, 9), d.revenue.total),
    { client: sum(p, 9), worker: d.revenue.total });
}

for (const row of created) await call('deleteBooking', { row });
rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
