/* Guests beyond the lead and co-guest (17-Sep-2026). JSON array of
   {"name": "...", "birthYr": "..."}; '' when there are none. Guests 1 and 2
   stay in lead_guest / co_guest so every existing reader keeps working. */
ALTER TABLE bookings ADD COLUMN extra_guests TEXT NOT NULL DEFAULT '';
