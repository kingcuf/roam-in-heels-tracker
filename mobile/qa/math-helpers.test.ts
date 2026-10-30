/**
 * Suite for the small helpers every compute* function leans on (src/logic.ts):
 * ciNum, ciParse, ciMonthLabel / ciMonthOf, ciMonthSort, ciDayKey, ciInitInvest,
 * ciCurMonth — plus the ordering computeCheckins derives from ciTime strings.
 *
 * Run: bash qa/run-tests.sh
 *
 * Every expected value below is derived by hand in a comment. Assertions whose
 * name starts with [BUG] assert the CORRECT value and therefore FAIL today —
 * they are the proof of a finding, not a regression.
 */
import {
  ciNum, ciParse, ciMonthLabel, ciMonthOf, ciMonthSort, ciDayKey,
  ciInitInvest, ciCurMonth, computeCheckins, LogBlock,
} from '../src/logic';

let pass = 0, fail = 0;
const failures: string[] = [];
function eq(name: string, got: any, want: any) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; failures.push(`✗ ${name}\n    got:  ${g}\n    want: ${w}`); }
}

/* ══ ciNum ═════════════════════════════════════════════════════════════════
   ciNum strips every character that is not a digit, '.' or '-', then
   parseFloat()s the remainder, mapping NaN to 0. */

/* The well-behaved cases. Derivation: strip → parse.
   '1,200'  → '1200'    → 1200
   '₹500'   → '500'     → 500
   '₹1,200.50' → '1200.50' → 1200.5
   ' 500 '  → '500'     → 500
   '-750'   → '-750'    → -750                                            */
eq('ciNum plain integer', ciNum('1200'), 1200);
eq('ciNum thousands separator', ciNum('1,200'), 1200);
eq('ciNum currency symbol', ciNum('₹500'), 500);
eq('ciNum symbol + separator + paise', ciNum('₹1,200.50'), 1200.5);
eq('ciNum surrounding whitespace', ciNum(' 500 '), 500);
eq('ciNum negative', ciNum('-750'), -750);
eq('ciNum real number passthrough', ciNum(8033.4), 8033.4);

/* The empty / absent cases — all must be a hard 0, never NaN. */
eq('ciNum empty string', ciNum(''), 0);
eq('ciNum null', ciNum(null), 0);
eq('ciNum undefined', ciNum(undefined), 0);
eq('ciNum whitespace only', ciNum('   '), 0);

/* Garbage must degrade to 0, not NaN — a single NaN would poison every total
   it is added into (NaN + anything = NaN) and render as "₹NaN". */
const garbage = ['abc', '-', '--5', 'N/A', '₹', '.', NaN, Infinity, -Infinity, true, false, {}, [], 'null'];
let nanLeak = '';
garbage.forEach((g) => { if (!Number.isFinite(ciNum(g))) nanLeak += String(g) + ' '; });
eq('ciNum never leaks NaN/Infinity', nanLeak, '');
eq('ciNum garbage word', ciNum('abc'), 0);
eq('ciNum lone minus', ciNum('-'), 0);
eq('ciNum NaN input', ciNum(NaN), 0);
eq('ciNum Infinity input', ciNum(Infinity), 0);

/* ── LATENT: exponent notation is mangled, not rejected ──
   '1e3' → the 'e' is stripped → '13' → parseFloat → 13.
   A value that means 1000 is silently read as 13 — an 80x understatement that
   never announces itself. Same shape for '1.5e2' → '1.52' → 1.52.
   Not reachable from today's D1 (all money columns are SQLite REAL in ordinary
   magnitudes) but reachable from any pasted/imported string. */
eq('ciNum reads 1e3 as 1000', ciNum('1e3'), 1000);

/* ── INFO: accounting parentheses lose their sign ──
   '(500)' means minus five hundred in every ledger export; ciNum reads +500. */

/* ── INFO: a trailing unit is absorbed silently ── '50%' → 50, '2 nights' → 2 */
eq('ciNum percent sign absorbed', ciNum('50%'), 50);

/* ══ ciParse ═══════════════════════════════════════════════════════════════ */

/* The ISO fast path builds a LOCAL midnight from the y/m/d it matched, so it is
   timezone-proof: '2026-08-11' is 11 Aug wherever the phone is. */
{
  const d = ciParse('2026-08-11')!;
  eq('ciParse ISO year',  d.getFullYear(), 2026);
  eq('ciParse ISO month', d.getMonth(), 7);      // 0-based: 7 = August
  eq('ciParse ISO day',   d.getDate(), 11);
  eq('ciParse ISO is local midnight', d.getHours(), 0);
}
/* An ISO datetime still matches the leading yyyy-MM-dd, so the time is dropped
   rather than shifting the day. */
eq('ciParse ISO datetime keeps the date', ciDayKey('2026-08-11T22:30:00Z'), '2026-08-11');

eq('ciParse empty', ciParse(''), null);
eq('ciParse null', ciParse(null), null);
eq('ciParse garbage', ciParse('not a date'), null);

/* ── LATENT: a non-ISO date falls through to `new Date(s)`, which is US-order ──
   '11/08/2026' means 11 August to everyone who types it here; `new Date` reads
   it as month 11 → 8 November. The row then buckets into 'Nov 2026' in the
   monthly P&L and lands on the wrong calendar day. Today's D1 stores only
   'yyyy-MM-dd' (verified: 0 booking rows fail a LIKE '____-__-__%' test), so
   this is latent, not live. */
