// "Porcelain & Gold" — modern minimalist luxury (Milkinside-inspired restyle).
// Same token names as before so every component re-skins automatically:
//   navy → ink black (primary/emphasis)   blue → deep gold (accent)
//   warm surfaces, hairline borders, muted semantic colors.
export const C = {
  navy: '#111114',      // ink black — primary buttons, headline text
  blue: '#B98036',      // deep gold — accents, active states, links
  blue2: '#9A6A2B',
  line: '#E9E6DE',      // hairline borders
  bg: '#F7F6F2',        // warm porcelain background
  card: '#FFFFFF',
  ink: '#16161A',
  muted: '#9A99A1',
  green: '#33735C',     // muted emerald (revenue / positive)
  greenbg: '#EEF4F0',
  amber: '#B98036',     // gold (expense / warnings)
  amberbg: '#F8F1E4',
  red: '#B4574A',       // terracotta (negative)
  redbg: '#F8ECE9',
  sky: '#4A4A55',       // graphite (bookings / info)
  skybg: '#F0F0F3',
  copper: '#E3A857',    // light gold
  bark: '#6E6E76',      // labels
  bone: '#F1EFE8',      // ghost buttons, chips
  warm: '#F7F5EF',
  warm2: '#FAF8F3',
  hair: '#F0EEE7',
};

// Manrope everywhere: airy body, extra-bold display numbers/headlines.
export const F = {
  reg: 'Manrope_400Regular',
  med: 'Manrope_500Medium',
  semi: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  xbold: 'Manrope_800ExtraBold',
};

// Indian-style digit grouping (1,23,45,678) — Hermes' toLocaleString('en-IN')
// isn't reliable on all platforms, so group manually.
export function groupINR(n: number): string {
  const neg = n < 0;
  let s = String(Math.abs(Math.round(n)));
  if (s.length > 3) {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    s = rest + ',' + last3;
  }
  return (neg ? '-' : '') + s;
}

export const inr = (n: number) => '₹' + groupINR(n || 0);

/* ── "Glass & depth" (Sep-2026 redesign) ──
   Frosted cards over a warm blush→sand field. Kept as separate tokens so the
   Porcelain palette above still drives text and semantic colours. */
export const G = {
  bgTop: '#F9EDE6',       // blush
  bgMid: '#F6F0E7',       // porcelain
  bgBot: '#EFE3D0',       // sand
  orbA: 'rgba(227,168,87,0.35)',   // gold light
  orbB: 'rgba(214,140,130,0.28)',  // rose
  orbC: 'rgba(160,170,200,0.22)',  // dusk
  glass: 'rgba(255,255,255,0.58)',
  glassHi: 'rgba(255,255,255,0.82)',
  glassEdge: 'rgba(255,255,255,0.9)',
  glassLine: 'rgba(185,128,54,0.14)',
  shadow: '#5A3A14',
  gold1: '#E9B96E',
  gold2: '#B98036',
  gold3: '#7A5220',
};
