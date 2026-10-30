-- Users, role-based rights, and the change-approval ticket queue.
--
-- Additive only. The shared PIN in the Worker secret keeps working as the
-- built-in "owner" account (role Admin), so existing installs and anyone who
-- has not been given a username are not locked out by this migration.

/* One row per role. `rights` is a JSON array of right keys (see RIGHTS in
   src/auth.js). Three fixed roles; what each may do is editable by an Admin,
   except Admin itself, which always holds every right so it cannot be locked
   out of the rights screen. */
CREATE TABLE IF NOT EXISTS roles (
  name   TEXT PRIMARY KEY,
  rights TEXT NOT NULL DEFAULT '[]',
  sort   INTEGER NOT NULL DEFAULT 0
);

INSERT OR IGNORE INTO roles (name, rights, sort) VALUES
  ('Admin', '["booking.add","booking.update","booking.delete","expense.add","expense.update","expense.delete","saving.add","saving.update","saving.delete","property.add","property.update","property.delete","inventory.add","inventory.update","inventory.delete","reports.view","calendar.view","action.view","action.manage","tickets.approve","users.manage"]', 1),
  ('Manager', '["booking.add","booking.update","booking.delete","expense.add","expense.update","expense.delete","saving.add","saving.update","saving.delete","property.add","property.update","property.delete","inventory.add","inventory.update","inventory.delete","reports.view","calendar.view","action.view","action.manage","tickets.approve"]', 2),
  ('Viewer', '["reports.view","calendar.view","action.view"]', 3);

CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_salt   TEXT NOT NULL,
  pin_hash   TEXT NOT NULL,              -- hex SHA-256 of salt:pin, never the PIN itself
  role       TEXT NOT NULL DEFAULT 'Viewer' REFERENCES roles(name),
  /* Who approves this user's changes. 0 = the owner / any Admin. NULL only for
     Admins, whose changes apply directly. */
  manager_id INTEGER,
  active     INTEGER NOT NULL DEFAULT 1, -- deactivate rather than delete: tickets keep their author
  created_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT ''
);

/* A proposed update or delete that waits for a manager.
   status:  pending   -> waiting for the approver
            applying  -> claimed by an approval in flight (guards double-approve)
            approved  -> applied to the data
            open      -> rejected with a comment; the requester edits and resubmits
            cancelled -> withdrawn by the requester */
CREATE TABLE IF NOT EXISTS tickets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL,          -- booking | expense | saving | property | inventory
  op             TEXT NOT NULL,          -- update | delete
  action         TEXT NOT NULL,          -- the API action replayed on approval, e.g. updateBooking
  target         TEXT NOT NULL,          -- row id, or property id for properties
  label          TEXT NOT NULL DEFAULT '',
  payload        TEXT NOT NULL DEFAULT '{}',
  before         TEXT NOT NULL DEFAULT '{}',  -- the record as it was when the request was raised
  changes        TEXT NOT NULL DEFAULT '[]',  -- [{field, from, to}] for display
  status         TEXT NOT NULL DEFAULT 'pending',
  requested_by   INTEGER NOT NULL,
  requester_name TEXT NOT NULL DEFAULT '',
  approver_id    INTEGER NOT NULL DEFAULT 0,  -- 0 = any Admin
  comment        TEXT NOT NULL DEFAULT '',
  reviewed_by    TEXT NOT NULL DEFAULT '',
  reviewed_at    TEXT NOT NULL DEFAULT '',
  attempts       INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tickets_status   ON tickets(status, approver_id);
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requested_by, status);
CREATE INDEX IF NOT EXISTS idx_tickets_target   ON tickets(kind, target, status);
