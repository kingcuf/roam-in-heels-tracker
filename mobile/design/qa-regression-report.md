# QA Regression Report — Spira PnL Mobile App

- **Date:** 04 Jul 2026, ~12:57–13:20 IST
- **Build:** Expo Go "PnL report", Android emulator-5554 (1080x2400)
- **Scope:** New Savings feature, new Property bifurcation, regression of Booking/Expense edit flows and Dashboard drills, visual/style check
- **Screenshots:** `/private/tmp/claude-501/-Users-lepton/b171f11c-74fc-4523-8658-a8b1b0fecaf4/scratchpad/qa/`
- **Baseline recorded:** B0 (Total Bank Balance) = ₹67,360 · I0 (Invested) = ₹0

## Results

| # | Step | Expected | Observed | Result | Screenshot(s) |
|---|------|----------|----------|--------|---------------|
| 1 | Dashboard baseline | Record B0/I0; Invested = ₹0 | B0 = ₹67,360, I0 = ₹0. All cards render | **PASS** | 01-dashboard-baseline.png |
| 2a | Add → Saving defaults | Date = today, Scheme FDs, Platform Groww, Status Active, no Returns field | All defaults correct (2026-07-04 / FDs / Groww / Active); Returns field absent | **PASS** | 03-saving-form-defaults.png |
| 2b | Save Amount 10000 + Notes "QC-TEST" | Success toast, entry saved | Save succeeded (form reset, header timestamp bumped to 12:59, entry appears in Logs & Dashboard). "Saving…" button state + "Querying the data…" refresh toast captured; the brief success toast itself fell between screenshots — not captured, save confirmed via data | **PASS** (toast not captured) | 04-saving-filled.png, 05-saving-saved-toast.png, 06-saving-saved.png |
| 3a | Bank math #1 | Invested = ₹10,000; Bank = B0 − 10,000 = ₹57,360 | Invested ₹10,000; Bank ₹57,360. Exact | **PASS** | 08-dashboard-cash-after-save.png |
| 3b | Invested card drill | byScheme FDs ₹10,000; byPlatform Groww; entries table shows QC-TEST row | BY SCHEME: FDs (1) ₹10,000 · BY PLATFORM: Groww (1) ₹10,000 · Realized returns ₹0 · ALL ENTRIES row 2026-07-04/FDs/Groww/₹10,000/Active (table has no Notes column, so "QC-TEST" text not shown; row identity confirmed). Minor: DATE cell wraps "2026-07-0 / 4" (defect D2) | **PASS** | 09-invested-drill.png |
| 3c | Bank drill | "Less: Invested (active)" = 10,000 | SAVINGS ADJUSTMENTS: "Less: Invested (active) ₹-10,000", "Add: Returns realized ₹0"; months sum to ₹57,360 | **PASS** | 11b-bank-drill.png |
| 4a | Logs → Savings shows QC-TEST row | Row listed | 1 row: 2026-07-04 / 10000 / FDs / Groww | **PASS** | 11-bank-drill.png (actually shows Savings Logs — see D4), 12-logs-tab.png |
| 4b | Tap row → Edit Saving | Add tab @ Saving, "Edit Saving" prefilled, amber banner, amber dot on segment | All present: "Edit Saving", prefilled values, amber dot on Saving segment, amber banner "Editing this saving — Save to update, Delete to remove, or Clear to cancel", "← Back to logs" button | **PASS** | 13a-logs-settled.png |
| 4c | Status → Matured shows Returns field; enter 800; Save | Returns Received appears; save; auto-return to Logs @ Savings | Status picker sheet (Active/Matured/Withdrawn); on Matured, "Returns Received (₹)" appeared with helper text; entered 800; saved; app auto-returned to Logs @ Savings (header 13:06) | **PASS** | 14-status-dropdown.png, 15-status-matured.png, 16-returns-entered.png, 19-post-save-nav.png |
| 5 | Bank math #2 | Invested = ₹0; Bank = B0 + 800 = ₹68,160 | Invested ₹0; Bank ₹68,160. Exact | **PASS** | 20-bankmath2.png |
| 6 | Cleanup: delete QC-TEST | Confirm alert; row gone; Dashboard = B0/I0 | Alert "Delete saving — Delete this saving permanently? This cannot be undone." → DELETE. Savings Logs: "No rows yet." Dashboard: Bank ₹67,360, Invested ₹0 — exactly baseline | **PASS** | 22-delete-visible.png, 23-delete-confirm.png, 25-post-delete-nav.png, 26c-dashboard-restored.png |
| 7a | Logs → Properties is list-only | No add form; "+ New property" button; property list | "Properties" title + "+ New property" button + YOUR PROPERTIES list (Spira 3028, Active badge, SPIRA-3028, Rent ₹45,000, onboarded 2026-05-01, Edit button). No form on screen | **PASS** | 27-properties-list.png |
| 7b | "+ New property" → blank Add Property | Add tab @ Property, blank form | "Add Property" with empty Name/ID/Location/Type, Status Active, empty Onboarded/Rent | **PASS** | 28-new-property-form.png |
| 7c | Edit Spira 3028 | Add tab @ Property, "Edit Property" prefilled (name, rent 45000), amber banner, "← Back to properties" | "Edit Property", name "Spira 3028", ID SPIRA-3028, rent 45000, onboarded 2026-05-01, amber dot on Property segment, amber banner "Editing this property — Save to update, or Clear to start a fresh entry", "← Back to properties" button | **PASS** | 30-edit-property.png, 31-edit-property-banner.png |
| 7d | "← Back to properties" (no save) | Returns to Logs @ Properties | Returned to Logs @ Properties; data unchanged | **PASS** | 33-back-to-props-result.png |
| 8 | Booking edit regression (read-only) | Logs → Bookings row → "Edit Booking" prefilled, amber dot; back → Logs @ Bookings | Booking Logs (110 rows, paged 1/3). First row → "Edit Booking" prefilled (Kshitiz Sethi, 2026-07-03, Stay, Airbnb), amber dot on Booking segment, "← Back to logs" returned to Logs @ Bookings | **PASS** | 34-bookings-log.png, 35-edit-booking.png, 36-back-to-bookings.png |
| 9 | Expense edit regression (read-only) | Same for Expenses | Expense Logs (116 rows). First row → "Edit Expense" prefilled (July Rent, ₹45,000, Rent, Jul 2026), amber dot; back → Logs @ Expenses | **PASS** | 37-expenses-log.png, 38-edit-expense.png, 39-back-to-expenses.png |
| 10a | Total Revenue drill | Channel × type matrix with Total row | "NET REVENUE (₹) · CHANNEL × BOOKING TYPE" matrix; 6 channels × Stay/Resold/Pass; Total row 1,56,674 / 27,850 / 2,800 / 1,87,324. Closed OK | **PASS** | 42-revenue-drill.png |
| 10b | Monthly P&L month drill | Month drill opens | First tap on Jun Net P&L cell scrolled/reset instead of opening (see D3); retry opened "JUN 2026 · NET P&L ₹45,726" with COMPONENTS (Revenue ₹99,727, Less: Expense ₹-54,001, Net P&L ₹45,726). Closed OK | **PASS** (1 retry) | 45-month-drill.png (failed attempt), 50-monthly-table4.png, 51-month-drill.png |
| 11 | Visual/style check | Porcelain theme, gold accents, Manrope bold headlines, white active pill, 3 duotone tab icons, no navy remnants, no clipped text, 4 segment labels fit | Porcelain/off-white background throughout; gold accents (section labels, badges, dots, chart commission bars); bold black headlines ("Add Saving", "Savings Logs", "Edit Property"); active segment = white pill; 3 duotone bottom icons with gold accents; no dark-navy remnants anywhere; the 4 segment labels fit on both Add and Logs bars. Two minor text-wrap issues (D1, D2) | **PASS** (minor cosmetics) | all screenshots |

