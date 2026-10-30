/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Report waiting-panel checks: current-month KPI figures, the queued panel's
   text, whether it respects the property filter, and whether it is absent for
   an Admin.  node r2report.mjs <outdir> <manager|owner>                    */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2], WHO = process.argv[3] || 'manager';
const U = { manager: ['manager', process.env.MANAGER_PIN], owner: ['owner', process.env.PIN], staff: ['staff', process.env.STAFF_PIN] }[WHO];
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, timezoneId: 'Asia/Kolkata' });
const p = await ctx.newPage();
const nonLocal = [];
p.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !u.startsWith(API) && !u.startsWith(APP)) nonLocal.push(u.slice(0, 110)); });
let n = 0; const shot = (l) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${l}.png` });
const vis = (t) => p.getByText(t, { exact: false }).locator('visible=true');
const R = { who: WHO };

await p.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await p.waitForTimeout(1200); } catch {}
await p.getByPlaceholder('Username').first().waitFor({ timeout: 20000 });
await p.getByPlaceholder('Username').first().fill(U[0]);
await p.getByPlaceholder('PIN').first().fill(U[1]);
await vis('Unlock').first().click(); await p.waitForTimeout(3000);
await vis('Report').first().click(); await p.waitForTimeout(2600);

const grab = async () => {
  const t = await p.evaluate(() => document.body.innerText);
  return {
    curMonth: (t.match(/[A-Z]{3} \d{4} \(CURRENT MONTH\)[\s\S]{0,180}/) || [''])[0].replace(/\n+/g, ' | '),
    queued: (t.match(/Waiting for approval[\s\S]{0,420}/) || [''])[0],
    hasQueued: /Waiting for approval — not in any figure above/.test(t),
  };
};
R.all = await grab(); await shot('report-all');
console.log(`[${WHO}] queued panel present:`, R.all.hasQueued);
console.log('cur month:', R.all.curMonth);
console.log('queued:\n', R.all.queued);

/* property filter */
try {
  const filt = p.getByText('All', { exact: true }).locator('visible=true').first();
  await filt.scrollIntoViewIfNeeded(); await filt.click({ timeout: 8000, force: true });
  await p.waitForTimeout(1800); await shot('filter-sheet');
  const opts = await p.evaluate(() => [...document.querySelectorAll('div')]
    .filter((e) => e.offsetParent !== null && !e.querySelector('div'))
    .map((e) => (e.innerText || '').trim()).filter((t) => /^Spira /.test(t)));
  R.propertyOptions = [...new Set(opts)];
  console.log('property options:', JSON.stringify(R.propertyOptions));
  R.byProperty = {};
  for (let i = 0; i < R.propertyOptions.length; i++) {
    if (i > 0) {
      const cur = p.getByText(new RegExp('^(All|' + R.propertyOptions.map((x) => x.replace(/ /g, ' ')).join('|') + ')$')).locator('visible=true').first();
      await cur.scrollIntoViewIfNeeded(); await cur.click({ timeout: 8000, force: true });
      await p.waitForTimeout(1800);
    }
    await p.getByText(R.propertyOptions[i], { exact: true }).locator('visible=true').last().click({ timeout: 8000, force: true });
    await p.waitForTimeout(2800);
    R.byProperty[R.propertyOptions[i]] = await grab();
    await shot('filtered-' + R.propertyOptions[i].replace(/\W+/g, ''));
    console.log(`\n== filtered to ${R.propertyOptions[i]} ==`);
    console.log('queued:', R.byProperty[R.propertyOptions[i]].queued.split('\n').slice(0, 4).join(' | '));
    console.log('curMonth:', R.byProperty[R.propertyOptions[i]].curMonth.slice(0, 120));
  }
} catch (e) { R.filterErr = e.message.split('\n')[0].slice(0, 120); console.log('filter:', R.filterErr); }

R.nonLocal = [...new Set(nonLocal)];
writeFileSync(`${OUT}/report.json`, JSON.stringify(R, null, 2));
console.log('non-local:', R.nonLocal.length ? R.nonLocal : 'none', '| artifacts', OUT);
await b.close();
