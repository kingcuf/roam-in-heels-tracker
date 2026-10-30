# Roam in Heels — App Restructure Scope

**Status:** Scoping — not yet approved for build
**Date:** 12 Aug 2026 (rev 2 — structure revised to three tabs)
**Applies to:** Mobile app only. Web dashboard keeps its current layout — out of scope.
**Backend:** Cloudflare Worker + D1 (migrated off Google Sheets, 12 Aug 2026)

---

## 1. Purpose

Reorganise the app around **what needs doing next**, rather than around the shape
of the underlying data, and collapse the current four tabs into three by pairing
each entry form with its own log.

## 2. Headline finding

Of the 15 metrics listed, 14 already exist. All 17 booking fields already exist.
Of the 6 Action sections, 4 exist in some form and 2 are genuinely new.

| # | New work | Why it's new | Size |
|---|---|---|---|
| 1 | **Action** tab | New surface; largely re-homes existing computations | Small |
| 2 | **Today's check-out** | Check-ins are computed; check-outs are not | Small |
| 3 | **Logs under each form** | Navigation refactor — removes the Logs tab | Medium |
| 4 | **Inventory into Add** | Removes the Inventory tab; needs a home for stock movements | Medium |
| 5 | **Review follow-ups** | No review state exists anywhere — needs a schema change | Medium |
| 6 | **IDs pending** | Requires guest-ID upload to R2 — does not exist | Large |
| 7 | **Total Pending / Total invested** cards | Computed today, never displayed | Trivial |

## 3. Current state

Four tabs: **Dashboard · Add · Logs · Inventory**

- **Add** — 4 segments (Booking, Expense, Saving, Property), all kept mounted.
- **Logs** — 4 segments (Bookings, Expenses, Savings, Properties), each editable.
- **Dashboard** — KPI cards, cash position, check-in sections, pending payments,
  charts, drill-downs.
- **Inventory** — separate workbook (82 items, 40 stock movements).

## 4. Target structure

**Three tabs:**

| Tab | Purpose |
|---|---|
| **Action** | What needs doing now |
| **Dashboard** | Metrics and trends |
| **Add** | Create *and manage* records — form on top, its log below |

Two tabs are removed: **Logs** (folded under each Add segment) and **Inventory**
(becomes an Add segment).

## 5. Scope by tab

### 5.1 Action (new)

Six sections, each collapsible with a count badge:

| Section | Source | Status |
|---|---|---|
| Today's check-in | `computeCheckins()` | exists — re-homed |
| Today's check-out | — | **new** (§5.4) |
| Upcoming booking | `computeCheckins()` | exists — re-homed |
| Review follow-ups | — | **new** (§5.6) |
| IDs pending | — | **new** (§5.7) |
| Pending amount | `computePayouts()` | exists — re-homed |

Each row deep-links to the underlying record. "Pending amount" retains its
multi-select → "mark paid" flow (`setPayouts`).

**Empty state matters.** With nothing outstanding this is the first screen in the
app that renders an empty list, so it needs a deliberate "all clear" state rather
than a blank panel.

### 5.2 Dashboard

Specified as: KPI cards, cash position, check-in sections, pending payments,
charts, drill-downs.

**⚠️ Open question (Q1).** Check-in sections and pending payments now appear in
**both** Action and Dashboard. That may be intentional — Action as the to-do
list, Dashboard as the full picture — or it may be carried over from the
description of the *current* layout. It needs an explicit decision, because
duplicated surfaces drift apart over time. (The web/mobile cash-position mismatch
found on 12 Aug is exactly that failure mode.)

Metric changes either way:

| Metric | Status |
|---|---|
| Total revenue / expense / Net P&L / bookings | exists |
| Current-month revenue / expense / P&L / bookings | exists |
| Total bank balance | exists |
| **Total invested** | computed — **promote to a KPI card** |
| **Total Pending amount** | computed — **not shown; add** |
| Monthly P&L (Recurring + Operating) | exists |
| Revenue by channel | exists |
| Repeat customers by month | exists |
| Recent bookings | exists |

Note: the app currently shows *this month's* awaiting-payout. The requested
**Total Pending amount** is a different figure. Both are worth keeping, but they
must be labelled distinctly.

### 5.3 Add (form + log)

**Five segments:** Booking · Expense · Saving · Property · Inventory
*(the brief said "4 segments" but listed five — treated as five.)*

Forms stay mounted so switching segments never loses a typed draft — unchanged
from today.

**New:** each segment shows its **log directly below the form**. Selecting a log
row loads that record into the form above for editing, which replaces the current
Logs-tab → form deep-link.

**Feasibility:** cheap. `LogsScreen` is already a component taking a `which`
prop (`blog` / `elog` / `slog` / `prop`), so it can be embedded under a form
without rewriting it. The work is layout and scroll behaviour, not logic.

**Design considerations:**
- Form and log compete for vertical space on a phone. The form likely needs to
  collapse once submitted, or the log needs its own scroll region.
- The "editing" state needs to be obvious when a log row is loaded into the form,
  and needs an unambiguous way to cancel back to a blank form.

### 5.4 Today's check-out (new)

`computeCheckins()` buckets bookings by **check-in date only**. It reads checkout
*time* for display but never buckets by checkout *date*, so departures are
invisible.

Data already exists (`checkout_date`). Small extension to the existing
computation — no API or schema change.

### 5.5 Inventory as an Add segment

Inventory currently holds **two** record types: items (Item Master) and stock
movements (Stock Log). A single Add segment maps cleanly onto items, but stock
movements need a home.

