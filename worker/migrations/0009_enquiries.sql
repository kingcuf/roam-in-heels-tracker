-- Enquiries sent from the public website (roam-in-heels.com).
--
-- Additive only: a client that predates this migration keeps working; `logs`
-- simply carries one more block it ignores.
--
-- Written by the website's /api/enquiry function (server-to-server, with the
-- ENQUIRY_KEY secret), never directly by a browser, and read by the app's
-- Action tab so a lead is followed up from the same place as everything else.

CREATE TABLE IF NOT EXISTS enquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT '',   -- ISO timestamp, UTC
  property    TEXT NOT NULL DEFAULT '',   -- dashboard property name, e.g. 'Spira 2212'
  full_name   TEXT NOT NULL DEFAULT '',
  mobile      TEXT NOT NULL DEFAULT '',
  check_in    TEXT NOT NULL DEFAULT '',   -- 'YYYY-MM-DDTHH:MM' as typed, guest's local time
  check_out   TEXT NOT NULL DEFAULT '',
  guests      INTEGER NOT NULL DEFAULT 0,
  message     TEXT NOT NULL DEFAULT '',
  referral    TEXT NOT NULL DEFAULT '',   -- how they heard about us
  /* new → contacted → booked | closed. A status rather than a done flag: a
     lead that was called but did not book is not the same as one never called. */
  status      TEXT NOT NULL DEFAULT 'new',
  status_at   TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT ''    -- the host's own follow-up notes
);

CREATE INDEX IF NOT EXISTS idx_enquiries_created ON enquiries(created_at);
