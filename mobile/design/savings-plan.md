# Savings (Investments) Feature — Implementation Plan

Scope: global (not per-property) savings entries; bank balance adjusted only when property filter = `All`.
Net bank adjustment = **− Σ(amount | Active) + Σ(returnsReceived | Matured/Withdrawn)**. No maturity-date / expected-% fields.

## 1. Sheet schema — new `Savings` sheet (auto-created by Apps Script)

Row addressing: **sheet row number**, exactly like Expenses (`updateExpense`/`deleteExpense` take `row`; `getLogs` returns `{ r, cells }`). No ID column — rows are addressed by `r` from the last `logs` fetch, which is refreshed before every edit session. Column order A..H:

| Col | idx | Header | Type / format |
|---|---|---|---|
| A | 0 | Date | Date (created date, `yyyy-MM-dd` out via `logBlock_`) |
| B | 1 | Amount | Number (₹ principal) |
| C | 2 | Scheme | `FDs \| Mutual Funds \| Stocks \| Bonds \| Other` |
| D | 3 | Platform | `Slice \| Groww \| ET Money \| Grip Invest \| Others` |
| E | 4 | Status | `Active \| Matured \| Withdrawn` |
| F | 5 | Returns Received | Number (₹, blank while Active) |
| G | 6 | Notes / Ref No | Text |
| H | 7 | Created At | Timestamp (set once by `addSaving`, preserved by `updateSaving`) |

`savingsSheet_()` helper: `getSheetByName('Savings') || insertSheet('Savings')` + write the 8 headers if row 1 is empty. Every savings action goes through it — zero manual sheet setup.

## 2. API surface (apps-script-api.gs)

Router additions (same doGet switch, PIN-checked, JSON/JSONP unchanged):
- `addSaving` — `payload = { date, amount, scheme, platform, status, returns, notes }`. Appends `[date, amount, scheme, platform, status, returns|'' , notes, new Date()]`. Returns `{ ok, message: 'Saving added' }`.
- `updateSaving` — `row` + same payload. `setValues` on `(row, 1, 1, 7)` — cols A..G only, **never rewrites H (Created At)**. Returns `{ ok, message: 'Saving updated' }`.
- `deleteSaving` — `row`; `deleteRow(row)`. Returns `{ ok, message: 'Saving deleted' }`.
- `logs` — extend `getLogs` return with `savings: logBlock_(savingsSheet_())` (third block alongside bookings/expenses).
- `dashboard` — **no change**. `computeCash` is client-side over logs; dashboard KPIs never included bank balance.

Validation (add + update, throw like expenses do): `date` required; `amount` required and `num_(amount) > 0`; `scheme`/`platform`/`status` must be in their fixed lists (default Other/Others/Active if blank); if `status === 'Active'` force `returns` to `''`; else `returns` optional but `num_() >= 0`. `row >= 2` guard on update/delete.

## 3. API client (src/api.ts)

```ts
addSaving:    (pin: string, d: any) => call('addSaving',    { pin, payload: d }),
updateSaving: (pin: string, row: number, d: any) => call('updateSaving', { pin, row, payload: d }),
deleteSaving: (pin: string, row: number) => call('deleteSaving', { pin, row }),
```
`getLogs` signature unchanged — the savings block rides along in the same response.

## 4. State (src/store.tsx)

```ts
export type AddSeg = 'book' | 'exp' | 'sav';
export type LogSeg = 'blog' | 'elog' | 'slog' | 'prop';
export type EditS  = { row: number; from: LogSeg; cells: any[] } | null;   // identical shape to EditE
editS: EditS; setEditS: (e: EditS) => void;   // added to StoreT + provider; logout() also nulls editS
```
Transition table (continuing flow.md; T1–T14 unchanged in form, generalized to 3 segments):
| # | Event | Guard | State change |
|---|---|---|---|
| T15 | Tap savings log row | — | `editS={row, from:'slog', cells}`; `tab='add'`; `addSeg='sav'` |
| T16 | Save/Delete saving (edit) | editS active | clear editS → `refresh()` → `tab='logs'`, `logSeg=from` (= T10 pattern) |
| T17 | Clear / ← Back on SavingForm | — | as T11/T12, scoped to editS |
| T3′ | Tap Add tab during edit | editS active | `addSeg='sav'` (extends T3 map: editB→book, editE→exp, editS→sav) |
| T14′ | Logout | — | also `editS=null`; `addSeg='book'`, `logSeg='blog'` as before |
E1/E2/E5 apply unchanged (all three Add forms stay mounted; amber dot on `sav` segment when editS active).

