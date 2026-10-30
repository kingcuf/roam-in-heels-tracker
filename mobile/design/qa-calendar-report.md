# QA report — Bookings & Earnings Calendar (14 Jul 2026)

Scope: the Airbnb-style calendar that replaced Today / Upcoming / Daily Earnings on the
Dashboard (`src/calendar.tsx`, `computeCalendar` in `src/logic.ts`).

## How it was tested

1. **Edge-case unit suite** — `qa/calendar-edge.test.ts`, run via `bash qa/run-tests.sh`.
   Compiles the real app sources to CJS (react-native stubbed) and exercises
   `computeCalendar`, `calAggregate`, `buildWeeks`, `addMonth`, `kfmt`, `fmtDayKey`
   in Node. **54 / 54 passed.**
2. **End-to-end UI suite** — `qa/e2e-calendar.js` (puppeteer-core + installed Chrome).
   Drives the real app (web export of the same codebase, deployed as a Vercel *preview*)
   against the **live Apps Script API**: real login, real sheet data, synthetic taps.
   Every displayed number was cross-checked against values computed independently from
   the raw `getLogs` API response. **29 / 29 passed.** Screenshots in
   `design/qa-artifacts/calendar/`.

## Edge cases covered (unit)

- Empty/null logs; rows without a Booking ID (excluded); property filter (match /
  no-match / All).
- Numeric robustness: "₹2,760"-style strings, blanks → 0, negative net (refund),
  zero-net bookings still annotate, same-day sums (net / commission / pending),
  pending-only rollups.
- Check-ins anchor on Check-in Date (col U), earnings on Booking Date (col A);
  check-in-only days; future check-ins extend the month range; 1899-epoch time junk
  hidden; garbage booking date with valid check-in still shows the check-in.
- Cross-year ranges ('2025-12' ↔ '2026-01'), `addMonth` across year boundaries.
- Grid: leading blanks, 4-row (Feb 2026), 5-row (Jul 2026), 6-row (Aug 2026) months,
  leap Feb 2024, rows always ×7.
- `kfmt`: ₹0 / ₹999 / ₹1K / ₹1.2K / ₹99.9K / ₹1L / ₹1.5L / negatives.
- Multi-select aggregation skips empty dates, sorts byDate, counts check-ins.

## End-to-end results (all PASS)

- Login → dashboard; calendar section present, old Today/Upcoming/Daily-Earnings gone.
- July grid: every day's ₹ label matches the sheet (1st ₹2.3K, 2nd ₹500, 3rd ₹6.7K,
  6th ₹6.2K, 8th ₹6.6K, 9th ₹7.3K, 11th ₹3.2K, 12th ₹6.3K); 13th empty except the
  check-in dot; today (14th) has the filled ink circle; pending days (3, 6, 12, 14)
  show the red due amount.
- Single-select 13th: bar shows ₹0 · 1 date; sheet lists 0 bookings and Purnima
  Singh's check-in with times.
- Multi-select 12+13+14: bar and sheet show ₹8,137 net · 3 bk · comm ₹1,666 ·
  due ₹3,040 — exact match with the sheet.
- Deselect updates the bar; × clears it.
- Month nav: ‹ June, Today chip jumps back, › blocked at max data month (Jul),
  ‹ walk stops at earliest data month (May 2026).

## Bugs found & fixed during QA

1. **Red pending label truncated** on narrow cells ("₹2.9K d…") — dropped the " due"
   suffix; red + legend carry the meaning. (`src/calendar.tsx`)

## Known limitations / notes (not bugs)

- Earnings anchor on **Booking Date** (same basis as the removed Daily Earnings chart),
  not stay dates — a booking made on the 12th that checks in on the 13th shows its ₹ on
  the 12th and only a dot on the 13th.
- `kfmt(999.6)` renders "₹1000" (not "₹1K") — unreachable with real data (integer ₹).
- Selected-cell border (2px vs 1px) nudges cell content by 1px — imperceptible.
- Property filter follows the global filter; only one property exists in live data, so
  filter variance couldn't be exercised end-to-end (covered at unit level).
- Web export (used only for QA) logs a benign `getValueWithKeyAsync` error —
  expo-secure-store has no web backend; PIN persistence is native-only. Does not
  affect iOS/Android.

## Repro

```bash
bash qa/run-tests.sh                                   # unit edge cases
SPIRA_PIN=<pin> node qa/e2e-calendar.js                # E2E (update preview URL inside)
```