**Totals: 16 PASS / 0 FAIL** (2 checkpoints passed with caveats: success toast not captured in 2b; one retry needed in 10b)

## Defects / Observations

| ID | Severity | Description | Repro |
|----|----------|-------------|-------|
| D1 | Cosmetic (P4) | Monthly P&L table Total-row values wrap mid-digit: "₹1,87,32 4" and "₹1,59,74 5" (REVENUE/EXPENSE columns too narrow for 7-digit totals). | Dashboard → scroll to Monthly P&L (Recurring + Operating) → look at Total row. Screenshot 44-scroll-monthly2.png. |
| D2 | Cosmetic (P4) | Invested drill "ALL ENTRIES" DATE cell wraps ISO date: "2026-07-0" / "4". | Dashboard → tap Invested card (with an active saving) → ALL ENTRIES table. Screenshot 09-invested-drill.png. |
| D3 | Minor (P3), intermittent | Occasional tap misrouting/lost taps right after a sheet close or during a background "Querying the data…" refresh: (a) after closing the Invested drill a tap on the Bank card landed on the Add tab; (b) a later Bank-card tap landed on Logs; (c) first tap on a Monthly P&L Net-P&L cell reset scroll to top instead of opening the drill. Each worked on retry; no data impact. Likely touch handling during sheet-dismiss animation / list re-render. | Open any dashboard drill sheet → close it → immediately tap another card; or tap a month cell right after a refresh completes. Screenshots 10-bank-drill.png, 11-bank-drill.png, 45-month-drill.png. |
| D4 | Observation | The explicit "saved" success toast was never captured on screen — only the "Saving…" button state and the follow-up "Querying the data…" refresh toast (Apps Script round trip ~10–15 s). Saves themselves are reliable. If the success toast is shorter than ~2 s, consider lengthening it. | Add tab → Saving → Save; watch toast area. Screenshots 05/06, 17/18. |

## Cleanup confirmation

The QC-TEST saving created in step 2 was deleted in step 6 (confirmed alert, "No rows yet." in Savings Logs) and the Dashboard returned to exactly the baseline values: **Total Bank Balance ₹67,360, Invested ₹0**. No properties, bookings, or expenses were created or modified — both edit-regression flows were exited via "← Back to logs" without saving.
