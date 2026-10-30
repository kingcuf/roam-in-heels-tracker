/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* Round-2 state probe: expense category default + refusal, Report KPI figures
   and the waiting panel, edit-form amber-panel count and button geometry.
   Runs on the real clock (these findings are clock-independent).
     node r2state.mjs <outdir> [manager|owner]                              */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/r2state';
const WHO = process.argv[3] || 'manager';
const USERS = { manager: { u: 'manager', p: process.env.MANAGER_PIN }, owner: { u: 'owner', p: process.env.PIN }, staff: { u: 'staff', p: process.env.STAFF_PIN } };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  timezoneId: 'Asia/Kolkata', locale: 'en-IN',
});
const page = await ctx.newPage();
const calls = [], nonLocal = [], errors = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.startsWith(API)) calls.push(u);
  else if (/^https?:\/\//.test(u) && !u.startsWith(APP)) nonLocal.push(u.slice(0, 120));
});
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });

let n = 0;
const shot = async (l) => { const f = `${OUT}/${String(++n).padStart(2, '0')}-${l}.png`; await page.screenshot({ path: f, fullPage: false }); return f; };
const vis = (t) => page.getByText(t, { exact: false }).locator('visible=true');
const tap = async (t, opts = {}) => { const l = vis(t).nth(opts.n || 0); await l.waitFor({ state: 'visible', timeout: 10000 }); await l.click({ timeout: 10000, force: !!opts.force }); await page.waitForTimeout(opts.settle ?? 700); };

/* Amber panels: the app's one "waiting for approval" pattern is backgroundColor
   #F8F1E4 (C.amberbg) on a bordered box. Count the visible, non-nested ones. */
const amberPanels = () => page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('div')) {
    if (el.offsetParent === null) continue;
    const cs = getComputedStyle(el);
    if (cs.backgroundColor !== 'rgb(248, 241, 228)') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 150 || r.height < 24) continue;   // skip pills/chips
    hits.push({ w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.top + window.scrollY),
                text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160) });
  }
  /* drop panels fully contained in another hit (nested styling) */
  return hits.filter((a, i) => !hits.some((b, j) => j !== i && b.y <= a.y && b.y + b.h >= a.y + a.h && b.h > a.h));
});

/* Every button's box + whether its label is clipped inside its own element. */
const buttonBoxes = () => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('div[tabindex],button,[role=button]')) {
    const t = (el.innerText || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 40) continue;
    if (el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    out.push({ text: t, x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
               w: Math.round(r.width), h: Math.round(r.height),
               clipped: el.scrollWidth > el.clientWidth + 1 });
  }
  return out;
});

const res = { who: WHO };

await page.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await page.waitForTimeout(1200); } catch {}
await page.getByPlaceholder('Username', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
await page.getByPlaceholder('Username', { exact: false }).first().fill(USERS[WHO].u);
await page.getByPlaceholder('PIN', { exact: false }).first().fill(USERS[WHO].p);
await tap('Unlock', { settle: 2500 });
await shot('signed-in');

/* ── 1. Report: current-month KPI figures + waiting panel ── */
await tap('Report', { settle: 2200 });
res.reportText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+\n/g, '\n'));
res.reportKpis = await page.evaluate(() => {
  const txt = document.body.innerText || '';
  const grab = (re) => { const m = txt.match(re); return m ? m[1].trim() : null; };
  return {
    fullText: txt.slice(0, 4000),
    curMonthBlock: (txt.match(/[A-Z]{3} \d{4} \(CURRENT MONTH\)[\s\S]{0,400}/) || [''])[0],
  };
});
res.reportAmber = await amberPanels();
await shot('report');
console.log(`\n[${WHO}] report amber panels: ${res.reportAmber.length}`);
res.reportAmber.forEach((p) => console.log(`   ${p.w}x${p.h} @y${p.y}: ${p.text}`));
console.log('cur-month block:\n' + res.reportKpis.curMonthBlock);

