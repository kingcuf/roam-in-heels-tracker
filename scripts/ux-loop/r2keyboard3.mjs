/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* (a) can a tabbed-to picker be opened with Enter/Space?
   (b) does a non-numeric amount reach the API?  */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/r2-qa-keyboard3';
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

/* Tab until the focused element is the "Stay ▾" picker, then press the key. */
for (const key of ['Enter', ' ']) {
  await p.evaluate(() => { const i = document.querySelector('input'); i && i.focus(); });
  let landed = null;
  for (let i = 0; i < 30; i++) {
    await p.keyboard.press('Tab'); await p.waitForTimeout(50);
    const t = await p.evaluate(() => (document.activeElement.innerText || '').trim().replace(/\s+/g, ' '));
    if (/^Stay ▾$/.test(t)) { landed = t; break; }
  }
  if (!landed) { R['picker_' + key] = 'never focused'; console.log(key, 'never focused the picker'); continue; }
  await p.keyboard.press(key === ' ' ? 'Space' : key);
  await p.waitForTimeout(1300);
  const opened = await p.evaluate(() => !!document.querySelector('div[aria-label=Close]'));
  R['picker_' + (key === ' ' ? 'Space' : key)] = { landed, opened };
  console.log(`picker focused via Tab ("${landed}") + ${key === ' ' ? 'Space' : key} → sheet open: ${opened}`);
  await shot('picker-' + (key === ' ' ? 'space' : 'enter'));
  if (opened) { await p.locator('div[aria-label=Close]').first().click({ force: true }); await p.waitForTimeout(900); }
}

/* Non-numeric amount on the wire. */
await p.getByText('Expense', { exact: true }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1200);
await p.getByText('Select…', { exact: false }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1800);
await p.getByText('Caretaker', { exact: true }).locator('visible=true').last().click({ force: true, timeout: 8000 });
await p.waitForTimeout(900);
await p.getByPlaceholder('e.g. Monthly rent').first().fill('r2 non-numeric amount test');
await p.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let buf = [];
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e.tagName === 'INPUT' && vz(e)) { if (buf.some((x) => /^Amount/.test(x)) && e.type !== 'date') { e.setAttribute('data-amt', '1'); return; } continue; }
    const t = (e.textContent || '').trim();
    if (t && !t.includes('\n') && t.length < 40 && !e.querySelector('input') && vz(e)) { buf.push(t); if (buf.length > 4) buf.shift(); }
  }
});
await p.locator('input[data-amt]').fill('abc');
const before = urls.length;
await p.getByText('Submit for approval', { exact: false }).locator('visible=true').first().click();
await p.waitForTimeout(3000);
const add = urls.slice(before).filter((u) => /action=addExpense/.test(u));
R.nonNumericOnWire = add.map((u) => JSON.parse(decodeURIComponent(new URL(u).searchParams.get('payload') || '{}')).amount);
R.nonNumericResult = ((await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/(request #\d+|Enter [^.]{0,50}|Pick a [^.]{0,50}|Amount[^.]{0,50})/i) || [])[0];
console.log('\namount "abc" → API calls:', add.length, '| payload amount:', JSON.stringify(R.nonNumericOnWire), '| on screen:', JSON.stringify(R.nonNumericResult));
await shot('nonnumeric');
writeFileSync(`${OUT}/keyboard3.json`, JSON.stringify(R, null, 2));
console.log('artifacts:', OUT);
await b.close();
