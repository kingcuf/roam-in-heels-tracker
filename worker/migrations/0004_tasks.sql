-- Actions: a plain to-do list, surfaced on the app's Action tab alongside the
-- queues derived from bookings and stock.
--
-- Additive only — no existing table is touched, so a client that predates this
-- migration keeps working; `logs` simply carries one more block it ignores.
--
-- Why its own table rather than a column somewhere: every other Action queue is
-- *derived* (a check-in is a booking, a payout is a pending amount). These are
-- the only items with no source record of their own, so they need one.

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL DEFAULT '',   -- what to do
  end_date    TEXT NOT NULL DEFAULT '',   -- 'YYYY-MM-DD'; drives where it sorts and when it becomes due
  description TEXT NOT NULL DEFAULT '',   -- optional detail, editable after the fact
  /* 0/1 rather than a status string: there are exactly two states, and a
     boolean cannot drift into a fourth spelling of "done". */
  done        INTEGER NOT NULL DEFAULT 0,
  done_at     TEXT NOT NULL DEFAULT '',   -- when it was ticked, '' while open
  created_at  TEXT NOT NULL DEFAULT ''
);

-- The list is read in end-date order on every load.
CREATE INDEX IF NOT EXISTS idx_tasks_end ON tasks(end_date);
