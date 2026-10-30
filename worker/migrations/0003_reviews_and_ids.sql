-- Review follow-ups + guest ID documents.
--
-- Additive only: no existing column is altered or dropped, and the new booking
-- column is appended, so the positional `cells` arrays the clients read keep
-- indices 0..25 exactly as they were. review_status becomes cell index 26.

/* Review follow-ups — approach B (tracked state).
   '' is the implicit 'pending': every existing row predates the column and must
   surface as needing a follow-up rather than being silently treated as done. */
ALTER TABLE bookings ADD COLUMN review_status TEXT NOT NULL DEFAULT '';

/* Which guest an ID document belongs to. The booking is the container
   (attachments.entity_id), and slot distinguishes the people inside it. */
ALTER TABLE attachments ADD COLUMN slot TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_attach_slot ON attachments(entity_type, entity_id, slot);

/* Throttle state for failed PIN attempts, keyed by client IP.
   Guest ID documents sit behind a 4-digit PIN on a public endpoint; without
   this, the entire keyspace is exhaustible in minutes. */
CREATE TABLE IF NOT EXISTS auth_throttle (
  ip            TEXT PRIMARY KEY,
  fails         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL DEFAULT 0,   -- epoch ms
  blocked_until INTEGER NOT NULL DEFAULT 0    -- epoch ms
);