**⚠️ Open question (Q2).** Options: a toggle inside the Inventory segment; a
sixth segment; or movements reached only from an item's detail view.

Low-stock items are a natural candidate for an Action section, though not
requested — noted, not scoped.

### 5.6 Review follow-ups (new capability)

**No review state exists anywhere today** — not in the app, the API, D1, or the
original spreadsheets. This is the only item requiring a **schema change**.

| Approach | How it works | Trade-off |
|---|---|---|
| **A — Derived only** | List bookings that checked out in the last N days | No schema change, ships immediately. But it can never be cleared — a guest who already reviewed still appears until the window passes |
| **B — Tracked state (recommended)** | Add `review_status` to `bookings` (`pending` / `requested` / `received` / `skipped`) | Needs a migration and a new API action, but the list is actionable and clears as you work it |

B recommended: a list that cannot be dismissed trains you to ignore it, which
defeats the purpose of the Action tab.

Under B: migration `0003` adds `review_status`; new action
`setReviewStatus(row, status)`; the follow-up appears once checkout has passed
and status is not `received`/`skipped`.

### 5.7 Guest ID documents (new capability)

The dependency behind "IDs pending".

**Storage.** Private Cloudflare R2 bucket (`FILES` binding, already declared in
`wrangler.toml`, currently commented out). Only the object key is stored in D1.
The `attachments` table already exists:

```
attachments(id, entity_type, entity_id, kind, r2_key,
            filename, content_type, size_bytes, uploaded_at)
```

Here: `entity_type='booking'`, `kind='id_proof'`.

**New API actions (4):** `uploadAttachment`, `listAttachments`, `getAttachment`
(PIN-gated download proxy), `deleteAttachment`.

Uploads must be **POST**, so they cannot use the JSONP path. The mobile app uses
`fetch` and CORS is already enabled — a second reason web is out of scope.

**"IDs pending" definition:** bookings with no attachment of `kind='id_proof'`,
limited to bookings whose check-in is today or later, so the list reflects action
still worth taking rather than a permanent historical backlog.

**Privacy — deliberate constraints:**
- Bucket is **private**; downloads proxied through the Worker behind the PIN.
- **Prefer masked Aadhaar** (last 4 digits) unless the full document is genuinely
  required. Full Aadhaar numbers carry real handling obligations under the
  Aadhaar Act.
- Changes the security calculus materially — see §8.

## 6. Data model changes

| Change | Needed for |
|---|---|
| R2 bucket created + binding uncommented | IDs pending |
| `bookings.review_status` column (migration 0003) | Review follow-ups |

The `attachments` table already exists and is indexed. No other schema changes.

## 7. Sequencing

| Phase | Contents | Backend work? |
|---|---|---|
| **1** | Three-tab shell; Action tab with the 4 existing sections | No |
| **2** | Logs under each Add segment; Inventory becomes a segment; retire Logs + Inventory tabs | No |
| **3** | Today's check-out; Total Pending + Total invested KPI cards | No |
| **4** | Rate limiting on failed PIN attempts | Yes — small |
| **5** | Review follow-ups (migration + action + UI) | Yes |
| **6** | R2 + attachment actions + upload control + IDs pending | Yes — largest |

Phases 1–3 are client-only against an unchanged API. **Phase 4 is placed before
Phase 6 deliberately** — see §8.

## 8. Risks and constraints

| Risk | Notes |
|---|---|
| **PIN strength vs guest ID data** | 4-digit PIN, no rate limiting, public endpoint. Today a compromise exposes the owner's own financial figures. Once guest ID documents are stored it would expose **third parties' government ID** — a different category of harm, affecting people who never accepted the risk. Treated here as a **prerequisite** for the ID feature, not an optional extra. |
| **Duplicated surfaces** | If check-ins and pending payments live in both Action and Dashboard (Q1), the two will drift unless they share one computation. |
| **Vertical space in Add** | Form + log in one scroll view is tight on a phone; needs a deliberate layout decision, not a default. |
| **Expo Go dependency** | Runs via Expo Go against a dev server; not independently installed until an EAS build is made. |
| **Old Apps Script is down** | HTTP 500 as of 12 Aug 2026. D1 is the sole source of truth; the parity harness can no longer be re-run. |
| **Sheet mirror inactive** | Built but not enabled; spreadsheets remain frozen at their pre-migration state. |
| **Upload size / cost** | R2 free tier is 10 GB with zero egress. Client-side image compression advisable, not required at this volume. |

## 9. Out of scope

- Web dashboard restructure
- Two-way sheet sync (explicitly rejected — one-way mirror only)
- Changes to booking / expense / property / savings field sets
- Multi-user accounts or per-user permissions

## 10. Open questions

**Structure**
1. **(Q1)** Check-in sections and pending payments appear in both Action and
   Dashboard — intentional, or should Dashboard drop them?
2. **(Q2)** Where do inventory **stock movements** live now that Inventory is one
   Add segment?
3. Should **Action** be the default landing tab, or does Dashboard keep that role?
4. In the Add tab, should the form collapse after submit to give the log room?

**IDs pending**
5. One ID per **booking**, or per **guest** (lead and co-guest separately)?
6. Required for **every** booking, or only certain channels (e.g. offline/direct)?
7. **Camera capture** in-app, or file picker only?
8. **Retention** — should ID documents auto-delete some period after checkout?

**Review follow-ups**
9. Approach **A (derived)** or **B (tracked state)**? B recommended.
10. How long after checkout should the follow-up appear?
11. Distinguish "review requested" from "review received", or a single
    done/not-done state?
