/* Sign-in credentials come from the environment, never from source: this
   repository is public and the PIN opens the live API. Run with e.g.
   PIN=… MANAGER_PIN=… STAFF_PIN=… node <script>. */
#!/usr/bin/env node
/**
 * Shared browser harness for the UX feedback loop (spira-user-sim,
 * spira-ux-expert, spira-ux-qa).
 *
 * It exists so all three agents drive the SAME app the same way: one script,
 * one set of timings, one screenshot convention. An agent that rolls its own
 * Playwright snippet produces numbers nobody else can compare against.
 *
 * Target is ALWAYS the local rig (app on :8124 → worker on :8787 → local D1).
 * It refuses to run against anything else, because these agents click "Save"
 * and "Delete" on whatever they find and must never touch live data.
 *
 *   node drive.mjs steps.json out/run-name
 *
 * steps.json: { "device": "phone"|"desktop", "user": {"name":"manager","pin":process.env.MANAGER_PIN},
 *               "steps": [ {...}, ... ] }
 *
 * Step kinds (each records its own timing + screenshot):
 *   {"tap":"Add"}                 press the first visible control whose text matches
 *   {"tapNth":"Save",  "n":2}     … the nth match (1-based)
 *   {"type":"Guest","into":"Lead guest"}   type into the field under that label
 *   {"expect":"Request #"}        assert text appears (fails the step if not)
 *   {"absent":"Save changes"}     assert text does NOT appear
 *   {"wait":800}                  fixed pause, ms
 *   {"note":"…"}                  annotate the transcript, no action
 *
 * Output: out/run-name/transcript.json + NN-<label>.png, and a one-line-per-step
 * summary on stdout so an agent can read the result without parsing JSON.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const APP = process.env.UX_APP || 'http://127.0.0.1:8124/';
const API = process.env.UX_API || 'http://127.0.0.1:8787/';
if (!/^http:\/\/127\.0\.0\.1:/.test(APP) || !/^http:\/\/127\.0\.0\.1:/.test(API)) {
  console.error('Refusing to run against a non-local target:', APP, API);
  process.exit(2);
}

const [specPath, outDir = 'out/run'] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
mkdirSync(outDir, { recursive: true });

/* A phone is the real device here — Himanshu works from one. Desktop is only
   for the owner's weekly read of the dashboard. */
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
           deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  desktop: { viewport: { width: 1280, height: 860 } },
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...DEVICES[spec.device || 'phone'], timezoneId: 'Asia/Kolkata', locale: 'en-IN' });
if (process.env.UX_FAKE_NOW) {
  await ctx.clock.install({ time: new Date(process.env.UX_FAKE_NOW) });
}
const page = await ctx.newPage();
if (process.env.UX_FAKE_NOW) { await ctx.clock.resume(); }

/* Every API call is timed: "the app feels slow" has to resolve to either the
   network or the render, and guessing between them wastes a whole round. */
const calls = [];
page.on('request', (r) => { if (r.url().startsWith(API)) r._t0 = Date.now(); });
page.on('response', async (res) => {
  const req = res.request();
  if (!req.url().startsWith(API)) return;
  const action = new URL(req.url()).searchParams.get('action');
  calls.push({ action, ms: Date.now() - (req._t0 || Date.now()), status: res.status(), at: Date.now() });
});
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)));

const transcript = [];
let n = 0;
const shot = async (label) => {
  const file = `${outDir}/${String(++n).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.png`;
  await page.screenshot({ path: file });
  return file;
};

/* Text-first targeting: these agents reason about what a person can SEE, so a
   step that needs a testID or a CSS path is a step that proves nothing about
   whether a human could find the control. */
const visible = (text) => page.getByText(text, { exact: false }).locator('visible=true');

