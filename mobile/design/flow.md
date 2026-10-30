# Navigation Flow Spec — 3-Tab Container Restructure

Target: `App.tsx` shell + `store.tsx`. Palette: navy `#0F2A33`, teal `#0E7C86`, bone `#EDF2F3`.

## 1. Tab + sub-view structure

| Tab | Icon/Label | Sub-views (segments) | Screens |
|---|---|---|---|
| **Dashboard** | 📊 Dashboard | — (single view) | `Dashboard` |
| **Add** | ➕ Add | `Booking` \| `Expense` | `BookingForm`, `ExpenseForm` |
| **Logs** | 📒 Logs | `Bookings` \| `Expenses` \| `Properties` | `LogsScreen(blog)`, `LogsScreen(elog)`, `Properties` |

**Properties lives in Logs** (3rd segment): it is rarely-used config browsed as a list with inline add/edit — it belongs with the browse/manage lists, keeping Add a pure two-choice daily-action surface.

## 2. Sub-navigation pattern

Segmented control pinned directly under the app header, inside each container tab:
- Track: bone `#EDF2F3`, 1px border `rgba(15,42,51,.12)`, radius 999, height 36, margin 14/14/10.
- Active segment: teal `#0E7C86` fill, white 13px/700 label, subtle shadow.
- Inactive: transparent fill, navy `#0F2A33` label at 65% opacity, 13px/600.
- Edit-in-progress indicator: 6px amber dot after the segment label whose form holds an active edit.
- **Both Add forms stay mounted** (inactive one `display:none`) so segment switches never lose typed field values. Logs segments may mount lazily.

## 3. Edit-mode flow (complete)

Trigger — tap a row in Booking Logs (identical for Expense Logs with `editE`/`exp`):
1. `setEditB({ row, bookingId, from: 'blog', cells })`
2. `setTab('add')`; `setAddSeg('book')`
3. BookingForm prefills from `cells`; title = **"Edit Booking"**; ghost button **"← Back to logs"** at top-right; amber "Editing BK-…" banner above actions.

Exits (all must land on the exact originating segment via `from`):
- **Save** → API update → toast → `setEditB(null)` → `refresh()` → `setTab('logs')`, `setLogSeg(from)`.
- **Delete** → confirm alert → API delete → toast → `setEditB(null)` → `refresh()` → `setTab('logs')`, `setLogSeg(from)`.
- **Clear** → `setEditB(null)`, form resets to blank Add defaults, **stays on Add/Booking** (Clear = "cancel edit, start fresh entry" — matches web).
- **← Back to logs** → `setEditB(null)`, discard changes → `setTab('logs')`, `setLogSeg(from)`.
- If `from` is null/undefined (defensive), Save/Delete/Back stay on Add with a cleared form.

`from` is now typed `LogSeg` (`'blog' | 'elog'`), not `Tab` — return is always "logs tab + that segment".

## 4. State model

```ts
type Tab    = 'dash' | 'add' | 'logs';
type AddSeg = 'book' | 'exp';
type LogSeg = 'blog' | 'elog' | 'prop';

// store additions (Tab type narrowed; editB/editE `from` retyped)
tab: Tab;            setTab(t: Tab)
addSeg: AddSeg;      setAddSeg(s: AddSeg)     // persists across tab switches
logSeg: LogSeg;      setLogSeg(s: LogSeg)     // persists across tab switches
editB: { row; bookingId; from: LogSeg; cells } | null;
editE: { row; from: LogSeg; cells } | null;
```

Transition table:

| # | Event | Guard | State change / side effect |
|---|---|---|---|
| T1 | Tap Dashboard tab | tab≠dash | `tab=dash` |
| T2 | Tap Add tab | tab≠add, no active edit | `tab=add` (keep `addSeg`); forms keep drafts; **no** edit reset |
| T3 | Tap Add tab | tab≠add, editB/editE active | `tab=add`; `addSeg=` segment of the active edit (editB→book, editE→exp) |
| T4 | Tap Logs tab | tab≠logs | `tab=logs` (keep `logSeg`); `reloadLogs()` if stale (see E4) |
| T5 | Re-tap active tab | — | scroll active view to top; segments unchanged |
| T6 | Tap Add segment | tab=add | `addSeg=x`; edits/drafts preserved (both forms mounted) |
| T7 | Tap Logs segment | tab=logs | `logSeg=x`; prop segment does not reload logs |
| T8 | Tap booking log row | — | `editB={…, from:'blog'}`; `tab=add`; `addSeg=book` |
| T9 | Tap expense log row | — | `editE={…, from:'elog'}`; `tab=add`; `addSeg=exp` |
| T10 | Save/Delete (edit mode) | edit active | clear edit → `refresh()` → `tab=logs`, `logSeg=from` |
| T11 | Clear button | — | clear edit for that form only; stay on `add`/current seg |
| T12 | ← Back to logs | edit active | clear edit → `tab=logs`, `logSeg=from` (no API call) |
| T13 | Save (fresh add) | no edit | toast → reset form → `refresh()` → stay on `add` (rapid multi-entry) |
| T14 | Logout | — | reset: `tab=dash`, `addSeg=book`, `logSeg=blog`, edits null |

