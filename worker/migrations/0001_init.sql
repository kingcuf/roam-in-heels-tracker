-- Spira Tracker — D1 schema
--
-- Ported from two Google Sheets:
--   PnL workbook 1QO8wQqKENFWqmRtc0Lwc1iSHIhMnhwA-6j4k-nS4t2Y  (Bookings/Expenses/Properties/Savings)
--   IMS workbook 14JAEgwyN3Zr7DrohWviRC0rHovSJ8BERM-kaSaSozxI  (Item Master/Stock Log/Lists)
--
-- Design notes:
--  * Every table's INTEGER PRIMARY KEY replaces the sheet row number that the
--    clients round-trip as `r`/`row`. Clients treat it as opaque, so the wire
--    contract is unchanged — but ids no longer shift when a row is deleted,
--    which was the sheet's main correctness hazard.
--  * Dates are stored as ISO 'YYYY-MM-DD' TEXT and times as the display string
--    ('h:mm a') the sheet already emitted. Lexicographic ordering on ISO dates
--    is chronological, so no date parsing is needed for range filters.
--  * bookings.property / expenses.property hold the property NAME (e.g.
--    'Spira 3028'), not properties.id ('SPIRA-3028') — that is what the sheet
--    stored and what the dashboard filter compares against. Deliberately left
--    without a foreign key so imports of historical rows can't fail on a
--    property that was renamed or never listed.
--  * Money is REAL. Values here are whole rupees; REAL matches the sheet's own
--    numeric behaviour rather than inventing a precision guarantee it never had.

DROP TABLE IF EXISTS properties;
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS expenses;
DROP TABLE IF EXISTS savings;
DROP TABLE IF EXISTS inv_items;
DROP TABLE IF EXISTS inv_movements;
DROP TABLE IF EXISTS inv_lists;
DROP TABLE IF EXISTS attachments;

/* ─────────────── PROPERTIES ─────────────── */
CREATE TABLE properties (
  id         TEXT PRIMARY KEY,          -- 'SPIRA-3028', user-editable via updateProperty
  name       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'Active',
  onboarded  TEXT NOT NULL DEFAULT '',  -- 'YYYY-MM-DD' or ''
  rent       REAL,                      -- NULL = blank cell (distinct from 0)
  notes      TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0 -- preserves the sheet's row order
);

/* ─────────────── BOOKINGS ─────────────── */
-- Column order mirrors Bookings!A..Z so logs/cells round-trip unchanged.
CREATE TABLE bookings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_date     TEXT NOT NULL DEFAULT '',  -- A  'YYYY-MM-DD'
  property         TEXT NOT NULL DEFAULT '',  -- B  property NAME
  lead_guest       TEXT NOT NULL DEFAULT '',  -- C
  booking_type     TEXT NOT NULL DEFAULT '',  -- D  Stay | Resold | Pass
  channel          TEXT NOT NULL DEFAULT '',  -- E
  referrer         TEXT NOT NULL DEFAULT '',  -- F
  list_price       REAL,                      -- G  NULL = blank
  discount         REAL,                      -- H
  guest_paid       REAL,                      -- I
  net_earned       REAL NOT NULL DEFAULT 0,   -- J  required by the API
  commission_paid  REAL,                      -- K
  pending_amount   REAL,                      -- L  cleared by setPayouts
  notes            TEXT NOT NULL DEFAULT '',  -- M
  phone            TEXT NOT NULL DEFAULT '',  -- N  TEXT: leading zeros / +91 must survive
  lead_birth_yr    TEXT NOT NULL DEFAULT '',  -- O
  co_guest         TEXT NOT NULL DEFAULT '',  -- P
  co_guest_birth_yr TEXT NOT NULL DEFAULT '', -- Q
  guests           REAL,                      -- R
  booking_id       TEXT NOT NULL DEFAULT '',  -- S  'B001' business key
  month            TEXT NOT NULL DEFAULT '',  -- T  'May 2026', derived from booking_date
  checkin_date     TEXT NOT NULL DEFAULT '',  -- U
  checkout_date    TEXT NOT NULL DEFAULT '',  -- V
  checkin_time     TEXT NOT NULL DEFAULT '',  -- W  display string, e.g. '2:00 PM'
  checkout_time    TEXT NOT NULL DEFAULT '',  -- X
  stay_unit        TEXT NOT NULL DEFAULT '',  -- Y  TEXT: values like '3103, 3028' exist
  repeat_flag      INTEGER                    -- Z  1, NULL = blank (sheet wrote '')
);
CREATE INDEX idx_bookings_date     ON bookings(booking_date);
CREATE INDEX idx_bookings_property ON bookings(property);
CREATE UNIQUE INDEX idx_bookings_bid ON bookings(booking_id) WHERE booking_id <> '';

