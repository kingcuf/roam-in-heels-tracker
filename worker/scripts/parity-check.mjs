/**
 * Parity harness: deep-diffs the D1 Worker's responses against the live Apps
 * Script for every read action, so the migration can be proven rather than
 * assumed. Run with the local worker up:
 *
 *   npx wrangler dev --port 8799 --local
 *   node scripts/parity-check.mjs
 *
 * Volatile fields (generatedAt) are excluded — they are wall-clock stamps.
 * Row ids are excluded from the logs comparison: `r` legitimately changes from
 * a sheet row number to a primary key. The CELLS must match exactly.
 */
const OLD = process.env.OLD_API ||
  'https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec';
const NEW = process.env.NEW_API || 'http://127.0.0.1:8799/';
const PIN = process.env.PIN;

const get = async (base, qs) => {
  const sep = base.includes('?') ? '&' : '?';
  const res = await fetch(`${base}${sep}${qs}&pin=${PIN}`, { redirect: 'follow' });
  return res.json();
};

/* Numbers are compared with a small epsilon: the sheet returned floats and the
   two paths sum in a different order, so exact bit-equality is the wrong test. */
const EPS = 0.005;
const diffs = [];
function walk(a, b, path) {
  if (a === b) return;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;

  if (ta === 'number' && tb === 'number') {
    if (Math.abs(a - b) > EPS) diffs.push(`${path}: ${a} != ${b}`);
    return;
  }
  // The sheet emitted blanks as '' and numbers as numbers; treat ''/0 mismatches
  // as real findings but '' vs null as equivalent emptiness.
  if ((a === '' || a === null || a === undefined) && (b === '' || b === null || b === undefined)) return;
  if (ta !== tb) { diffs.push(`${path}: type ${ta}(${JSON.stringify(a)}) != ${tb}(${JSON.stringify(b)})`); return; }

  if (ta === 'array') {
    if (a.length !== b.length) { diffs.push(`${path}: length ${a.length} != ${b.length}`); return; }
    a.forEach((_, i) => walk(a[i], b[i], `${path}[${i}]`));
    return;
  }
  if (ta === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (k === 'generatedAt') continue;
      // `r` legitimately changes meaning: sheet row number -> primary key.
      if (k === 'r') continue;
      if (!(k in a)) { diffs.push(`${path}.${k}: missing in OLD`); continue; }
      if (!(k in b)) { diffs.push(`${path}.${k}: missing in NEW`); continue; }
      walk(a[k], b[k], `${path}.${k}`);
    }
    return;
  }
  diffs.push(`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
}

const CASES = [
  ['properties', 'action=properties'],
  ['dashboard (all)', 'action=dashboard'],
  ['dashboard (Spira 3028)', 'action=dashboard&property=' + encodeURIComponent('Spira 3028')],
  ['dashboard (Spira 2212)', 'action=dashboard&property=' + encodeURIComponent('Spira 2212')],
  ['dashboard (May range)', 'action=dashboard&from=2026-05-01&to=2026-05-31'],
  ['dashboard (open-ended from)', 'action=dashboard&from=2026-07-01'],
  ["invData", "action=invData"]
];

let failed = 0;
for (const [name, qs] of CASES) {
  diffs.length = 0;
  const [a, b] = await Promise.all([get(OLD, qs), get(NEW, qs)]);
  if (a.error) { console.log(`⚠️  ${name}: OLD errored — ${a.error}`); continue; }
  if (b.error) { console.log(`❌ ${name}: NEW errored — ${b.error}`); failed++; continue; }
  walk(a, b, '');
  if (diffs.length) {
    failed++;
    console.log(`❌ ${name}: ${diffs.length} diff(s)`);
    diffs.slice(0, 12).forEach(d => console.log('     ' + d));
    if (diffs.length > 12) console.log(`     … and ${diffs.length - 12} more`);
  } else {
    console.log(`✅ ${name}`);
  }
}

/* logs: compare cells only — `r` is expected to change meaning.
   The Phone column is the one intentional wire change: the sheet returned it as
   a number for some rows and a string for others depending on each cell's
   format, and the new API always returns TEXT (so leading zeros / '+91' can
   survive). Digits must still match exactly — only the JSON type may differ. */
const PHONE_COL = 13;
{
  diffs.length = 0;
  const [a, b] = await Promise.all([get(OLD, 'action=logs'), get(NEW, 'action=logs')]);
  for (const block of ['bookings', 'expenses', 'savings']) {
    walk(a[block].headers, b[block].headers, `logs.${block}.headers`);
    const norm = (rows) => rows.map(r => r.cells.map((c, i) =>
      (block === 'bookings' && i === PHONE_COL) ? String(c ?? '') : c));
    walk(norm(a[block].rows), norm(b[block].rows), `logs.${block}.cells`);
  }
  if (diffs.length) {
    failed++;
    console.log(`❌ logs: ${diffs.length} diff(s)`);
    diffs.slice(0, 15).forEach(d => console.log('     ' + d));
    if (diffs.length > 15) console.log(`     … and ${diffs.length - 15} more`);
  } else {
    console.log('✅ logs (cells)');
  }
}

console.log(failed ? `\n${failed} endpoint(s) differ.` : '\nAll endpoints match.');
process.exit(failed ? 1 : 0);
