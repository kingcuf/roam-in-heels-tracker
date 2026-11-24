-- The host's share of a booking, kept with the deal (not on bookings): the
-- booking's commission column stays "everything deducted" (paid - net), and
-- platform commission = that total - host_share. NULL = not entered (legacy:
-- the whole commission was the host's share).
ALTER TABLE host_deals ADD COLUMN host_share REAL;