/* ─────────────── EXPENSES ─────────────── */
-- Mirrors Expenses!A..M.
CREATE TABLE expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  txn_date      TEXT NOT NULL DEFAULT '',    -- A  'YYYY-MM-DD' or '' (often blank)
  expense_month TEXT NOT NULL DEFAULT '',    -- B  'YYYY-MM-01', the month bucket
  item          TEXT NOT NULL DEFAULT '',    -- C
  property      TEXT NOT NULL DEFAULT '',    -- D  property NAME
  category      TEXT NOT NULL DEFAULT '',    -- E
  quantity      REAL,                        -- F
  amount        REAL,                        -- G  NULL = blank (7 legacy rows)
  type          TEXT NOT NULL DEFAULT '',    -- H  One-time | Recurring | Operating | Deposit
  status        TEXT NOT NULL DEFAULT '',    -- I  Bought | Pending | Ordered
  refundable    TEXT NOT NULL DEFAULT 'No',  -- J  Yes | No  (drives the deposits KPI)
  vendor        TEXT NOT NULL DEFAULT '',    -- K
  notes         TEXT NOT NULL DEFAULT '',    -- L
  init_invest   INTEGER                      -- M  1/0, NULL = never set
);
CREATE INDEX idx_expenses_month    ON expenses(expense_month);
CREATE INDEX idx_expenses_property ON expenses(property);

/* ─────────────── SAVINGS (global, not per-property) ─────────────── */
CREATE TABLE savings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  date       TEXT NOT NULL DEFAULT '',      -- A
  amount     REAL NOT NULL DEFAULT 0,       -- B
  scheme     TEXT NOT NULL DEFAULT 'Other', -- C
  platform   TEXT NOT NULL DEFAULT 'Others',-- D
  status     TEXT NOT NULL DEFAULT 'Active',-- E
  returns    REAL,                          -- F  NULL for Active entries
  notes      TEXT NOT NULL DEFAULT '',      -- G
  created_at TEXT NOT NULL DEFAULT ''       -- H  never rewritten on update
);

/* ─────────────── INVENTORY ───────────────
   The sheet's computed columns (Item Key, In Stock, Pending, Low Stock,
   Total Cost, Signed Qty) were ARRAYFORMULAs pinned to row 2, which is why the
   Apps Script had to avoid touching cols F/H/I/K and had to *clear* rather than
   delete row 2. Here they are derived at read time in SQL, so that whole class
   of formula-corruption bug disappears. */
CREATE TABLE inv_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       TEXT NOT NULL,               -- A  'LGT-01' business key
  property      TEXT NOT NULL DEFAULT '',    -- B
  category      TEXT NOT NULL DEFAULT '',    -- C
  item          TEXT NOT NULL DEFAULT '',    -- D
  type          TEXT NOT NULL DEFAULT 'Asset', -- E  Asset | Consumable
  required_qty  REAL,                        -- G
  reorder_level REAL,                        -- J  NULL = no reorder point set
  unit_price    REAL,                        -- L
  vendor        TEXT NOT NULL DEFAULT '',    -- M
  remarks       TEXT NOT NULL DEFAULT ''     -- N
);
CREATE UNIQUE INDEX idx_inv_items_itemid ON inv_items(item_id);

CREATE TABLE inv_movements (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  date      TEXT NOT NULL DEFAULT '',   -- A
  item_key  TEXT NOT NULL DEFAULT '',   -- B  'LGT-01 · Under bed LED lights'
  movement  TEXT NOT NULL DEFAULT '',   -- C
  qty       REAL NOT NULL DEFAULT 0,    -- D
  unit_cost REAL,                       -- E  NULL = blank
  vendor    TEXT NOT NULL DEFAULT '',   -- G
  logged_by TEXT NOT NULL DEFAULT '',   -- H
  remarks   TEXT NOT NULL DEFAULT ''    -- I
);
CREATE INDEX idx_inv_mv_key ON inv_movements(item_key);

-- Replaces the IMS 'Lists' tab: dropdown option sets, ordered.
CREATE TABLE inv_lists (
  kind  TEXT NOT NULL,      -- properties | categories | types | movements | vendors
  value TEXT NOT NULL,
  sort  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, sort)
);

/* ─────────────── ATTACHMENTS (R2 object pointers) ───────────────
   Not yet wired to an upload route — defined now so the schema is stable.
   Files live in R2 (private bucket); only the key is stored here. Downloads are
   proxied through the Worker behind the PIN check, so ID documents are never on
   a publicly guessable URL. */
CREATE TABLE attachments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type  TEXT NOT NULL,              -- 'booking' | 'expense' | 'property' | 'inv_item'
  entity_id    INTEGER NOT NULL,           -- FK-by-convention into that table's id
  kind         TEXT NOT NULL DEFAULT '',   -- 'id_proof' | 'guest_photo' | 'receipt' | 'property_photo'
  r2_key       TEXT NOT NULL,              -- object key in the R2 bucket
  filename     TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT '',
  size_bytes   INTEGER NOT NULL DEFAULT 0,
  uploaded_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_attach_entity ON attachments(entity_type, entity_id);
