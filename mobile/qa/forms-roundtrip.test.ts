/**
 * Form round-trip suite — form state → api param → worker field → D1 column →
 * logs cell index → edit-mode prefill, for BookingForm / ExpenseForm /
 * SavingForm / PropertyForm / TaskForm / Inventory / IdUploader.
 * Run: bash qa/run-tests.sh
 *
 * Two kinds of check live here.
 *
 *   INVARIANT  — something that must always be true. If it goes red, a
 *                regression was just introduced.
 *   PINNED     — a defect that exists TODAY, asserted as present so the suite
 *                stays green while it is unfixed. Each one names the file:line
 *                to delete the pin from once the bug is actually fixed; the
 *                test then goes red and tells you to flip it to an INVARIANT.
 *
 * Nothing here fakes a UI assertion. Where a defect is only observable in the
 * browser (a picker that never opens, a no-op Alert) the test asserts the
 * SOURCE SHAPE that causes it, which is the part that can regress.
 */
/* Node built-ins. run-tests.sh compiles with --types node; the app's own
   `npx tsc --noEmit` has none, hence the suppressions. */
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

/* repo root — the compiled test sits at qa/.build/qa/, so walk up to package.json */
const ROOT = (() => {
  let d = HERE;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src'))) return d;
    d = path.dirname(d);
  }
  throw new Error('repo root not found from ' + HERE);
})();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const BookingSrc  = read('src/screens/BookingForm.tsx');
const ExpenseSrc  = read('src/screens/ExpenseForm.tsx');
const SavingSrc   = read('src/screens/SavingForm.tsx');
const PropertySrc = read('src/screens/PropertyForm.tsx');
const TaskSrc     = read('src/screens/TaskForm.tsx');
const InvSrc      = read('src/screens/Inventory.tsx');
const FieldsSrc   = read('src/fields.tsx');
const ApiSrc      = read('src/api.ts');

/* Pull the `c[N]` indices out of one form's edit-mode prefill block. */
function prefillIdx(src: string, cellsDecl: string): number[] {
  const i = src.indexOf(cellsDecl);
  if (i < 0) throw new Error('prefill block not found: ' + cellsDecl);
  const j = src.indexOf('\n    } else {', i);
  const block = src.slice(i, j < 0 ? i + 2000 : j);
  const out = new Set<number>();
  for (const m of block.matchAll(/c\[(\d+)\]/g)) out.add(Number(m[1]));
  return [...out].sort((a, b) => a - b);
}