## 5. Logic (src/logic.ts)

- `Logs` type: `{ bookings; expenses; savings?: LogBlock }` — optional so a stale backend can't crash the client.
- New `computeSavings(block: LogBlock | null)` (no filter param — savings are global):
```ts
type Savings = {
  invested: number;            // Σ amount where status === 'Active'
  returnsRealized: number;     // Σ returns  where status ∈ {Matured, Withdrawn}
  byScheme:   Record<string, { c: number; amt: number }>;   // Active only
  byPlatform: Record<string, { c: number; amt: number }>;   // Active only
  counts: { active: number; matured: number; withdrawn: number; total: number };
  entries: { row; date; amount; scheme; platform; status; returns; notes }[]; // all rows, newest first (drill list)
};
```
Cell indices per schema: date=0, amount=1, scheme=2, platform=3, status=4, returns=5, notes=6.
- `computeCash(b, e, filter, sv?: LogBlock | null)` — new optional 4th arg. After the existing loops, **only when `filter === 'All'` and sv present**: compute `s = computeSavings(sv)` inline logic; `bank = netPnL - pending - s.invested + s.returnsRealized`. Also apply the same per-entry net effect to `dayMap` at the entry's created date (Active: `−amount`; Matured/Withdrawn: `+returns`) so the Cumulative Bank Balance chart's endpoint equals the bank KPI. `netPnL`, `monthly`, and everything else untouched — savings are a balance-sheet move, not P&L.

## 6. UX spec

**SavingForm.tsx** (mirrors ExpenseForm exactly: EMPTY const, `useEffect` on `s.editS`, reset/submit/del, edit banner, Save/Clear/Delete/← Back):
- Created Date — `DateField`, default today, required.
- Amount (₹) — numeric `TxtInput`, required, > 0.
- Saving Scheme — `SelectField` `[FDs, Mutual Funds, Stocks, Bonds, Other]`, default **FDs**.
- Platform — `SelectField` `[Slice, Groww, ET Money, Grip Invest, Others]`, default **Groww**.
- Status — `SelectField` `[Active, Matured, Withdrawn]`, default **Active**. On change to Active, clear the returns field.
- Returns Received (₹) — numeric, **disabled (dimmed, non-editable) while status = Active**; hint: "Total credited back on maturity/withdrawal."
- Notes / Reference No — `TxtInput`.
Client validation mirrors backend: date, amount required; toast on miss.

**Savings log**: reuse `LogsScreen` with `which: 'slog'` → `block = s.logs?.savings`; sort newest-first on `cells[0]`; `openEdit` sets `editS` (T15). Columns come from the sheet headers (Date, Amount, Scheme, Platform, Status, Returns Received, Notes/Ref No, Created At).

**Invested KPI card**: **new gold variant** — add `kind: 'inv'` to `KpiCard` in `ui.tsx` (gold accent, e.g. `#B08A2E` text on a warm `#FBF4E4` tint, matching the existing kind pattern). Graphite `bkg` reads as a neutral count style; investments deserve their own signal. Cash position row (only when `s.filter === 'All'`): `Total Bank Balance | Invested (Σ active) | This Month — Awaiting Payout`. When a property filter is set, the Invested card is **hidden** and computeCash gets `sv = null` — bank balance is purely per-property.

**Drill sheet for Invested** (`Drill = { kind:'metric', metric:'invested' }`): title "Invested (Active)" / value `inr(invested)`; body: H4 "By scheme" table (Scheme | Count | Amount), H4 "By platform" table, H4 "All entries" STable (Date | Scheme | Platform | Amount | Status | Returns) from `entries`, SumLine "Realized returns to date" = `returnsRealized`. Bank drill gains two SumLines when filter=All: "Less: Active investments" (−invested) and "Add: Realized returns" (+returnsRealized).