eq('ciParse reads 11/08/2026 as 11 August (day-first)', ciMonthOf('11/08/2026'), 'Aug 2026');

/* ══ ciMonthLabel (bookings, col A) vs ciMonthOf (expenses, col B) ══════════
   These two produce the KEY that computeCash's `M` map buckets on: bookings go
   in via ciMonthLabel(c) (= ciParse of c[0]) and expenses via ciMonthOf(c[1]).
   If the two spellings ever differed, every month would split into two rows —
   revenue in one, expenses in the other. They do NOT differ: both are
   `CI_MON[m] + ' ' + yyyy` off the same ciParse. Proven, not assumed: */
{
  const bookingCells: any[] = new Array(27).fill('');
  bookingCells[0] = '2026-05-10';              // a real booking_date shape
  const expenseMonth = '2026-05-01';           // the real expense_month shape in D1
  eq('booking month label', ciMonthLabel(bookingCells), 'May 2026');
  eq('expense month label', ciMonthOf(expenseMonth), 'May 2026');
  eq('booking and expense keys are the same string',
     ciMonthLabel(bookingCells) === ciMonthOf(expenseMonth), true);
  /* ciCurMonth must speak the same dialect or `mlbl === curM` never matches and
     "This Month — Awaiting Payout" silently reads ₹0 all month. */
  const now = new Date();
  const cur: any[] = new Array(27).fill('');
  cur[0] = ciDayKey(now);
  eq('ciCurMonth matches ciMonthLabel of today', ciCurMonth(), ciMonthLabel(cur));
}

/* ══ ciMonthSort ═══════════════════════════════════════════════════════════
   key = year*100 + (monthIndex+1). Derivation:
     'May 2026' → 2026*100 + 5  = 202605
     'Dec 2026' → 2026*100 + 12 = 202612
     'Jan 2027' → 2027*100 + 1  = 202701 → year rollover orders correctly */
eq('ciMonthSort May 2026', ciMonthSort('May 2026'), 202605);
eq('ciMonthSort Dec 2026', ciMonthSort('Dec 2026'), 202612);
eq('ciMonthSort Jan 2027', ciMonthSort('Jan 2027'), 202701);
eq('ciMonthSort orders across the year boundary',
   ciMonthSort('Dec 2026') < ciMonthSort('Jan 2027'), true);
/* An unparseable label collapses to 0 and sorts first rather than throwing. */
eq('ciMonthSort empty label', ciMonthSort(''), 0);

/* ══ ciDayKey ══════════════════════════════════════════════════════════════ */
eq('ciDayKey pads month and day', ciDayKey('2026-01-05'), '2026-01-05');
eq('ciDayKey empty', ciDayKey(''), '');
eq('ciDayKey garbage', ciDayKey('nope'), '');

/* ══ ciInitInvest ══════════════════════════════════════════════════════════
   D1 stores init_invest as INTEGER 1 / 0 / NULL (verified against prod). */
eq('ciInitInvest 1 (integer from D1)', ciInitInvest(1), true);
eq('ciInitInvest 0 (integer from D1)', ciInitInvest(0), false);
eq('ciInitInvest null (integer from D1)', ciInitInvest(null), false);
eq('ciInitInvest "Yes"', ciInitInvest('Yes'), true);
eq('ciInitInvest "No"', ciInitInvest('No'), false);
eq('ciInitInvest ""', ciInitInvest(''), false);

/* ══ computeCheckins ordering ══════════════════════════════════════════════
   Today's arrivals are sorted with String(a.inT).localeCompare(String(b.inT)) —
   a LEXICAL compare of a 12-hour clock string. ICU collation treats ':' as
   ignorable at the primary level, so the three strings collate as "100PM",
   "1100AM" and "900AM":
     "100PM" vs "1100AM" → 1=1, then '0' < '1'  → 1:00 PM first
     "1100AM" vs "900AM" → '1' < '9'            → 11:00 AM before 9:00 AM
   giving 1:00 PM · 11:00 AM · 9:00 AM — the afternoon arrival at the top and
   the first arrival of the day at the bottom. The arrivals list is the one
   screen that is read top-to-bottom as a timetable. */
{
  const today = ciDayKey(new Date());
  const bk = (r: number, id: string, inT: string) => {
    const c: any[] = new Array(27).fill('');
    c[0] = today; c[1] = 'Spira 3028'; c[2] = id; c[18] = id;
    c[20] = today; c[22] = inT;
    return { r, cells: c };
  };
  const block: LogBlock = { headers: [], rows: [
    bk(1, 'A', '9:00 AM'), bk(2, 'B', '11:00 AM'), bk(3, 'C', '1:00 PM'),
  ] };
  const got = computeCheckins(block, 'All').today.map((x) => x.inT);
  /* Chronological order by hand: 9:00 AM → 11:00 AM → 1:00 PM. */
    eq('[BUG] today arrivals should be chronological', got, ['9:00 AM', '11:00 AM', '1:00 PM']);
}

console.log(`\n${pass} passed, ${fail} failed`);
failures.forEach((f) => console.log(f));
process.exit(fail ? 1 : 0);