/* Property filter: does the waiting panel respect it? */
try {
  const filt = page.getByText(/^All$/).locator('visible=true').first();
  await filt.scrollIntoViewIfNeeded(); await filt.click({ timeout: 8000 });
  await page.waitForTimeout(1800);
  await shot('filter-open');
  const opts = await page.evaluate(() => [...document.querySelectorAll('div')]
    .map((e) => (e.innerText || '').trim()).filter((t) => t && t.length < 30 && !t.includes('\n')));
  const prop = [...new Set(opts)].find((t) => /^\d{4}$/.test(t));
  if (prop) {
    await page.getByText(prop, { exact: true }).locator('visible=true').last().click({ timeout: 8000, force: true });
    await page.waitForTimeout(2200);
    res.filteredProperty = prop;
    res.reportAmberFiltered = await amberPanels();
    res.reportKpisFiltered = await page.evaluate(() => (document.body.innerText.match(/[A-Z]{3} \d{4} \(CURRENT MONTH\)[\s\S]{0,400}/) || [''])[0]);
    await shot('report-filtered');
    console.log(`filtered to ${prop}: amber panels ${res.reportAmberFiltered.length}`);
    res.reportAmberFiltered.forEach((p) => console.log(`   ${p.text}`));
  } else { res.filteredProperty = 'no property option found'; await page.keyboard.press('Escape'); }
} catch (e) { res.filteredProperty = 'filter failed: ' + e.message.split('\n')[0].slice(0, 90); }
/* make sure no picker sheet is left open over the tab bar */
const closeSheet = async () => {
  for (let i = 0; i < 4; i++) {
    const c = page.locator('div[aria-label=Close]');
    if (!(await c.count())) break;
    await c.first().click({ timeout: 4000, force: true }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(700);
  }
};
await closeSheet();

/* ── 2. Add → Expense: category default, then submit untouched ── */
await closeSheet();
await tap('Add', { settle: 900 });
await tap('Expense', { settle: 1100 });
res.expenseCategory = await page.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const all = [...document.querySelectorAll('div,span')].filter(vz);
  const lab = all.find((e) => /^Category\s*\*?$/.test((e.textContent || '').trim()));
  if (!lab) return 'label not found';
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let past = false;
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e === lab) { past = true; continue; }
    if (!past || !vz(e)) continue;
    const t = (e.textContent || '').trim();
    if (t && !t.includes('\n') && t.length < 30 && t !== 'Category' && t !== 'Category *') return t;
  }
  return 'no value found';
});
console.log('\nexpense Category prefill:', JSON.stringify(res.expenseCategory));
res.expenseAmber = await amberPanels();
await shot('expense-form');

/* fill only Item + Amount, leave Category alone, submit */
try {
  const item = page.getByPlaceholder('e.g. Monthly rent', { exact: false }).first();
  await item.fill('R2 QA category guard');
  const labs = await page.evaluate(() => {
    /* Walk the document once; remember the last field label seen before each
       input. following::input[1] picked up the date control instead. */
    const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let lastLab = '', hit = null, seen = [], buf = [];
    while (w.nextNode()) {
      const e = w.currentNode;
      if (e.tagName === 'INPUT') {
        if (!vz(e)) continue;
        seen.push({ lab: buf.join('|'), type: e.type });
        if (buf.some((b) => /^Amount/.test(b.replace(/\s*\*$/, ''))) && e.type !== 'date' && e.type !== 'month') { e.setAttribute('data-r2amount', '1'); hit = buf.join('|'); break; }
        continue;
      }
      const t = (e.textContent || '').trim();
      if (t && !t.includes('\n') && t.length < 40 && !e.querySelector('input') && vz(e)) { lastLab = t; buf.push(t); if (buf.length > 4) buf.shift(); }
    }
    return { hit, seen: seen.slice(0, 20) };
  });
  res.amountFieldLookup = labs;
  if (labs.hit) await page.locator('input[data-r2amount]').fill('137');
  else console.log('amount field not located; inputs seen:', JSON.stringify(labs.seen));
  await shot('expense-filled');
  const before = calls.length;
  await vis('Submit for approval').first().click({ timeout: 10000 });
  await page.waitForTimeout(900);
  res.expenseToastEarly = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 600);
  await shot('expense-toast');
  await page.waitForTimeout(1800);
  res.expenseSubmitCalls = calls.slice(before).map((u) => new URL(u).searchParams.get('action'));
  res.expenseSubmitText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200));
  res.expenseRefused = /Pick a category for this expense/i.test(res.expenseSubmitText);
  res.expenseAccepted = /request #\d+/i.test(res.expenseSubmitText);
  console.log('submit without touching Category → refused:', res.expenseRefused, '| accepted:', res.expenseAccepted);
  console.log('   calls:', JSON.stringify(res.expenseSubmitCalls));
  await shot('expense-submitted');
} catch (e) { res.expenseSubmit = 'failed: ' + e.message.split('\n')[0].slice(0, 120); console.log(res.expenseSubmit); }

/* ── 3. Edit form with a pending request against the record ──
   Deterministic route: open a booking row from the log, submit a change (that
   raises a ticket against that row), then re-open the SAME row. The form then
   carries both "you are editing X" and "a request is pending" — which is where
   two amber panels used to stack. */
const openLogRow = async () => {
  await tap('☰ Log', { settle: 2600 });
  const rowId = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div[tabindex]')].filter((e) => {
      if (e.offsetParent === null) return false;
      const t = (e.innerText || '').trim();
      const r = e.getBoundingClientRect();
      return r.width > 250 && /\d{4}-\d{2}-\d{2}/.test(t) && /Spira/.test(t);
    });
    if (!rows.length) return null;
    rows[0].setAttribute('data-r2row', '1');
    return (rows[0].innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  });
  if (!rowId) return null;
  await page.locator('div[data-r2row]').first().click({ timeout: 8000, force: true });
  await page.waitForTimeout(2600);
  await page.evaluate(() => document.querySelectorAll('[data-r2row]').forEach((e) => e.removeAttribute('data-r2row')));
  return rowId;
};