## 5. Edge cases (decided)

- **E1 — Switch Add segment mid-edit:** allowed, non-destructive. Edit + typed values survive (both forms mounted); the edited segment shows the amber dot. No confirm dialog — nothing is lost.
- **E2 — Tap Add tab during an edit:** land on the editing segment (T3) with the edit intact. Never silently reset (current 6-tab shell resets on tab entry — **drop that behavior**; Clear is the explicit "new entry" affordance and stays visible at the form footer).
- **E3 — Tab re-tap:** scroll-to-top only. Do **not** reset segment or edit state — re-tap is a "where am I" gesture, not destructive intent.
- **E4 — Logs refresh:** entering Logs tab calls `reloadLogs()` unless logs were fetched < 15 s ago (track `logsFetchedAt`; `refresh()` and `reloadLogs()` both stamp it). Return-after-save (T10) is therefore free — `refresh()` just reloaded. Manual ↻ button in each log view bypasses the throttle.
- **E5 — Simultaneous editB and editE:** possible (edit booking, switch segment, tap Add… no). Rows can only be tapped from Logs, which exits Add — starting a second edit (T8/T9) while another form holds an edit keeps the first form's edit untouched; each form's Clear/Save affects only its own edit.
- **E6 — Properties segment:** unchanged screen (list + inline add/edit form); its save calls `refresh()`; no cross-tab navigation involved.

## 6. Navigation diagram

```
 ┌─────────────── header (navy) ───────────────┐
 │ logo · PnL report · ↻ Refresh               │
 └──────────────────────────────────────────────┘
   [Dashboard]        [Add]              [Logs]
       │           ┌───┴────┐        ┌─────┼─────────┐
   Dashboard    (Booking|Expense)  (Bookings|Expenses|Properties)
   KPIs/charts     │        │         │       │        │
   pending/checkin BookingF  ExpenseF blog    elog     Props list
                   ▲  ▲      ▲  ▲      │       │        + add/edit
     tap row ──────┘  │      │  └──────┘       │
     (edit, from=blog)│      └── tap row (edit, from=elog)
                      │
     Save/Delete/Back ──► Logs tab @ logSeg=from
     Clear ──► stay on Add (blank form)
```

Implementation order: store (Tab/AddSeg/LogSeg + from retype) → App.tsx shell (3 tabs + SegmentedControl component) → LogsScreen `openEdit` (`setTab('add')`+`setAddSeg`) → forms' Save/Delete/Back (`setTab('logs')`+`setLogSeg(from)`) → remove edit-reset from tab handler → logs throttle.

## 7. Savings + Property bifurcation (v2)

Segments now four-wide in both containers (forms live in **Add**, lists live in **Logs**):

```ts
type AddSeg = 'book' | 'exp' | 'sav'  | 'prop';   // Booking | Expense | Saving | Property (forms)
type LogSeg = 'blog' | 'elog' | 'slog' | 'prop';  // Bookings | Expenses | Savings | Properties (lists)
editS: { row; from: LogSeg; cells } | null;              // savings edit (same shape as editE)
editP: { origId: string; from: LogSeg; prop } | null;    // property edit (props are id-keyed, not row-keyed)
```

- `SavingForm` (Add ▸ Saving) mirrors ExpenseForm; savings log rows come from `s.logs?.savings` via `LogsScreen which='slog'` (title "Savings Logs", newest-first on Date).
- `Properties` (Logs ▸ Properties) is now **list-only**; its add/edit form moved to `PropertyForm` (Add ▸ Property). "+ New property" in the list header opens a blank PropertyForm; each row's Edit opens it prefilled.
- T3 edit-segment priority on Add-tab entry: editB→book, editE→exp, editS→sav, editP→prop. Amber dot per segment holding an active edit (E1/E2/E5 unchanged; all four Add forms stay mounted). T14 logout also nulls editS/editP and resets segs to 'book'/'blog'.

| # | Event | Guard | State change / side effect |
|---|---|---|---|
| T15 | Tap savings log row | — | `editS={row, from:'slog', cells}`; `tab=add`; `addSeg=sav` |
| T16 | Save/Delete saving (edit) | editS active | clear editS → `refresh()` → `tab=logs`, `logSeg=from` |
| T17 | Clear / ← Back on SavingForm | — | as T11/T12, scoped to editS |
| T18 | Tap Edit on a property row | — | `editP={origId, from:'prop', prop}`; `tab=add`; `addSeg=prop` |
| T19 | Tap "+ New property" | — | `editP=null` (blank form); `tab=add`; `addSeg=prop` |
| T20 | Save / ← Back on PropertyForm | editP active | clear editP → (`refresh()` on Save) → `tab=logs`, `logSeg=prop`; Clear → blank fresh-add, stay on Add; fresh-add Save stays on Add (T13) |
