-- ONE-OFF RESTATEMENT — run once, at deploy time, AFTER 0008_cross_unit_split.sql.
--
-- Not a migration: migrations describe the shape of the table, this changes the
-- attribution of a booking that was entered before the rule existed. Keeping it
-- out of migrations/ also keeps it out of anything that might replay the folder.
--
-- Scope: TWO rows. Every booking was checked by query, not by list — B234
-- (3 Sep) and B284 (19 Sep), both Spira 3028 with stay unit '2212', are the
-- only bookings where both units are ours and they differ.
--
-- B284 was added AFTER the 18-Sep backup this file was first prepared against,
-- so the original sweep could not have seen it. Re-scan immediately before
-- running this: these two are cross-unit bookings roughly a fortnight apart, so
-- a third can appear between preparing this file and running it.
--
-- B175 (9 Aug, Spira 2212, stay unit '2121') is NOT in scope: 2121 is a real
-- third-party flat, confirmed by the owner, not a mistyped 2212. Nothing here
-- touches it. There is no reverse-direction booking (taken on 2212, guest in
-- 3028) anywhere in the book — verified across all 51 bookings on 2212.
--
-- The WHERE clause re-asserts every value this restatement depends on, so if
-- the row has been edited since this was prepared the statement quietly matches
-- nothing instead of writing a stale figure over a corrected one. Check the
-- verification query below reports 1 row before trusting the run.
--
--   npx wrangler d1 execute spira --remote --file=migrations/0008_cross_unit_split.sql
--   npx wrangler d1 execute spira --remote --file=scripts/restate-cross-unit-split.sql
--
-- NEVER `wrangler d1 migrations apply --remote`: the remote d1_migrations table
-- is empty, so it would replay 0001 (which DROPs every table) against live data.

UPDATE bookings
   SET stay_property = 'Spira 2212',
       split_fee     = 500
 WHERE booking_id       = 'B234'
   AND property         = 'Spira 3028'
   AND TRIM(stay_unit)  = '2212'
   AND net_earned       = 9294;

UPDATE bookings
   SET stay_property = 'Spira 2212',
       split_fee     = 500
 WHERE booking_id       = 'B284'
   AND property         = 'Spira 3028'
   AND TRIM(stay_unit)  = '2212'
   AND net_earned       = 3894;

-- Verify: expects exactly TWO rows —
--   B234 | Spira 3028 | Spira 2212 | 500.0 | net 9294 | pending 9294
--   B284 | Spira 3028 | Spira 2212 | 500.0 | net 3894 | pending 2894
SELECT booking_id, property, stay_property, split_fee, net_earned, pending_amount
  FROM bookings
 WHERE split_fee IS NOT NULL;
