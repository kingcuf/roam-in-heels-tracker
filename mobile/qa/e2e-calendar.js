/* E2E QA of the earnings calendar — drives the real web build (preview deploy)
 * against the live Apps Script API in headless Chrome. */
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const URL = 'https://spira-tracker-f6l4mpo5g-deependrayadav-3330s-projects.vercel.app';
const PIN = process.env.SPIRA_PIN;
const SHOTS = __dirname + '/qa-shots';
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0, fail = 0;
const results = [];
const LIVE = SHOTS + '/live.log';
fs.writeFileSync(LIVE, '');
const log = (s) => { console.log(s); fs.appendFileSync(LIVE, s + '\n'); };
function check(name, ok, detail = '') {
  ok ? pass++ : fail++;
  results.push(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' — ' + detail : ''}`);
  log(results[results.length - 1]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// hard watchdog: never hang silently
setTimeout(() => { log('WATCHDOG: run exceeded 5 min — aborting'); process.exit(3); }, 300000).unref?.();

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-first-run', '--window-size=402,900'],
    defaultViewport: { width: 390, height: 844 },
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (e) => log('PAGE ERROR: ' + e.message));
  page.on('dialog', async (d) => { log('DIALOG: ' + d.message()); await d.dismiss().catch(() => {}); });

  /* helpers ---------------------------------------------------------------- */
  const bodyText = () => page.evaluate(() => document.body.innerText);

  // find the center of a day-number cell inside the calendar grid (numWrap is 24px wide)
  async function dayCellPoint(day) {
    return page.evaluate((d) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const out = [];
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (t.textContent.trim() !== String(d)) continue;
        const wrap = t.parentElement && t.parentElement.parentElement;  // Text div → numWrap (24×24)
        if (!wrap) continue;
        const rw = wrap.getBoundingClientRect();
        if (!(rw.width >= 20 && rw.width <= 30 && rw.height >= 20 && rw.height <= 30)) continue;
        const cell = wrap.parentElement;                                 // Pressable day cell (minHeight 62)
        if (!cell || cell.getBoundingClientRect().height < 50) continue;
        wrap.scrollIntoView({ block: 'center' });
        const r2 = wrap.getBoundingClientRect();
        out.push({ x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 });
      }
      return out;
    }, day);
  }
  async function clickDay(day) {
    log('  → clickDay ' + day);
    const pts = await dayCellPoint(day);
    if (!pts.length) throw new Error('day cell not found: ' + day);
    await page.mouse.click(pts[0].x, pts[0].y);
    await sleep(350);
  }
  async function clickText(txt, exact = true) {
    log('  → clickText ' + txt);
    const pt = await page.evaluate((s, ex) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode;
        const v = t.textContent.trim();
        if (ex ? v === s : v.includes(s)) {
          const el = t.parentElement;
          el.scrollIntoView({ block: 'center' });
          const r = el.getBoundingClientRect();
          if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    }, txt, exact);
    if (!pt) throw new Error('text not found: ' + txt);
    await page.mouse.click(pt.x, pt.y);
    await sleep(350);
  }
  // month-pager buttons are 34×34 circles; the KPI cards also contain '›' chevrons,
  // so nav clicks must be size-scoped, not text-scoped
  async function clickNav(dir) {
    log('  → clickNav ' + dir);
    const pt = await page.evaluate((s) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (t.textContent.trim() !== s) continue;
        const btn = t.parentElement && t.parentElement.parentElement; // Text div → navBtn (34×34)
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        if (r.width >= 30 && r.width <= 40 && r.height >= 30 && r.height <= 40) {
          btn.scrollIntoView({ block: 'center' });
          const r2 = btn.getBoundingClientRect();
          return { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
        }
      }
      return null;
    }, dir);
    if (!pt) throw new Error('nav button not found: ' + dir);
    await page.mouse.click(pt.x, pt.y);
    await sleep(350);
  }
  const shot = async (name) => {
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    log('  📸 ' + name);
  };

  /* 1. load + login --------------------------------------------------------- */
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  let txt = await bodyText();
  check('E1 app loads to login screen', /PIN|Unlock/i.test(txt));
  await shot('01-login');

  await page.type('input', PIN);
  await clickText('Unlock');
  // dashboard + logs load takes a couple of API round-trips
  for (let i = 0; i < 20 && !/earnings calendar/i.test(txt); i++) { await sleep(1500); txt = await bodyText(); }
  check('E2 login works, dashboard renders', /Total Revenue/i.test(txt));
  check('E3 calendar section replaces old ones', /BOOKINGS & EARNINGS CALENDAR/i.test(txt)
    && !/Daily Earnings/i.test(txt) && !/Upcoming/.test(txt));

  /* 2. calendar render ------------------------------------------------------ */
  await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.trim() === 'July 2026') {
        walker.currentNode.parentElement.scrollIntoView({ block: 'start' }); break;
      }
    }
  });
  await sleep(400);
  txt = await bodyText();
  check('E4 month title = current month', txt.includes('July 2026'));
  check('E5 day 12 shows ₹6.3K', txt.includes('₹6.3K'));
  check('E6 day 12 shows pending ₹1.2K', txt.includes('₹1.2K'));
  check('E7 day 14 shows ₹1.8K net + pending', (txt.match(/₹1\.8K/g) || []).length >= 2);
  check('E8 legend hint present', /gold dot = check-in/i.test(txt));
  // today circle: the "14" number wrap has the dark bg
  const todayStyled = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      if (t.textContent.trim() === '14') {
        const wrap = t.parentElement && t.parentElement.parentElement;  // numWrap carries the circle bg
        if (!wrap) continue;
        const r = wrap.getBoundingClientRect();
        if (!(r.width >= 20 && r.width <= 30)) continue;
        const bg = getComputedStyle(wrap).backgroundColor;
        if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
      }
    }
    return null;
  });
  check('E9 today (14th) has filled circle', !!todayStyled, 'bg=' + todayStyled);
  await shot('02-calendar-july');

  /* 3. single select: the empty 13th (check-in only) ------------------------ */
  await clickDay(13);
  txt = await bodyText();
  check('E10 select 13th → bar appears with ₹0', txt.includes('1 date') && /₹0\b/.test(txt));
  await clickText('Details');
  await sleep(600);
  txt = await bodyText();
  check('E11 13th sheet: 0 bookings, check-in listed', /Purnima/i.test(txt) && /check-in/i.test(txt));
  check('E12 13th sheet: date header', txt.toUpperCase().includes('13 JUL 2026'));
  await shot('03-sheet-13th-checkin-only');
  await page.keyboard.press('Escape'); await sleep(400);
  // close sheet if still open (tap the ×)
  txt = await bodyText();
  if (/Pending \(awaiting payment\)/.test(txt)) { await clickText('×'); await sleep(400); }

  /* 4. multi-select 12 + 14 (13 already selected) --------------------------- */
  await clickDay(12);
  await clickDay(14);
  txt = await bodyText();
  check('E13 bar: 3 dates aggregated', txt.includes('3 dates'));
  check('E14 bar: net ₹8,137', txt.includes('₹8,137'));
  check('E15 bar: 3 bookings', /3 bk/.test(txt));
  check('E16 bar: comm ₹1,666', txt.includes('₹1,666'));
  check('E17 bar: due ₹3,040', txt.includes('₹3,040'));
  await shot('04-multiselect-bar');

  await clickText('Details');
  await sleep(600);
  txt = await bodyText();
  check('E18 sheet: title "3 dates selected"', txt.toUpperCase().includes('3 DATES SELECTED'));
  check('E19 sheet: booking-wise rows present', /B131|B132|B133/.test(txt) || /Purnima|Paras|Silvera/i.test(txt));
  check('E20 sheet: pending total line', /Pending \(awaiting payment\)/.test(txt) && txt.includes('₹3,040'));
  await shot('05-sheet-multiselect');
  await page.keyboard.press('Escape'); await sleep(400);
  txt = await bodyText();
  if (/Pending \(awaiting payment\)/.test(txt)) { await clickText('×'); await sleep(400); }

  /* 5. deselect → bar updates; clear → bar gone ----------------------------- */
  await clickDay(13);
  txt = await bodyText();
  check('E21 deselect 13th → 2 dates', txt.includes('2 dates'));
  await clickText('×');   // clear button on the bar
  await sleep(400);
  txt = await bodyText();
  check('E22 clear selection → bar gone', !/\d dates? · \d+ bk/.test(txt));

  /* 6. month navigation ------------------------------------------------------ */
  await clickNav('‹');
  txt = await bodyText();
  check('E23 back → June 2026 + Today chip', txt.includes('June 2026') && /Today/.test(txt));
  await shot('06-june');
  await clickText('Today');
  txt = await bodyText();
  check('E24 Today chip returns to July', txt.includes('July 2026'));
  // forward bound: maxMonth is 2026-07 (latest data = 20 Jul check-in) → › must be a no-op
  await clickNav('›');
  txt = await bodyText();
  check('E25 forward disabled at max month', txt.includes('July 2026') && !txt.includes('August 2026'));
  // back bound: walk to the earliest data month and confirm it stops there
  let guard = 0, prev = '';
  while (guard++ < 24) {
    const t2 = await bodyText();
    const m = t2.match(/(January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d/);
    if (m && m[0] === prev) break;
    prev = m ? m[0] : '';
    await clickNav('‹');
  }
  check('E26 back bound stops at earliest data month', !!prev && prev !== 'July 2026', 'earliest=' + prev);
  await shot('07-earliest-month');
  try { await clickText('Today'); } catch { log('  (no Today chip — already on current month)'); }

  /* 7. cross-check every July annotation vs the API ------------------------- */
  const cells = await page.evaluate(() => {
    // collect each day cell's full text within the calendar grid
    const out = {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode;
      const v = t.textContent.trim();
      if (!/^\d{1,2}$/.test(v)) continue;
      const wrap = t.parentElement && t.parentElement.parentElement;   // Text div → numWrap
      if (!wrap) continue;
      const r = wrap.getBoundingClientRect();
      if (!(r.width >= 20 && r.width <= 30 && r.height >= 20 && r.height <= 30)) continue;
      const cell = wrap.parentElement;       // numWrap → Pressable cell
      if (!cell || cell.getBoundingClientRect().height < 50) continue;
      out[v] = cell.innerText.replace(/\n/g, ' | ');
    }
    return out;
  });
  const expect = {
    '1': '₹2.3K', '2': '₹500', '3': '₹6.7K', '6': '₹6.2K', '8': '₹6.6K', '9': '₹7.3K',
    '11': '₹3.2K', '12': '₹6.3K',
  };
  let mismatches = [];
  for (const [d, amt] of Object.entries(expect)) {
    if (!cells[d] || !cells[d].includes(amt)) mismatches.push(`${d}: got "${cells[d]}" want ${amt}`);
  }
  check('E27 all July amounts match sheet data', mismatches.length === 0, mismatches.join('; '));
  check('E28 13th cell has no amount (check-in only)', cells['13'] === '13', 'cell="' + cells['13'] + '"');
  check('E29 pending days show red due amount (3, 6, 12, 14)',
    cells['3'].includes('₹2.9K') && cells['6'].includes('₹2.9K') &&
    cells['12'].includes('₹1.2K') && (cells['14'].match(/₹1\.8K/g) || []).length === 2,
    `3="${cells['3']}" 6="${cells['6']}" 14="${cells['14']}"`);

  /* 8. console errors -------------------------------------------------------- */
  await shot('08-final');
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  fs.writeFileSync(SHOTS + '/results.txt', results.join('\n'));
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  log('FATAL: ' + e.message);
  log(`\n=== ${pass} passed, ${fail} failed (run aborted early) ===`);
  fs.writeFileSync(SHOTS + '/results.txt', results.join('\n'));
  process.exit(2);
});