try {
  await tap('Booking', { settle: 1400 });
  res.addAmber = await amberPanels();
  res.addButtons = await buttonBoxes();
  await shot('add-booking');
  res.addClipped = res.addButtons.filter((b) => b.clipped);
  console.log('\nAdd Booking: amber panels', res.addAmber.length, '| clipped buttons', JSON.stringify(res.addClipped));

  res.editRowOpened = await openLogRow();
  await shot('edit-first-open');
  res.editAmberBeforeTicket = await amberPanels();
  console.log('edit (no request yet): amber panels', res.editAmberBeforeTicket.length,
              res.editAmberBeforeTicket.map((p) => p.text.slice(0, 70)));

  /* raise a request against this row */
  const notes = await page.evaluate(() => {
    const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let lastLab = '';
    while (w.nextNode()) {
      const e = w.currentNode;
      if (e.tagName === 'INPUT' && vz(e)) {
        if (/^Notes/.test(lastLab)) { e.setAttribute('data-r2notes', '1'); return true; }
        continue;
      }
      const t = (e.textContent || '').trim();
      if (t && !t.includes('\n') && t.length < 40 && e.children.length === 0 && vz(e)) lastLab = t;
    }
    return false;
  });
  if (notes) await page.locator('input[data-r2notes]').fill('r2 qa edit ' + Date.now());
  await tap('Submit for approval', { settle: 3000 });
  res.editSubmitText = (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 400);
  console.log('edit submit →', res.editSubmitText.slice(0, 160));
  await shot('edit-submitted');

  /* re-open the same record: now it has a pending request */
  res.editRowReopened = await openLogRow();
  await page.waitForTimeout(1200);
  await shot('edit-with-pending');
  res.editAmber = await amberPanels();
  res.editButtons = await buttonBoxes();
  console.log('Edit Booking WITH pending request: amber panels', res.editAmber.length);
  res.editAmber.forEach((q) => console.log(`   ${q.w}x${q.h} @y${q.y}: ${q.text}`));
  const bt = res.editButtons;
  const danger = bt.find((b) => /delete/i.test(b.text));
  const primary = bt.find((b) => /Submit for approval|Save changes|Update request/i.test(b.text));
  res.geometry = { danger, primary, allButtons: bt.map((b) => b.text) };
  if (danger && primary) {
    res.geometry.sameRow = Math.abs(danger.y - primary.y) < 12;
    res.geometry.dangerBelowPrimary = danger.y >= primary.y + primary.h - 4;
    res.geometry.verticalGap = danger.y - (primary.y + primary.h);
    res.geometry.horizontalOverlap = Math.max(0, Math.min(danger.x + danger.w, primary.x + primary.w) - Math.max(danger.x, primary.x));
    console.log('danger ', JSON.stringify(danger));
    console.log('primary', JSON.stringify(primary));
    console.log('sameRow', res.geometry.sameRow, '| dangerBelowPrimary', res.geometry.dangerBelowPrimary,
                '| verticalGap', res.geometry.verticalGap, 'px | x-overlap', res.geometry.horizontalOverlap, 'px');
  } else console.log('geometry: danger/primary not both found:', JSON.stringify(bt.map((b) => b.text).slice(0, 25)));
  res.editClipped = bt.filter((b) => b.clipped);
  console.log('clipped buttons on edit:', JSON.stringify(res.editClipped));
  /* is there a horizontal rule above the danger button? */
  res.dangerRule = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('div')) {
      if (el.offsetParent === null) continue;
      const cs = getComputedStyle(el);
      if (parseFloat(cs.borderTopWidth) < 0.5) continue;
      const t = (el.innerText || '').trim();
      if (!/delete/i.test(t) || t.length > 40) continue;
      const r = el.getBoundingClientRect();
      out.push({ text: t.replace(/\s+/g, ' '), borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor,
                 paddingTop: cs.paddingTop, w: Math.round(r.width) });
    }
    return out;
  });
  console.log('rule above danger:', JSON.stringify(res.dangerRule));
} catch (e) { res.editProbe = 'failed: ' + e.message.split('\n')[0].slice(0, 160); console.log(res.editProbe); }

res.nonLocalRequests = [...new Set(nonLocal)];
res.consoleErrors = errors.slice(0, 8);
writeFileSync(`${OUT}/state.json`, JSON.stringify(res, null, 2));
console.log('\nnon-local requests:', res.nonLocalRequests.length ? res.nonLocalRequests : 'none');
console.log('artifacts:', OUT);
await browser.close();
