-- Booking checklists: what the property manager does before check-in, at
-- check-in, during the stay and at check-out.
--
-- Additive only. A client that predates this ignores the `checklist` block
-- that `logs` now carries.
--
-- APPLY ON PRODUCTION WITH `wrangler d1 execute --remote --file`, never
-- `migrations apply`: production's d1_migrations history is empty, so
-- `migrations apply` would re-run 0001_init.sql, which drops every table.

/* One row per checklist step.
     * property-wide step: property = the property NAME (the same value the
       app filters by), booking_row = 0. Edited by an Admin on the property.
     * one-off step for a single booking: booking_row = bookings.id,
       property = ''.
   Property steps are never hard-deleted: removed_at is stamped instead, so a
   booking that had already checked out when the step was added or removed
   keeps the checklist it actually had (see checklistFor in the app). */
CREATE TABLE IF NOT EXISTS checklist_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  property     TEXT NOT NULL DEFAULT '',
  booking_row  INTEGER NOT NULL DEFAULT 0,
  preset       TEXT NOT NULL DEFAULT '',        -- ids | unit_details | entry_pass | campaign | review | '' (custom)
  label        TEXT NOT NULL,
  stage        TEXT NOT NULL DEFAULT 'checkin', -- before | checkin | stay | checkout
  sort         INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT '',        -- ISO timestamp, UTC
  created_by   TEXT NOT NULL DEFAULT '',
  removed_at   TEXT NOT NULL DEFAULT ''         -- '' = live
);
CREATE INDEX IF NOT EXISTS idx_checklist_items_property ON checklist_items(property);
CREATE INDEX IF NOT EXISTS idx_checklist_items_booking  ON checklist_items(booking_row);

/* A tick: this step is done for this booking. Unticking deletes the row.
   'ids' and 'review' steps are never ticked here — they are read from the ID
   uploads and the booking's review status. */
CREATE TABLE IF NOT EXISTS checklist_ticks (
  booking_row  INTEGER NOT NULL,
  item_id      INTEGER NOT NULL,
  done_by      TEXT NOT NULL DEFAULT '',
  done_at      TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (booking_row, item_id)
);
