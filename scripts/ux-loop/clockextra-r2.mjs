/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* The two things clockdate-r2 could not read as inputs:
   - Expense Month: MonthField is a TouchableOpacity showing "Mon YYYY", not <input>.
   - Report Last 7 / Last 30 bounds: never rendered; they travel as ?from=&to=.
   Same faked instant: 2026-10-01 02:15 IST (UTC day 2026-09-30, UTC month 2026-09). */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/clockextra';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  timezoneId: 'Asia/Kolkata', locale: 'en-IN',
});
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-09-30T20:45:00.000Z'));
const seen = [];
page.on('request', (r) => { if (r.url().startsWith(API)) seen.push(r.url()); });
let n = 0;
const shot = async (l) => page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${l}.png` });
const vis = (t) => page.getByText(t, { exact: false }).locator('visible=true');
const tap = async (t) => { const l = vis(t).first(); await l.waitFor({ state: 'visible', timeout: 8000 }); await l.click({ timeout: 8000 }); await page.waitForTimeout(700); };

await page.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await page.waitForTimeout(1200); } catch {}
await page.getByPlaceholder('Username', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
await page.getByPlaceholder('Username', { exact: false }).first().fill('manager');
await page.getByPlaceholder('PIN', { exact: false }).first().fill(process.env.MANAGER_PIN);
await tap('Unlock');
await page.waitForTimeout(2200);

const out = {};

/* ── Expense Month (MonthField text) ── */
await tap('Add'); await page.waitForTimeout(700);
await tap('Expense'); await page.waitForTimeout(900);
out.expenseMonthText = await page.evaluate(() => {
  const all = [...document.querySelectorAll('div,span')];
  const lab = all.find((e) => /^Expense Month\s*\*?$/.test((e.textContent || '').trim()));
  if (!lab) return 'label not found';
  /* walk forward in document order to the next element whose text is "Mon YYYY" */
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let seenLab = false, hit = null;
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e === lab) { seenLab = true; continue; }
    if (!seenLab) continue;
    const t = (e.textContent || '').trim();
    if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/.test(t)) { hit = t; break; }
    if (/^Pick a month/.test(t)) { hit = t; break; }
  }
  return hit || 'no month value found';
});
console.log('Expense Month prefill:', out.expenseMonthText);
await shot('expense-month');

/* ── Report range bounds off the wire ── */
await tap('Report'); await page.waitForTimeout(1800);
out.ranges = {};
for (const label of ['Last 7 days', 'Last 30 days']) {
  seen.length = 0;
  const cur = page.getByText(/^(All time|Last 7 days|Last 30 days|Custom…)$/).locator('visible=true').first();
  await cur.scrollIntoViewIfNeeded();
  await cur.click({ timeout: 8000 });
  await page.waitForTimeout(1800);
  await shot('picker-open');
  const opt = page.getByText(label, { exact: true }).locator('visible=true');
  const cnt = await opt.count();
  await opt.nth(cnt - 1).click({ timeout: 8000, force: true });
  await page.waitForTimeout(2200);
  const urls = seen.filter((u) => /action=dashboard/.test(u)).map((u) => {
    const q = new URL(u).searchParams; return { from: q.get('from'), to: q.get('to') };
  });
  out.ranges[label] = urls.length ? urls : 'no dashboard call';
  console.log(label, '->', JSON.stringify(out.ranges[label]));
  await shot('range-' + label.replace(/\W+/g, ''));
}
writeFileSync(`${OUT}/extra.json`, JSON.stringify(out, null, 2));
console.log('artifacts:', OUT);
await browser.close();
