-- Hosts: other owners we exchange guests with, their units, the booking
-- each deal rides on, and the money settled between us.
-- Additive only: no existing table is altered.

CREATE TABLE IF NOT EXISTS hosts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT '',
  updated_by  TEXT NOT NULL DEFAULT '',
  removed_at  TEXT NOT NULL DEFAULT ''
);

-- A host's flat. The guest-facing details live here so a guest placed in it
-- gets its address and Wi-Fi in our messages, never the host's name.
CREATE TABLE IF NOT EXISTS host_units (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id         INTEGER NOT NULL,
  unit            TEXT NOT NULL,                 -- '3103'
  building        TEXT NOT NULL DEFAULT '',      -- 'Spira, Sector 68'
  address         TEXT NOT NULL DEFAULT '',
  map_link        TEXT NOT NULL DEFAULT '',
  wifi_name       TEXT NOT NULL DEFAULT '',
  wifi_password   TEXT NOT NULL DEFAULT '',
  checkin_time    TEXT NOT NULL DEFAULT '',
  checkout_time   TEXT NOT NULL DEFAULT '',
  caretaker_name  TEXT NOT NULL DEFAULT '',
  caretaker_phone TEXT NOT NULL DEFAULT '',
  notes           TEXT NOT NULL DEFAULT '',
  removed_at      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_host_units_host ON host_units(host_id);

-- One deal per booking. unit_id 0 = the guest stayed in OUR flat (their guest
-- -> our flat); otherwise our guest stayed in this host unit.
-- collected_by: who took the guest's money ('host' | 'us').
-- settled 1 = history from before the ledger existed; never counted in a balance.
CREATE TABLE IF NOT EXISTS host_deals (
  booking_row  INTEGER PRIMARY KEY,
  host_id      INTEGER NOT NULL,
  unit_id      INTEGER NOT NULL DEFAULT 0,
  collected_by TEXT NOT NULL DEFAULT 'host',
  settled      INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT '',
  updated_by   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_host_deals_host ON host_deals(host_id);

-- Money that actually moved. direction: 'paid' (we paid the host) |
-- 'received' (the host paid us).
CREATE TABLE IF NOT EXISTS host_payments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  host_id     INTEGER NOT NULL,
  txn_date    TEXT NOT NULL,
  amount      REAL NOT NULL,
  direction   TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  removed_at  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_host_payments_host ON host_payments(host_id);
