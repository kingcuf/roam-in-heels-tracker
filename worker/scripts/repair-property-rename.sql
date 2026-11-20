-- One-off repair: property 685-SECTOR-45-GGN was renamed
--   "685, Sector 45, Ggn"  ->  "403, Plot no 685, Sector 45"
-- but bookings/expenses store the property NAME, so 16 bookings and 49
-- expenses were left pointing at the old name and the per-property dashboard
-- read ZERO. Re-point them. Safe to re-run (no rows match the second time).
UPDATE bookings  SET property       = '403, Plot no 685, Sector 45' WHERE property       = '685, Sector 45, Ggn';
UPDATE bookings  SET stay_property  = '403, Plot no 685, Sector 45' WHERE stay_property  = '685, Sector 45, Ggn';
UPDATE expenses  SET property       = '403, Plot no 685, Sector 45' WHERE property       = '685, Sector 45, Ggn';
UPDATE inv_items SET property       = '403, Plot no 685, Sector 45' WHERE property       = '685, Sector 45, Ggn';
UPDATE enquiries SET property       = '403, Plot no 685, Sector 45' WHERE property       = '685, Sector 45, Ggn';
