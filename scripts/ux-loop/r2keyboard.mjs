/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/* WEB keyboard / typing ergonomics at 390 px.
   Attribute values off the DOM, not impressions. */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const APP = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8787/';
const OUT = process.argv[2] || '/tmp/ux-out/r2-qa-keyboard';
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, timezoneId: 'Asia/Kolkata' });
const p = await ctx.newPage();
const nonLocal = [];
p.on('request', (r) => { const u = r.url(); if (/^https?:/.test(u) && !u.startsWith(API) && !u.startsWith(APP)) nonLocal.push(u.slice(0, 110)); });
let n = 0; const shot = (l) => p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${l}.png` });
const vis = (t) => p.getByText(t, { exact: false }).locator('visible=true');
const R = {};

/* Label + every keyboard-relevant attribute of each VISIBLE input/textarea. */
const fieldAttrs = () => p.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let buf = [];
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') {
      if (!vz(e)) continue;
      const r = e.getBoundingClientRect();
      out.push({
        label: buf.filter((x) => x !== '*' && x !== '▾').slice(-2).join(' / '),
        tag: e.tagName.toLowerCase(),
        type: e.getAttribute('type'),
        inputmode: e.getAttribute('inputmode') || e.inputMode || null,
        pattern: e.getAttribute('pattern'),
        autocapitalize: e.getAttribute('autocapitalize'),
        autocorrect: e.getAttribute('autocorrect'),
        autocomplete: e.getAttribute('autocomplete'),
        spellcheck: e.getAttribute('spellcheck'),
        maxlength: e.getAttribute('maxlength'),
        enterkeyhint: e.getAttribute('enterkeyhint'),
        placeholder: e.getAttribute('placeholder'),
        tabindex: e.getAttribute('tabindex'),
        x: Math.round(r.left), y: Math.round(r.top + window.scrollY),
        w: Math.round(r.width), h: Math.round(r.height),
      });
      continue;
    }
    const t = (e.textContent || '').trim();
    if (t && !t.includes('\n') && t.length < 40 && !e.querySelector('input,textarea') && vz(e)) { buf.push(t); if (buf.length > 5) buf.shift(); }
  }
  return out;
});

await p.goto(APP, { waitUntil: 'load' });
try { await vis('Skip').first().waitFor({ state: 'visible', timeout: 12000 }); await vis('Skip').first().click(); await p.waitForTimeout(1200); } catch {}
await p.getByPlaceholder('Username').first().waitFor({ timeout: 20000 });

/* ── sign-in ── */
R.signin = await fieldAttrs();
R.signinAutofocus = await p.evaluate(() => {
  const a = document.activeElement;
  return a ? { tag: a.tagName, type: a.getAttribute && a.getAttribute('type'), ph: a.getAttribute && a.getAttribute('placeholder') } : null;
});
/* PIN masking: does the rendered value show characters? */
await p.getByPlaceholder('PIN').first().fill('1234');
R.pinMasked = await p.evaluate(() => {
  const e = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('PIN'));
  return { type: e.type, valueInDom: e.value, computedSecurity: getComputedStyle(e).webkitTextSecurity || null,
           autocomplete: e.getAttribute('autocomplete'), inputmode: e.getAttribute('inputmode') };
});
await shot('signin');
/* Tab order on sign-in */
await p.getByPlaceholder('Username').first().focus();
R.signinTab = [];
for (let i = 0; i < 5; i++) {
  R.signinTab.push(await p.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    return (a.getAttribute && (a.getAttribute('placeholder') || a.getAttribute('aria-label'))) || (a.innerText || '').trim().slice(0, 24) || a.tagName;
  }));
  await p.keyboard.press('Tab');
}
/* Enter on the PIN field: does it sign in? */
await p.getByPlaceholder('Username').first().fill('manager');
await p.getByPlaceholder('PIN').first().fill(process.env.MANAGER_PIN);
const before = p.url();
await p.keyboard.press('Enter');
await p.waitForTimeout(2500);
R.enterSignsIn = await p.evaluate(() => /need attention|Approvals|Total Revenue/i.test(document.body.innerText));
console.log('Enter on PIN signs in:', R.enterSignsIn);
if (!R.enterSignsIn) { await vis('Unlock').first().click(); await p.waitForTimeout(3000); }
await shot('after-signin');

/* ── each form ── */
const forms = [['booking', 'Booking'], ['expense', 'Expense'], ['saving', 'Saving'], ['inventory', 'Inventory']];
await vis('Add').first().click(); await p.waitForTimeout(1200);
R.forms = {};
for (const [key, seg] of forms) {
  await p.getByText(seg, { exact: true }).locator('visible=true').first().click({ force: true });
  await p.waitForTimeout(1200);
  if (key === 'inventory') { try { await p.getByText('Move', { exact: true }).locator('visible=true').first().click({ force: true }); await p.waitForTimeout(900); } catch {} }
  R.forms[key] = { fields: await fieldAttrs() };
  R.forms[key].autofocus = await p.evaluate(() => {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')
      ? { tag: a.tagName, type: a.type, ph: a.placeholder } : 'none (body/other)';
  });
  await shot('form-' + key);
  console.log(`\n== ${key}: ${R.forms[key].fields.length} visible inputs, autofocus ${JSON.stringify(R.forms[key].autofocus)}`);
  for (const f of R.forms[key].fields)
    console.log(`   ${String(f.label).padEnd(30)} type=${f.type} inputmode=${f.inputmode} autocap=${f.autocapitalize} autocorr=${f.autocorrect} spell=${f.spellcheck} autocomp=${f.autocomplete} enterkey=${f.enterkeyhint}`);
}

/* ── what a money field accepts ── */
await p.getByText('Expense', { exact: true }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1200);
const amountSel = await p.evaluate(() => {
  const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let buf = [];
  while (w.nextNode()) {
    const e = w.currentNode;
    if (e.tagName === 'INPUT' && vz(e)) {
      if (buf.some((x) => /^Amount/.test(x)) && e.type !== 'date') { e.setAttribute('data-amt', '1'); return true; }
      continue;
    }
    const t = (e.textContent || '').trim();
    if (t && !t.includes('\n') && t.length < 40 && !e.querySelector('input') && vz(e)) { buf.push(t); if (buf.length > 4) buf.shift(); }
  }
  return false;
});
R.moneyAccepts = {};
if (amountSel) {
  const amt = p.locator('input[data-amt]');
  for (const [name, typed] of [['letters', 'abc'], ['mixed', '12ab34'], ['two dots', '1.2.3'], ['leading minus', '-500'],
                               ['rupee+comma paste', '₹25,000'], ['exponent', '1e3'], ['spaces', '1 000']]) {
    await amt.fill('');
    await amt.type(typed, { delay: 10 }).catch(async () => { await amt.fill(typed); });
    const stored = await amt.inputValue();
    R.moneyAccepts[name] = { typed, stored, changed: stored !== typed };
    console.log(`money field: typed ${JSON.stringify(typed)} → stored ${JSON.stringify(stored)}`);
  }
  await amt.fill('');
}

/* ── Enter inside a text field on a form ── */
await p.getByPlaceholder('e.g. Monthly rent').first().fill('enter test');
const callsBefore = [];
p.on('request', (r) => { if (r.url().startsWith(API)) callsBefore.push(r.url()); });
await p.getByPlaceholder('e.g. Monthly rent').first().press('Enter');
await p.waitForTimeout(1500);
R.enterOnForm = {
  fieldValueAfter: await p.getByPlaceholder('e.g. Monthly rent').first().inputValue(),
  apiCallsFired: callsBefore.map((u) => new URL(u).searchParams.get('action')),
  toast: (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').match(/(Pick a category|request #\d+|Enter [^.]{0,40})/i),
};
console.log('\nEnter inside Item field →', JSON.stringify(R.enterOnForm));
await shot('enter-on-form');

/* ── Tab order through the Add Booking form vs visual order ── */
await p.getByText('Booking', { exact: true }).locator('visible=true').first().click({ force: true });
await p.waitForTimeout(1200);
const visual = (await fieldAttrs()).map((f, i) => ({ i, label: f.label, y: f.y, x: f.x }));
R.bookingVisualOrder = visual.map((v) => v.label);
await p.evaluate(() => { const i = document.querySelector('input'); i && i.focus(); });
R.tabOrder = [];
for (let i = 0; i < 40; i++) {
  const cur = await p.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') {
      const r = a.getBoundingClientRect();
      return { kind: a.tagName.toLowerCase(), type: a.type, ph: a.placeholder || '', y: Math.round(r.top + window.scrollY) };
    }
    return { kind: 'other', text: (a.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 28) };
  });
  R.tabOrder.push(cur);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(60);
}
R.tabReachesInputs = R.tabOrder.filter((t) => t && t.kind !== 'other').length;
R.tabMonotonic = (() => {
  const ys = R.tabOrder.filter((t) => t && t.y !== undefined).map((t) => t.y);
  return ys.every((v, i) => i === 0 || v >= ys[i - 1]);
})();
console.log('\ntab stops over 40 presses:', R.tabOrder.length, '| inputs reached:', R.tabReachesInputs, '| y-monotonic:', R.tabMonotonic);
console.log(JSON.stringify(R.tabOrder.slice(0, 20)));

/* ── keyboard-up viewport: which fields sit under a 300 px keyboard ── */
await p.setViewportSize({ width: 390, height: 544 });
await p.waitForTimeout(800);
R.keyboardUp = [];
const fields844 = await fieldAttrs();
for (let i = 0; i < fields844.length; i++) {
  const ok = await p.evaluate((idx) => {
    const vz = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && e.offsetParent !== null; };
    const ins = [...document.querySelectorAll('input,textarea')].filter(vz);
    const e = ins[idx];
    if (!e) return null;
    e.focus();
    const r = e.getBoundingClientRect();
    return { label: e.placeholder || e.type, top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= 544 };
  }, i);
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => {
    const a = document.activeElement;
    if (!a || (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA')) return null;
    const r = a.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= 544 };
  });
  if (ok) R.keyboardUp.push({ idx: i, label: fields844[i] && fields844[i].label, onFocus: ok.inView, afterSettle: after && after.inView, top: after && after.top });
}
R.fieldsHiddenUnderKeyboard = R.keyboardUp.filter((f) => f.afterSettle === false);
console.log('\nfields NOT scrolled into the 544 px visible area on focus:', R.fieldsHiddenUnderKeyboard.length, 'of', R.keyboardUp.length);
console.log(JSON.stringify(R.fieldsHiddenUnderKeyboard.slice(0, 12)));
await shot('keyboard-up');

R.nonLocal = [...new Set(nonLocal)];
writeFileSync(`${OUT}/keyboard.json`, JSON.stringify(R, null, 2));
console.log('\nnon-local:', R.nonLocal.length ? R.nonLocal : 'none', '| artifacts', OUT);
await b.close();
