/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Date-default probe under a faked wall clock.
   The bug window is 00:00–05:29 IST, where the UTC day is still yesterday.
   Fixed instant: 2026-09-30T20:45:00Z == 2026-10-01 02:15 IST.
   So local day = 2026-10-01 / month 2026-10; UTC day = 2026-09-30 / month 2026-09.
   Anything reading 2026-09-30 or 2026-09 is the UTC bug.               */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = 'http://127.0.0.1:8124/';
const API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/clockdate';
const FIXED = new Date('2026-09-30T20:45:00.000Z');
const EXPECT_DAY = '2026-10-01', EXPECT_MONTH = '2026-10';
const UTC_DAY = '2026-09-30', UTC_MONTH = '2026-09';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  timezoneId: 'Asia/Kolkata', locale: 'en-IN',
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
});
const page = await ctx.newPage();
await page.clock.setFixedTime(FIXED);

const nonLocal = [];
page.on('request', (r) => {
  const u = r.url();
  if (/^https?:\/\//.test(u) && !u.startsWith(API) && !u.startsWith(APP)) nonLocal.push(u.slice(0, 120));
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

let n = 0;
const shot = async (l) => { const f = `${OUT}/${String(++n).padStart(2, '0')}-${l}.png`; await page.screenshot({ path: f }); return f; };
const vis = (t) => page.getByText(t, { exact: false }).locator('visible=true');
const tap = async (t, k = 0) => { const l = vis(t).nth(k); await l.waitFor({ state: 'visible', timeout: 8000 }); await l.click({ timeout: 8000 }); await page.waitForTimeout(600); };

/* Every visible date/month input with the nearest label text above it. */
const readDateInputs = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input[type=date],input[type=month]')) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    let lab = '', node = el;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const t = (node.innerText || '').trim().split('\n')[0];
      if (t && t.length < 50) { lab = t; break; }
    }
    out.push({ label: lab, type: el.type, value: el.value, y: Math.round(r.top) });
  }
  return out.sort((a, b) => a.y - b.y);
});

const results = {};
const record = async (name) => {
  const v = await readDateInputs();
  results[name] = v;
  console.log(`\n## ${name}`);
  for (const f of v) {
    const bad = f.type === 'date' ? f.value === UTC_DAY : f.value === UTC_MONTH;
    const good = f.type === 'date' ? f.value === EXPECT_DAY : f.value === EXPECT_MONTH;
    console.log(`   [${f.type}] "${f.label}" = ${f.value || '(blank)'}  ${bad ? '<< UTC BUG' : good ? 'OK-local' : ''}`);
  }
  await shot(name);
};

await page.goto(APP, { waitUntil: 'load' });
console.log('browser clock:', await page.evaluate(() => new Date().toString()));
console.log('local day:', await page.evaluate(() => { const d = new Date(), z = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); }));
console.log('utc day   :', await page.evaluate(() => new Date().toISOString().slice(0, 10)));
if (await vis('Skip').count()) { await vis('Skip').first().click(); await page.waitForTimeout(900); }
await page.getByPlaceholder('Username', { exact: false }).first().fill('manager');
await page.getByPlaceholder('PIN', { exact: false }).first().fill(process.env.MANAGER_PIN);
await tap('Unlock');
await page.waitForTimeout(2000);
await shot('signed-in');

/* 1. Add → Booking */
await tap('Add');
await page.waitForTimeout(800);
await record('booking');

/* 2. Add → Expense */
await tap('Expense');
await page.waitForTimeout(700);
await record('expense');

/* 3. Add → Saving */
await tap('Saving');
await page.waitForTimeout(700);
await record('saving');

/* 4. Add → Inventory → Move */
await tap('Inventory');
await page.waitForTimeout(900);
try { await tap('Move'); await page.waitForTimeout(700); } catch (e) { console.log('Move seg:', e.message.slice(0, 80)); }
await record('inventory-move');