async function step(s) {
  const t0 = Date.now();
  const before = calls.length;
  let label = '', ok = true, detail = '';
  try {
    if (s.note !== undefined) { label = 'note'; detail = s.note; }
    else if (s.wait !== undefined) { label = `wait-${s.wait}`; await page.waitForTimeout(s.wait); }
    else if (s.tap !== undefined || s.tapNth !== undefined) {
      const text = s.tap ?? s.tapNth;
      label = `tap-${text}`;
      const loc = visible(text).nth((s.n || 1) - 1);
      await loc.waitFor({ state: 'visible', timeout: 8000 });
      await loc.click({ timeout: 8000 });
      await page.waitForTimeout(s.settle ?? 600);
    } else if (s.type !== undefined) {
      label = `type-${s.into || 'field'}`;
      /* Some fields carry their name as a placeholder (sign-in), others as a
         label above the box (every form). Try the placeholder first, since it
         is unambiguous, then fall back to the text that sits above the input. */
      const ph = page.getByPlaceholder(s.into, { exact: false }).locator('visible=true');
      let input = (await ph.count()) ? ph.first() : null;
      if (!input) {
        const lab = visible(s.into).first();
        await lab.waitFor({ state: 'visible', timeout: 8000 });
        input = lab.locator('xpath=./following::input[1] | ./following::textarea[1]').first();
      }
      await input.fill(String(s.type), { timeout: 8000 });
      await page.waitForTimeout(200);
    } else if (s.expect !== undefined) {
      label = `expect-${s.expect}`;
      await visible(s.expect).first().waitFor({ state: 'visible', timeout: s.timeout ?? 8000 });
    } else if (s.absent !== undefined) {
      label = `absent-${s.absent}`;
      const cnt = await visible(s.absent).count();
      if (cnt > 0) throw new Error(`"${s.absent}" is on screen but should not be`);
    } else { label = 'unknown'; ok = false; detail = 'unknown step ' + JSON.stringify(s); }
  } catch (e) {
    ok = false;
    detail = String(e.message || e).split('\n')[0].slice(0, 200);
  }
  const rec = {
    step: s, label, ok, detail,
    ms: Date.now() - t0,
    apiCalls: calls.slice(before).map((c) => ({ action: c.action, ms: c.ms, status: c.status })),
    shot: await shot(label),
  };
  transcript.push(rec);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${String(rec.ms).padStart(5)}ms  ${label}${rec.apiCalls.length ? '  [' + rec.apiCalls.map((c) => `${c.action} ${c.ms}ms`).join(', ') + ']' : ''}${ok ? '' : '  — ' + detail}`);
  return ok;
}

/* ── load + sign in ── */
const tLoad = Date.now();
await page.goto(APP, { waitUntil: 'load' });
const nav = await page.evaluate(() => {
  const e = performance.getEntriesByType('navigation')[0] || {};
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  return { domContentLoaded: Math.round(e.domContentLoaded || 0), loadEvent: Math.round(e.loadEventEnd || 0),
           transferMB: +(((e.transferSize || 0) / 1048576).toFixed(2)), fcp: Math.round(fcp ? fcp.startTime : 0) };
});
const loadMs = Date.now() - tLoad;
console.log(`load ${loadMs}ms  fcp ${nav.fcp}ms  dcl ${nav.domContentLoaded}ms`);
await shot('00-loaded');

/* The app opens on a branded intro animation. A first-run person sits through
   it; everyone else skips. Timed separately so it never hides in "load". */
let introMs = 0;
if (await visible('Skip').count()) {
  const t = Date.now();
  if (spec.watchIntro) await page.waitForTimeout(spec.watchIntro);
  await visible('Skip').first().click();
  await page.waitForTimeout(800);
  introMs = Date.now() - t;
  console.log(`intro skipped after ${introMs}ms`);
  await shot('intro-skipped');
}

if (spec.user) {
  await step({ type: spec.user.name, into: 'Username' });
  await step({ type: spec.user.pin, into: 'PIN' });
  await step({ tap: spec.user.button || 'Unlock' });
  await page.waitForTimeout(1500);
  await shot('signed-in');
}

let failed = 0;
for (const s of spec.steps || []) if (!(await step(s))) failed++;

const slowest = [...calls].sort((a, b) => b.ms - a.ms).slice(0, 8);
const summary = {
  target: APP, device: spec.device || 'phone', user: spec.user?.name || null,
  loadMs, introMs, nav, steps: transcript.length, failed,
  apiCallCount: calls.length,
  apiTotalMs: calls.reduce((a, c) => a + c.ms, 0),
  slowestCalls: slowest.map((c) => ({ action: c.action, ms: c.ms })),
  duplicateCalls: Object.entries(calls.reduce((m, c) => ((m[c.action] = (m[c.action] || 0) + 1), m), {}))
    .filter(([, v]) => v > 1).map(([k, v]) => ({ action: k, times: v })),
  consoleErrors: errors.slice(0, 10),
};
writeFileSync(`${outDir}/transcript.json`, JSON.stringify({ summary, transcript, calls }, null, 2));
console.log('\n' + JSON.stringify(summary, null, 2));
console.log(`\nartifacts: ${outDir}`);

await browser.close();
process.exit(failed ? 1 : 0);
