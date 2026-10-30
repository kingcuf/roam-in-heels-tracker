-- Savings can be exited (FD matured, Groww withdrawn). exit_date is when the
-- money came back to the bank; `returns` now holds the TOTAL received on exit
-- (principal + gain), not the gain alone. Apply with
--   wrangler d1 execute spira --remote --file migrations/0010_saving_exit.sql
-- never `migrations apply --remote` (remote d1_migrations is empty).
ALTER TABLE savings ADD COLUMN exit_date TEXT NOT NULL DEFAULT '';
