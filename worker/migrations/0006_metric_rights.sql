/* Report metric rights (17-Sep-2026).
   Four metric groups become rights in the role matrix, and each user can
   override them. Existing Manager/Viewer roles get all four so nobody loses a
   figure they can see today. rights_override is a JSON object
   {"metric.cash": false, ...}; a key that is absent means "follow the role". */
ALTER TABLE users ADD COLUMN rights_override TEXT NOT NULL DEFAULT '{}';

UPDATE roles
   SET rights = json_insert(rights, '$[#]', 'metric.money', '$[#]', 'metric.cash', '$[#]', 'metric.bookings', '$[#]', 'metric.expenses')
 WHERE name IN ('Manager', 'Viewer')
   AND rights NOT LIKE '%metric.money%';
