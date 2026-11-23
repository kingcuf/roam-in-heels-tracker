/* Cover photos for the booking page banner, keyed by unit number. Taken from
   each flat's Airbnb listing (the lead photo) and bundled with the app, so the
   banner never depends on Airbnb's CDN staying put. A unit with no photo here
   (a partner flat a stay was moved to) gets the plain branded banner. */
const COVERS: Record<string, number> = {
  '3028': require('../assets/units/3028.jpg'),
  '2212': require('../assets/units/2212.jpg'),
  '403': require('../assets/units/403.jpg'),
  '101': require('../assets/units/101.jpg'),
};
export const coverFor = (unit: string): number | null => COVERS[String(unit || '').trim()] ?? null;