## 7. File-by-file change list — two work packages

**WP-UX** (owns UI shell + all of store.tsx):
- `src/store.tsx` — AddSeg/LogSeg unions, `EditS` type, `editS/setEditS` state, logout reset. **WP-UX owns this file fully.**
- `src/screens/SavingForm.tsx` — NEW (clone ExpenseForm pattern; calls `api.addSaving/updateSaving/deleteSaving` — signatures fixed in §3, safe to code against before WP-LOGIC lands).
- `src/screens/LogsScreen.tsx` — widen `which` to `'blog'|'elog'|'slog'`, block selection, sort key, `openEdit` slog branch.
- `App.tsx` — 3rd Add segment "Saving" (mounted-always like the others), 4th Logs segment "Savings", T3 edit-segment map + amber-dot logic for editS.
- `src/ui.tsx` — `KpiCard` gold `kind: 'inv'`.
- `design/flow.md` — append T15–T17 rows + segment lists (doc-only).

**WP-LOGIC** (owns data path + Dashboard wiring):
- `apps-script-api.gs` — `savingsSheet_()` auto-create, `addSaving/updateSaving/deleteSaving`, router cases, `getLogs` savings block, validation.
- `src/api.ts` — three methods (§3).
- `src/logic.ts` — `Logs.savings?`, `computeSavings()`, `computeCash` 4th arg.
- `src/screens/Dashboard.tsx` — pass `s.logs?.savings` into `computeCash` (only when filter All), `useMemo computeSavings`, Invested KpiCard + `'invested'` drill + bank-drill SumLines.

**Conflict flags & boundaries**:
- `store.tsx` — WP-UX only. WP-LOGIC must not touch it (it needs nothing from it beyond existing `s.logs/s.filter/s.pin`).
- `ui.tsx` — WP-UX only; contract with WP-LOGIC is the literal kind name **`'inv'`**.
- `LogsScreen.tsx` — WP-UX only; it reads `s.logs?.savings`, whose type lands in WP-LOGIC's logic.ts. **WP-LOGIC merges the one-line `Logs` type change first** (or WP-UX uses `(s.logs as any).savings` temporarily — avoid; sequence instead).
- `Dashboard.tsx` — WP-LOGIC only, including the KpiCard/drill JSX. No shared files otherwise.
- Contracts frozen by this doc: api method signatures (§3), `EditS` shape (§4), `computeSavings` output (§5), kind `'inv'`, seg literals `'sav'`/`'slog'`.

## 8. Deploy & verify

Deploy (Apps Script, preserving the /exec URL):
1. `clasp push` from the Apps Script project dir.
2. `clasp deployments` → note the existing deployment ID behind the `/exec` URL in `api.ts` (`<DEPLOYMENT_ID>…`).
3. `clasp deploy -i <existing-deployment-id> -d "savings v1"` — **redeploys in place; never `clasp deploy` bare** (that mints a new ID/URL and strands the app).
4. Curl `<exec>?action=logs&pin=<PIN via env var>` → response now has a `savings` block and the `Savings` sheet exists with headers (auto-created on first touch).

End-to-end verify checklist:
1. Add saving (₹10,000, FDs, Groww, Active) → toast; row appears in `Savings` sheet with Created At; appears in Logs ▸ Savings.
2. Dashboard (filter All): Invested card shows ₹10,000; Total Bank Balance dropped by exactly ₹10,000 vs pre-add; bank chart endpoint matches card.
3. Tap the savings log row → Add ▸ Saving prefilled, "Edit Saving" header; Back returns to Logs ▸ Savings.
4. Edit → Status = Matured, Returns = ₹10,800 → Save → bank balance rises ₹20,800 vs step 2 (principal back + returns: net effect now +₹800 vs baseline); Invested card drops to ₹0.
5. Invested drill: byScheme/byPlatform/entries + realized returns line all consistent.
6. Set property filter to a specific property → Invested card hidden; bank balance shows no savings adjustment; switch back to All → adjustment returns.
7. Delete the test saving → gone from sheet, logs, and all KPIs; web dashboard (same backend) still loads (its getLogs consumers ignore the extra block).