/* ══════════════════════════════════════════════════════════════════════════
   1 · EDIT-PREFILL COVERAGE  (INVARIANT)
   A column the form WRITES on update but never READS back is cleared on every
   edit-save. Columns the worker derives or preserves are exempt.
   ══════════════════════════════════════════════════════════════════════════ */
{
  /* worker BOOKING_COLS, 0-indexed. bookingFields() writes every one of these
     except 18 booking_id (carried on editB.bookingId), 19 month (derived from
     the booking date) and 26 review_status (owned by setReviewStatus, and
     absent from the UPDATE column list, so it survives). */
  const BOOKING_MUST_READ = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,20,21,22,23,24,25];
  const got = prefillIdx(BookingSrc, 'const c = s.editB.cells;');
  eq('BookingForm reads back every column it rewrites', got, BOOKING_MUST_READ);
  eq('BookingForm does not read booking_id from cells (uses editB.bookingId)', got.includes(18), false);
  eq('BookingForm carries bookingId on update', /bookingId: s\.editB\.bookingId/.test(BookingSrc), true);
  eq('worker never rewrites review_status from bookingFields',
     /review_status/.test(read('../worker/src/index.js').split('function bookingFields')[1].split('async function addBooking')[0]), false);
}
{
  /* EXPENSE_COLS 0..12 — expenseFields() writes all thirteen. */
  const got = prefillIdx(ExpenseSrc, 'const c = s.editE.cells;');
  eq('ExpenseForm reads back all 13 expense columns', got, [0,1,2,3,4,5,6,7,8,9,10,11,12]);
}
{
  /* SAVING_COLS 0..8; updateSaving deliberately never rewrites created_at (7). */
  const got = prefillIdx(SavingSrc, 'const c = s.editS.cells;');
  eq('SavingForm reads back every column it rewrites', got, [0,1,2,3,4,5,6,8]);
  eq('SavingForm does not touch created_at', got.includes(7), false);
}
{
  /* PropertyForm prefills from the properties object, not a cells array. */
  const PROP_FIELDS = ['name', 'id', 'location', 'type', 'status', 'onboarded', 'rent', 'notes'];
  const block = PropertySrc.slice(PropertySrc.indexOf('const p = s.editP.prop'), PropertySrc.indexOf('} else {'));
  for (const k of PROP_FIELDS) {
    eq(`PropertyForm prefills ${k}`, new RegExp('\\b' + k + ':').test(block), true);
  }
}
{
  /* Inventory item + movement forms. */
  const item = InvSrc.slice(InvSrc.indexOf('const startEditItem'), InvSrc.indexOf('const submitItem'));
  for (const k of ['item', 'property', 'category', 'type', 'requiredQty', 'reorderLevel', 'unitPrice', 'vendor', 'remarks']) {
    eq(`Inventory item prefills ${k}`, new RegExp('\\b' + k + ':').test(item), true);
  }
  const mv = InvSrc.slice(InvSrc.indexOf('const startEditMove'), InvSrc.indexOf('const submitMove'));
  for (const k of ['date', 'itemKey', 'movement', 'qty', 'unitCost', 'vendor', 'remarks']) {
    eq(`Inventory movement prefills ${k}`, new RegExp('\\b' + k + ':').test(mv), true);
  }
  /* INVARIANT — the worker rewrites logged_by on every update, so the edit must
     carry the original through or it relabels whoever logged the movement. */
  eq('INVARIANT Inventory movement prefills loggedBy', /loggedBy:/.test(mv), true);
  eq('INVARIANT submitMove preserves the original logger',
     /loggedBy: fm\.loggedBy \|\| 'App'/.test(InvSrc.slice(InvSrc.indexOf('const submitMove'), InvSrc.indexOf('const delMove'))), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   2 · DateField ON THE WEB BUILD  (PINNED — top severity)
   fields.tsx:108/114 gate BOTH pickers on Platform.OS 'android' / 'ios'.
   react-native-web reports 'web', so on dashboard.roam-in-heels.com the
   button toggles `open` and renders nothing. Metro proves it: the shipped
   bundle contains `d&&!1,d&&!1` where the two pickers used to be.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const df = FieldsSrc.slice(FieldsSrc.indexOf('export function DateField'), FieldsSrc.indexOf('export function MonthField'));
  eq('PINNED DateField android branch is platform-gated', /open && Platform\.OS === 'android'/.test(df), true);
  eq('PINNED DateField ios branch is platform-gated', /open && Platform\.OS === 'ios'/.test(df), true);
  eq('INVARIANT DateField has a web branch', /Platform\.OS === 'web'/.test(df), true);
  eq('INVARIANT the web branch renders a real date input', /type: 'date'/.test(df), true);
  /* allowClear renders unconditionally, so on web the × can DESTROY a date
     that can then never be re-entered. */
  eq('PINNED allowClear × is not platform-gated', /allowClear && !!value/.test(df), true);
  /* MonthField is the counter-example: a plain <Modal>, so it works on web. */
  const mf = FieldsSrc.slice(FieldsSrc.indexOf('export function MonthField'), FieldsSrc.indexOf('export const TIME_OPTS'));
  eq('MonthField is platform-independent', /Platform\.OS/.test(mf), false);
  /* TimeField is a SelectField/PickerModal, also platform-independent. */
  eq('TimeField delegates to SelectField', /return <SelectField/.test(FieldsSrc.slice(FieldsSrc.indexOf('export function TimeField'))), true);
  eq('TIME_OPTS has 48 half-hour slots', (() => { const o: string[] = []; for (let i = 0; i < 48; i++) { const hr = Math.floor(i / 2), mm = i % 2 ? '30' : '00', ap = hr < 12 ? 'AM' : 'PM', h12 = hr % 12 || 12; o.push(h12 + ':' + mm + ' ' + ap); } return [o.length, o[0], o[47]]; })(), [48, '12:00 AM', '11:30 PM']);
}
/* Every DateField in the app now works on web via the shared web branch.
   Enumerated so a new one cannot be added without noticing. */
{
  const count = (s: string) => (s.match(/<DateField/g) || []).length;
  eq('INVARIANT DateFields present — BookingForm', count(BookingSrc), 3);   // booking, check-in, check-out
  eq('INVARIANT DateFields present — ExpenseForm', count(ExpenseSrc), 1);   // transaction date
  eq('INVARIANT DateFields present — SavingForm', count(SavingSrc), 2);   // created, exit
  eq('INVARIANT DateFields present — PropertyForm', count(PropertySrc), 1);
  eq('INVARIANT DateFields present — TaskForm', count(TaskSrc), 1);
  eq('INVARIANT DateFields present — Inventory', count(InvSrc), 1);
}

/* ══════════════════════════════════════════════════════════════════════════
   3 · Alert.alert IS A NO-OP ON react-native-web  (PINNED)
   node_modules/react-native-web/dist/exports/Alert/index.js is literally
   `class Alert { static alert() {} }`. Every destructive confirm that goes
   through it does nothing at all in the browser — the Delete button is dead.
   TaskForm.tsx:82-87 is the only place with the window.confirm fallback.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const rnwAlert = read('node_modules/react-native-web/dist/exports/Alert/index.js');
  eq('react-native-web Alert.alert is an empty stub', /static alert\(\)\s*\{\s*\}/.test(rnwAlert), true);

  /* INVARIANT — every destructive confirm goes through the one helper in ui.tsx,
     which branches to window.confirm on web. No screen may call Alert.alert
     directly again, or that Delete button is silently dead in the browser. */
  const uiSrc = read('src/ui.tsx');
  eq('INVARIANT confirmDestructive handles web', /Platform\.OS === 'web'/.test(uiSrc) && /window\.confirm/.test(uiSrc), true);
  for (const [name, src] of [['BookingForm', BookingSrc], ['ExpenseForm', ExpenseSrc], ['SavingForm', SavingSrc],
                             ['Inventory', InvSrc], ['TaskForm', TaskSrc]] as [string, string][]) {
    eq('INVARIANT ' + name + ' never calls Alert.alert directly', /Alert\.alert\(/.test(src), false);
    eq('INVARIANT ' + name + ' uses confirmDestructive', /confirmDestructive\(/.test(src), true);
  }
  /* IdUploader deletes a stored identity document with no confirmation on ANY
     platform (IdUploader.tsx:185 calls onRemove straight from onPress). */
  eq('PINNED IdUploader removes an ID with no confirmation at all',
     /Alert\.alert|window\.confirm/.test(read('src/screens/IdUploader.tsx')), false);
}

/* ══════════════════════════════════════════════════════════════════════════
   4 · NUMERIC COERCION — client validator vs worker num()
   worker/src/index.js:68 strips everything but [0-9.-] before parseFloat.
   The forms validate with bare parseFloat / Number, which do not.
   ══════════════════════════════════════════════════════════════════════════ */
/* mirror of worker/src/index.js:68 num() and :72 optNum() */
function num(v: any) {
  if (v === '' || v === null || v === undefined) return 0;
  if (typeof v === 'string') v = v.replace(/[^0-9.\-]/g, '');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}
const optNum = (v: any) => (v === '' || v === null || v === undefined) ? null : num(v);
{
  eq('num strips a thousands comma', num('1,200'), 1200);
  eq('num strips a rupee sign', num('₹500'), 500);
  eq('num trims whitespace', num(' 500 '), 500);
  eq('num blank is 0', num(''), 0);
  eq('optNum keeps blank distinct from 0', [optNum(''), optNum('0')], [null, 0]);
  eq('num of a lone minus is 0', num('-'), 0);
  eq('num keeps a legitimate negative', num('-1500'), -1500);
  /* PINNED — BookingForm.tsx:96 rejects with parseFloat, which the worker
     would have accepted. A user typing the amount the way the app prints it
     ("₹1,200") is told "Net Earned must be a number". */
  eq('PINNED BookingForm net validator uses bare parseFloat', /isNaN\(parseFloat\(d\.net\)\)/.test(BookingSrc), true);
  eq('PINNED parseFloat rejects a currency-formatted net', isNaN(parseFloat('₹1,200')), true);
  eq('        …but the worker would have stored it fine', num('₹1,200'), 1200);
  /* PINNED — parseFloat('1,200') === 1: passes validation, then the auto
     commission (BookingForm.tsx:76-79) is computed from 1, not 1200. */
  eq('PINNED autoComm uses bare parseFloat', /const g = parseFloat\(gp\), n = parseFloat\(net\)/.test(BookingSrc), true);
  eq('PINNED autoComm on "1,200" paid / "1000" net writes a wrong commission',
     (parseFloat('1,200') - parseFloat('1000')).toFixed(0), '-999');
  eq('        the worker-consistent answer', (num('1,200') - num('1000')).toFixed(0), '200');
  /* PINNED — SavingForm.tsx:51 uses Number(), which is stricter still. */
  eq('PINNED SavingForm amount validator uses Number()', /Number\(d\.amount\) > 0/.test(SavingSrc), true);
  eq('PINNED Number() rejects a formatted amount the worker accepts',
     [Number('1,200'), num('1,200')], [NaN, 1200]);
  /* Inventory qty (Inventory.tsx:148) has the same shape. */
  eq('PINNED Inventory qty validator uses Number()', /Number\(fm\.qty\) <= 0/.test(InvSrc), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   5 · sheetish() COERCION MEETS AN UNWRAPPED PREFILL  (PINNED — crash)
   worker/src/index.js:674 turns any round-trippable numeric string into a
   NUMBER on the wire, so co_guest '2' arrives as 2. BookingForm.tsx:60 maps
   it with `c[15] || ''` (no String()), and BookingForm.tsx:267 then calls
   f.coGuest.trim() during render.
   Live rows with co_guest='2': bookings id 87, 121, 152.
   ══════════════════════════════════════════════════════════════════════════ */
{
  /* mirror of worker/src/index.js:674 */
  const sheetish = (v: any) => {
    if (typeof v !== 'string' || v === '') return v;
    const n = Number(v);
    return (Number.isFinite(n) && String(n) === v) ? n : v;
  };
  eq('sheetish turns "2" into a number', [sheetish('2'), typeof sheetish('2')], [2, 'number']);
  eq('sheetish leaves "0501" alone', sheetish('0501'), '0501');

  const prefill = BookingSrc.slice(BookingSrc.indexOf('const c = s.editB.cells;'), BookingSrc.indexOf('\n    } else {'));
  /* INVARIANT — the worker coerces round-trippable numeric text to a number on
     the wire, so a guest literally named "2" arrives as 2. Every free-text
     prefill must be String()-wrapped or the first .trim() on it blanks the app.
     Bookings 87 / 121 / 152 have co_guest = '2' in production today. */
  eq('INVARIANT coGuest prefill is String()-wrapped', /coGuest: String\(c\[15\] \?\? ''\)/.test(prefill), true);
  eq('        (leadBirthYr next to it IS wrapped)', /leadBirthYr: String\(c\[14\] \?\? ''\)/.test(prefill), true);
  eq('render still calls .trim() on that value', /f\.coGuest\.trim\(\)/.test(BookingSrc), true);
  eq('an unwrapped value would still throw (why the wrap matters)', (() => {
    const coGuest: any = sheetish('2');
    try { coGuest.trim(); return 'no throw'; }
    catch (e: any) { return e.constructor.name; }
  })(), 'TypeError');
  eq('and nothing catches it — no error boundary in the app',
     /componentDidCatch|getDerivedStateFromError/.test(read('App.tsx')), false);
  /* Same unwrapped shape on the other free-text booking fields — no .trim()
     today, so "only" a number lands in a TextInput, but the pattern is one
     .trim() away from the same crash. */
  for (const [k, i] of [['property', 1], ['guest', 2], ['referrer', 5], ['notes', 12], ['checkinTime', 22], ['checkoutTime', 23]] as [string, number][]) {
    eq(`INVARIANT ${k} prefill is String()-wrapped (c[${i}])`,
       new RegExp(`${k}: String\\(c\\[${i}\\] \\?\\? ''\\)`).test(prefill), true);
  }
  /* channel/type keep the `|| 'default'` form deliberately — they are dropdowns
     with a fallback option, never free text, so a number cannot reach them. */
  eq('channel keeps its dropdown default', /channel: c\[4\] \|\| 'Airbnb'/.test(prefill), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   6 · ID UPLOAD IS BROKEN ON THE WEB BUILD  (PINNED)
   api.ts:114 appends React Native's {uri,name,type} file descriptor. On web
   that is the BROWSER's FormData, which stringifies any non-Blob value — so
   the worker receives the text "[object Object]" and
   worker/src/attachments.js:78 fails it with "No file received".
   expo-document-picker exposes the real File on web as asset.file; api.ts
   never reads it.
   ══════════════════════════════════════════════════════════════════════════ */
{
  eq('PINNED api.ts appends the RN file descriptor', /fd\.append\('file', \{ uri: file\.uri, name: file\.name, type: file\.mimeType \} as any\)/.test(ApiSrc), true);
  const fd: any = new (globalThis as any).FormData();
  fd.append('file', { uri: 'blob:x', name: 'id.jpg', type: 'image/jpeg' } as any);
  const got = fd.get('file');
  eq('PINNED browser FormData stringifies the descriptor', String(got), '[object Object]');
  eq('PINNED …so the worker sees no arrayBuffer', typeof got.arrayBuffer, 'undefined');
  eq('worker rejects exactly that', /typeof file\.arrayBuffer !== 'function'/.test(read('../worker/src/attachments.js')), true);
  eq('PINNED expo-document-picker exposes asset.file on web, unused here',
     /file\?: File;/.test(read('node_modules/expo-document-picker/build/types.d.ts')) && !/\.file\b/.test(read('src/screens/IdUploader.tsx')), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   7 · ADD vs UPDATE ASYMMETRY  (INVARIANT unless noted)
   ══════════════════════════════════════════════════════════════════════════ */
{
  const submit = BookingSrc.slice(BookingSrc.indexOf('const submit = async'), BookingSrc.indexOf('const del ='));
  eq('BookingForm runs the same validation for add and update',
     submit.indexOf('if (s.editB)') > submit.lastIndexOf("toast('Net Earned must be a number'"), true);
  const eSubmit = ExpenseSrc.slice(ExpenseSrc.indexOf('const submit = async'), ExpenseSrc.indexOf('const del ='));
  eq('ExpenseForm runs the same validation for add and update',
     eSubmit.indexOf('s.editE') > eSubmit.lastIndexOf("toast('Amount is required'"), true);
  /* Inventory: the item form validates property+category on BOTH paths, but
     the worker only enforces them on invAddItem — an update may blank them. */
  const w = read('../worker/src/index.js');
  const addI = w.slice(w.indexOf('async function invAddItem'), w.indexOf('async function invUpdateItem'));
  const updI = w.slice(w.indexOf('async function invUpdateItem'), w.indexOf('async function invDeleteItem'));
  eq('worker invAddItem requires property + category', /Property is required/.test(addI) && /Category is required/.test(addI), true);
  eq('PINNED worker invUpdateItem requires neither', /Property is required|Category is required/.test(updI), false);
  eq('client compensates on both paths', /Property is required/.test(InvSrc) && /Category is required/.test(InvSrc), true);
  /* Opening stock is add-only by design (Inventory.tsx:316). */
  eq('opening stock is offered only when adding', /\{!editI && \(/.test(InvSrc), true);
}

/* ══════════════════════════════════════════════════════════════════════════
   8 · PROPERTY RENAME ORPHANS ITS ROWS  (PINNED)
   bookings.property / expenses.property store the property NAME as text.
   invUpdateItem re-points inv_movements.item_key when an item is renamed;
   updateProperty does no equivalent, so renaming a property detaches every
   booking and expense already filed under the old name.
   ══════════════════════════════════════════════════════════════════════════ */
{
  const w = read('../worker/src/index.js');
  const updP = w.slice(w.indexOf('async function updateProperty'), w.indexOf('/* ─────────────── DASHBOARD'));
  eq('PINNED updateProperty rewrites no dependent rows', /UPDATE bookings|UPDATE expenses/.test(updP), false);
  const updI = w.slice(w.indexOf('async function invUpdateItem'), w.indexOf('async function invDeleteItem'));
  eq('invUpdateItem does re-point its dependents', /UPDATE inv_movements SET item_key/.test(updI), true);
  eq('PropertyForm exposes the name as a free-text field', /value=\{f\.name\} onChange=\{set\('name'\)\}/.test(PropertySrc), true);
  /* INVARIANT — a rent of exactly 0 must survive a round trip. The old
     `p.rent ? …` turned a stored 0 into '', which saves back as NULL. */
  eq('INVARIANT rent 0 is preserved, not blanked',
     /rent: p\.rent === '' \|\| p\.rent == null \? '' : String\(p\.rent\)/.test(PropertySrc), true);
  eq('PINNED …and blank becomes NULL', optNum(''), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('\n' + failures.join('\n')); process.exit(1); }
