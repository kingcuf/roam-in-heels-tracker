/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Follow-ups: stable tab-order index, keyboard-operable pickers, and what a
   malformed money value actually puts on the wire. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/r2-qa-keyboard2';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, timezoneId: 'Asia/Kolkata' });
const p = await ctx.newPage();
const urls = []; p.on('request', (r) => { if (r.url().startsWith(API)) urls.push(r.url()); });
let n = 0; const shot = (l) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${l}.png` });
const vis = (t) => p.getByText(t, { exact: false }).locator('visible=true');
const R = {};

await p.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await p.waitForTimeout(1200); } catch {}
await p.getByPlaceholder('Username').first().waitFor({ timeout: 20000 });
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click(); await p.waitForTimeout(3200);
await vis('Add').first().click(); await p.waitForTimeout(1500);

/* Stamp every visible input with its document order, then walk Tab. */
await p.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  [...document.querySelectorAll('input,textarea')].filter(vz).forEach((e, i) => e.setAttribute('data-ord', String(i)));
  /* and every focusable non-input control (the custom pickers) */
  [...document.querySelectorAll('div[tabindex]')].filter(vz).forEach((e, i) => e.setAttribute('data-ctl', String(i)));
});
R.visibleInputs = await p.evaluate(() => [...document.querySelectorAll('input[data-ord]')].map((e) => ({
  ord: +e.dataset.ord, type: e.type, ph: e.placeholder, y: Math.round(e.getBoundingClientRect().top + window.scrollY) })));
await p.evaluate(() => document.querySelector('input[data-ord="0"]').focus());
R.tab = [];
for (let i = 0; i < 60; i++) {
  R.tab.push(await p.evaluate(() => {
    const a = document.activeElement;
    if (!a) return 'none';
    if (a.dataset && a.dataset.ord !== undefined) return 'input#' + a.dataset.ord + ' ' + (a.placeholder || a.type);
    if (a.tagName === 'INPUT') return 'input(date-segment) ' + a.type;
    return 'ctl:' + (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  }));
  await p.keyboard.press('Tab');
  await p.waitForTimeout(40);
}
const ords = R.tab.map((s) => { const m = s.match(/^input#(\d+)/); return m ? +m[1] : null; }).filter((x) => x !== null);
R.inputOrdsInTabOrder = ords;
R.tabMonotonic = ords.every((v, i) => i === 0 || v > ords[i - 1]);
R.inputsReachedByTab = new Set(ords).size;
R.totalVisibleInputs = R.visibleInputs.length;
console.log('visible inputs:', R.totalVisibleInputs, '| reached by 60 Tabs:', R.inputsReachedByTab,
            '| in document order:', R.tabMonotonic);
console.log('tab sequence:', JSON.stringify(R.tab.slice(0, 32)));

/* Can a picker be opened from the keyboard? */
R.pickerKeyboard = {};
for (const key of ['Enter', 'Space']) {
  await p.evaluate(() => { document.querySelectorAll('[data-open]').forEach((e) => e.removeAttribute('data-open')); });
  const ctl = p.getByText('Stay', { exact: false }).locator('visible=true').first();
  await ctl.focus().catch(() => {});
  const focused = await p.evaluate(() => (document.activeElement.innerText || '').trim().slice(0, 20));
  await p.keyboard.press(key);
  await p.waitForTimeout(1200);
  const opened = await p.evaluate(() => !!document.querySelector('div[aria-label=Close]'));
  R.pickerKeyboard[key] = { focused, opened };
  console.log(`picker with ${key}: focused=${JSON.stringify(focused)} opened=${opened}`);
  if (opened) { await p.locator('div[aria-label=Close]').first().click({ force: true }); await p.waitForTimeout(800); }
}
await shot('picker-keyboard');

/* What a malformed money value puts on the wire. */
await p.getByText('Expense', { exact: true }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1200);
await p.getByText('Select…', { exact: false }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1800);
await p.getByText('Caretaker', { exact: true }).locator('visible=true').last().click({ force: true, timeout: 8000 });
await p.waitForTimeout(900);
await p.getByPlaceholder('e.g. Monthly rent').first().fill('r2 money wire test');
const amtOk = await p.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let buf = [];
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e.tagName === 'INPUT' && vz(e)) { if (buf.some((x) => /^Amount/.test(x)) && e.type !== 'date') { e.setAttribute('data-amt', '1'); return true; } continue; }
    const t = (e.textContent || '').trim();
    if (t && !t.includes('\n') && t.length < 40 && !e.querySelector('input') && vz(e)) { buf.push(t); if (buf.length > 4) buf.shift(); }
  }
  return false;
});
if (amtOk) {
  await p.locator('input[data-amt]').fill('₹25,000');
  const before = urls.length;
  await p.getByText('Submit for approval', { exact: false }).locator('visible=true').first().click();
  await p.waitForTimeout(2800);
  const add = urls.slice(before).filter((u) => /action=addExpense/.test(u));
  R.moneyOnWire = add.map((u) => {
    const pl = JSON.parse(decodeURIComponent(new URL(u).searchParams.get('payload') || '{}'));
    return { amount: pl.amount, item: pl.item, category: pl.category };
  });
  R.moneyResult = (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/(request #\d+|Enter [^.]{0,40}|Pick a [^.]{0,40})/i);
  console.log('\n"₹25,000" typed → on the wire:', JSON.stringify(R.moneyOnWire), '| result', JSON.stringify(R.moneyResult && R.moneyResult[0]));
  await shot('money-wire');
}
writeFileSync(`${OUT}/keyboard2.json`, JSON.stringify(R, null, 2));
console.log('artifacts:', OUT);
await b.close();
