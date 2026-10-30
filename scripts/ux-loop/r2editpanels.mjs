/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Amber-panel count on the booking edit form for several rows, so both cases
   are covered: a record WITH a pending request and one WITHOUT. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/r2-qa-editpanels';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, timezoneId: 'Asia/Kolkata' });
const p = await ctx.newPage();
let n = 0; const shot = (l) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${l}.png` });
const vis = (t) => p.getByText(t, { exact: false }).locator('visible=true');
const amber = () => p.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('div')) {
    if (el.offsetParent === null) continue;
    if (getComputedStyle(el).backgroundColor !== 'rgb(248, 241, 228)') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 24) continue;
    hits.push({ h: Math.round(r.height), y: Math.round(r.top + window.scrollY), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 150) });
  }
  return hits.filter((a, i) => !hits.some((c, j) => j !== i && c.y <= a.y && c.y + c.h >= a.y + a.h && c.h > a.h));
});
await p.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await p.waitForTimeout(1200); } catch {}
await p.getByPlaceholder('Username').first().waitFor({ timeout: 20000 });
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
await vis('Unlock').first().click(); await p.waitForTimeout(3200);
await vis('Add').first().click(); await p.waitForTimeout(1200);
const R = { rows: [] };
for (let i = 0; i < 6; i++) {
  await vis('☰ Log').first().click({ force: true }); await p.waitForTimeout(2400);
  const opened = await p.evaluate((idx) => {
    const rows = [...document.querySelectorAll('div[tabindex]')].filter((e) => {
      if (e.offsetParent === null) return false;
      const t = (e.innerText || '').trim(); const r = e.getBoundingClientRect();
      return r.width > 250 && /\d{4}-\d{2}-\d{2}/.test(t) && /Spira/.test(t);
    });
    const e = rows[idx]; if (!e) return null;
    e.setAttribute('data-pick', '1');
    return (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
  }, i);
  if (!opened) break;
  await p.locator('div[data-pick]').first().click({ force: true });
  await p.waitForTimeout(2400);
  await p.evaluate(() => document.querySelectorAll('[data-pick]').forEach((e) => e.removeAttribute('data-pick')));
  const a = await amber();
  R.rows.push({ row: opened, panels: a.length, texts: a.map((x) => x.text) });
  console.log(`row ${i} "${opened}" → ${a.length} amber panel(s)`);
  a.forEach((x) => console.log('     ', x.text.slice(0, 120)));
  await shot('row' + i);
  await vis('Cancel edit').first().click({ force: true }).catch(() => {});
  await p.waitForTimeout(1200);
}
writeFileSync(`${OUT}/editpanels.json`, JSON.stringify(R, null, 2));
console.log('artifacts:', OUT);
await b.close();