/* 5a. Inventory Items -> row "Log" quick stock movement */
try {
  await tap('Items');
  await page.waitForTimeout(700);
  const lg = page.getByText('Log', { exact: true }).locator('visible=true').first();
  await lg.click({ timeout: 6000 });
  await page.waitForTimeout(900);
  await record('inventory-rowlog');
} catch (e) { console.log('rowlog unavailable:', e.message.slice(0, 140)); results['inventory-rowlog'] = 'unavailable'; }

/* 5b. Action tab low-stock "+ Add stock" (needs scrolling) */
await tap('Action');
await page.waitForTimeout(1500);
let found = false;
for (let i = 0; i < 14 && !found; i++) {
  if (await page.getByText('Add stock', { exact: false }).locator('visible=true').count()) { found = true; break; }
  await page.mouse.wheel(0, 700); await page.waitForTimeout(350);
}
if (found) {
  await page.getByText('Add stock', { exact: false }).locator('visible=true').first().click({ timeout: 6000 });
  await page.waitForTimeout(1500);
  await record('inventory-quicklog');
} else { console.log('no low-stock "+ Add stock" card on Action'); results['inventory-quicklog'] = 'no low-stock card present'; }

/* 6. Calendar today marker */
await tap('Calendar');
await page.waitForTimeout(1400);
const cal = await page.evaluate(() => (document.body.innerText || '').slice(0, 2500));
results.calendarText = cal;
/* The today marker is a filled navy circle (st.todayCircle backgroundColor C.navy)
   wrapped round the day number. Find which day number carries it. */
results.calendarToday = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('div')) {
    const t = (el.textContent || '').trim();
    if (!/^\d{1,2}$/.test(t)) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      const r = el.getBoundingClientRect();
      if (r.width && r.width < 60) hits.push({ day: t, bg, w: Math.round(r.width) });
    }
  }
  return hits;
});
results.calendarMonthHeading = (cal.match(/\n(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\n/) || [])[0];
console.log('calendar month heading:', JSON.stringify(results.calendarMonthHeading));
console.log('calendar filled-circle day cells:', JSON.stringify(results.calendarToday));
await shot('calendar');

/* 7. Report Last 7 / Last 30 range bounds */
await tap('Report');
await page.waitForTimeout(1500);
/* Last 7 / Last 30 are picker options; the bounds never render as inputs — they
   travel as ?from=&to= on the dashboard call. Read them off the wire. */
const rng = {};
const seen = [];
page.on('request', (r) => { if (r.url().startsWith(API)) seen.push(r.url()); });
for (const label of ['Last 7 days', 'Last 30 days']) {
  try {
    seen.length = 0;
    const cur = page.getByText(/All time|Last 7 days|Last 30 days|Custom/).locator('visible=true').first();
    await cur.scrollIntoViewIfNeeded(); await cur.click({ timeout: 6000 });
    await page.waitForTimeout(600);
    await page.getByText(label, { exact: true }).locator('visible=true').first().click({ timeout: 6000 });
    await page.waitForTimeout(1800);
    const urls = seen.filter((u) => /action=dashboard/.test(u)).map((u) => {
      const q = new URL(u).searchParams; return { from: q.get('from'), to: q.get('to') };
    });
    rng[label] = urls.length ? urls : 'no dashboard call seen';
    await shot('report-' + label.replace(/\W+/g, ''));
  } catch (e) { rng[label] = 'not found: ' + e.message.split('\n')[0].slice(0, 90); }
}
results.reportRanges = rng;
console.log('\n## report ranges'); console.log(JSON.stringify(rng, null, 1));

results.nonLocalRequests = [...new Set(nonLocal)];
results.consoleErrors = errors.slice(0, 8);
writeFileSync(`${OUT}/dates.json`, JSON.stringify(results, null, 2));
console.log('\nnon-local requests:', results.nonLocalRequests.length ? results.nonLocalRequests : 'none');
console.log('artifacts:', OUT);
await browser.close();
