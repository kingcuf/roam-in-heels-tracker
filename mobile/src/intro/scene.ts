/* "Roam in Heels" intro film — scene description as a pure function of time.

   scene(t) returns a small SVG node tree. The app renders it with
   react-native-svg (IntroFilm.tsx); scripts/render-intro.mjs turns the same
   tree into SVG markup so frames can be checked in a browser without a phone.
   No React or React Native imports here, on purpose.

   Storyboard (seconds):
     0.0–4.2  sunset beach; she walks the shoreline toward camera, runway style
     4.2–5.2  she stops, crosses a foot, flips her hair, hand to hip
     5.25–6.45 camera pushes in on the heels
     6.2–6.6  flash cut to the close-up: gold stilettos on the sand
     6.65–8.4 sparkle + title (drawn by the app)
     8.1–9.0  the close-up lifts; the login card rises (CARD_CUE)
     9.0–9.45 fade out — the login backdrop is the same frame              */

export type Node = { t: string; p?: Record<string, string | number>; c?: Node[] };
import { STRIKES, feetFocus, footprintsFront, walkerFront } from './runway';
export { STRIKES };
/* The close-up and everything after it run this much later than their own
   clocks say, to leave room for the walk's hair-flip beat. */
const SHIFT = 0.55;

export const W = 390;
export const H = 844;
export const DURATION = 9.45;
/* The frame the login screen shows: the close-up, settled and lifted. */
export const REST_T = 7.3;
const HORIZON = 470;

/* ── easing / helpers ── */
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const inOut = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const outCubic = (k: number) => 1 - Math.pow(1 - k, 3);
const f = (n: number) => Math.round(n * 100) / 100;
const g = (p: Record<string, string | number>, c: Node[]): Node => ({ t: 'g', p, c });
const path = (d: string, p: Record<string, string | number> = {}): Node => ({ t: 'path', p: { d, ...p } });

/* ── static definitions (gradients) ── */
export const DEFS: Node[] = [
  { t: 'linearGradient', p: { id: 'sky', x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#F7D9CC' } },
    { t: 'stop', p: { offset: '0.55', stopColor: '#F4BFA4' } },
    { t: 'stop', p: { offset: '1', stopColor: '#F0A383' } },
  ] },
  { t: 'radialGradient', p: { id: 'sun', cx: '0.5', cy: '0.5', r: '0.5' }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#FFF3D6' } },
    { t: 'stop', p: { offset: '0.7', stopColor: '#FFD592' } },
    { t: 'stop', p: { offset: '1', stopColor: '#F8B774' } },
  ] },
  { t: 'radialGradient', p: { id: 'glow', cx: '0.5', cy: '0.5', r: '0.5' }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#FFE2B0', stopOpacity: '0.85' } },
    { t: 'stop', p: { offset: '1', stopColor: '#FFE2B0', stopOpacity: '0' } },
  ] },
  { t: 'linearGradient', p: { id: 'sea', x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#E1A08E' } },
    { t: 'stop', p: { offset: '1', stopColor: '#B98A92' } },
  ] },
  { t: 'linearGradient', p: { id: 'sand', x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#E2B38F' } },
    { t: 'stop', p: { offset: '0.25', stopColor: '#F0CDAA' } },
    { t: 'stop', p: { offset: '1', stopColor: '#E8C29B' } },
  ] },
  { t: 'linearGradient', p: { id: 'gold', x1: 0, y1: 0, x2: 1, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#F6D38E' } },
    { t: 'stop', p: { offset: '0.45', stopColor: '#D9A24E' } },
    { t: 'stop', p: { offset: '1', stopColor: '#8E5B1E' } },
  ] },
  { t: 'linearGradient', p: { id: 'goldDark', x1: 0, y1: 0, x2: 1, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#D4A460' } },
    { t: 'stop', p: { offset: '1', stopColor: '#6E4515' } },
  ] },
  { t: 'radialGradient', p: { id: 'shadow', cx: '0.5', cy: '0.5', r: '0.5' }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#6B3F22', stopOpacity: '0.45' } },
    { t: 'stop', p: { offset: '1', stopColor: '#6B3F22', stopOpacity: '0' } },
  ] },
  { t: 'linearGradient', p: { id: 'fade', x1: 0, y1: 0, x2: 0, y2: 1 }, c: [
    { t: 'stop', p: { offset: '0', stopColor: '#F7D9CC', stopOpacity: '0' } },
    { t: 'stop', p: { offset: '1', stopColor: '#F2E6DA', stopOpacity: '1' } },
  ] },
];

/* ── scenery ── */
function sky(t: number): Node[] {
  const birds = [0, 1, 2].map((i) => {
    const x = f(40 + i * 26 + t * (10 + i * 2));
    const y = f(210 + i * 14 + Math.sin(t * 2 + i) * 4);
    const w = 6 + Math.sin(t * 7 + i * 2) * 2;            // wing beat
    return path(`M${x - 7} ${y - w * 0.4} Q${x - 3} ${y - w} ${x} ${y} Q${x + 3} ${y - w} ${x + 7} ${y - w * 0.4}`,
      { stroke: '#8A5A55', strokeWidth: 1.4, fill: 'none', strokeLinecap: 'round', opacity: 0.55 });
  });
  return [
    { t: 'rect', p: { x: -1200, y: -1200, width: W + 2400, height: HORIZON + 1200, fill: 'url(#sky)' } },
    { t: 'circle', p: { cx: 262, cy: HORIZON - 18, r: 150, fill: 'url(#glow)' } },
    { t: 'circle', p: { cx: 262, cy: HORIZON - 18, r: 62, fill: 'url(#sun)' } },
    ...[[60, 150, 70, 12], [120, 162, 48, 9], [300, 118, 80, 13], [350, 132, 44, 8], [210, 300, 60, 8]].map(([x, y, rx, ry], i) =>
      ({ t: 'ellipse', p: { cx: f(x + t * (3 + i)), cy: y, rx, ry, fill: '#FFF4EC', opacity: 0.45 } })),
    ...birds,
  ];
}

function sea(t: number): Node[] {
  const glints: Node[] = [];
  for (let i = 0; i < 9; i++) {
    const y = HORIZON + 8 + i * 9;
    const w = 44 - i * 2.5 + Math.sin(t * 3 + i) * 6;
    glints.push({ t: 'rect', p: {
      x: f(262 - w / 2 + Math.sin(t * 1.7 + i * 1.3) * 5), y, width: f(w), height: 2.2, rx: 1.1,
      fill: '#FFE9C2', opacity: f(0.35 + 0.35 * Math.sin(t * 4 + i * 1.9) ** 2),
    } });
  }
  return [
    { t: 'rect', p: { x: -1200, y: HORIZON, width: W + 2400, height: 110, fill: 'url(#sea)' } },
    ...glints,
  ];
}

function shore(t: number): Node[] {
  /* Surf line slides up and back on a slow cycle. */
  const k = 0.5 - 0.5 * Math.cos(t * 1.25);
  const y = f(560 + k * 22);
  const wave = (yy: number, amp: number, off: number) => {
    let d = `M-1200 ${yy}`;
    for (let x = -1200; x <= W + 1200; x += 40) {
      d += ` Q${x + 20} ${f(yy + amp * Math.sin((x + off) / 30))} ${x + 40} ${yy}`;
    }
    return d;
  };
  return [
    { t: 'rect', p: { x: -1200, y: 560, width: W + 2400, height: H - 560 + 400, fill: 'url(#sand)' } },
    path(`${wave(y, 3, t * 40)} L${W + 1200} 540 L-1200 540 Z`, { fill: '#C9A0A0', opacity: 0.55 }),
    path(wave(y, 3, t * 40), { stroke: '#FFFFFF', strokeWidth: 3, fill: 'none', opacity: 0.85 }),
    path(wave(y - 9, 2, t * 55 + 17), { stroke: '#FFFFFF', strokeWidth: 1.5, fill: 'none', opacity: 0.5 }),
  ];
}

function palm(t: number): Node {
  const sway = f(Math.sin(t * 0.9) * 2.2);
  const frond = (a: number, len: number) =>
    g({ transform: `rotate(${a})` }, [
      path(`M0 0 Q${len * 0.45} ${-len * 0.28} ${len} ${len * 0.12} Q${len * 0.5} ${-len * 0.08} 0 0 Z`, { fill: '#5E3F3A' }),
    ]);
  return g({ transform: `translate(-6 746) rotate(${sway})`, opacity: 0.92 }, [
    path('M0 0 C6 -80 -4 -170 22 -260 L30 -258 C8 -170 18 -80 12 0 Z', { fill: '#5E3F3A' }),
    g({ transform: 'translate(26 -262)' }, [
      frond(-160, 96), frond(-120, 104), frond(-70, 110), frond(-25, 112), frond(15, 100), frond(160, 70),
    ]),
  ]);
}

/* ── the close-up ── */
function stiletto(x: number, y: number, s: number, fill: string, shine: number): Node {
  // Side view, toe to the right; ground is y=150 for both the spike and the toe.
  return g({ transform: `translate(${x} ${y}) scale(${s})` }, [
    path('M26 62 L48 64 L38 150 L34 150 Z', { fill }),                                   // stiletto spike
    path('M22 18 C18 34 20 52 26 64 L48 66 C70 76 96 116 132 138 C150 146 180 150 196 149 ' +
         'C210 148 212 138 202 132 C188 126 166 124 150 120 C124 112 104 92 88 72 ' +
         'C72 56 46 28 22 18 Z', { fill }),                                               // shoe
    path('M26 24 C44 34 64 52 82 70 C62 62 42 46 28 36 Z', { fill: '#9B2F37', opacity: 0.92 }),   // lining
    path('M52 70 C74 84 98 118 134 138', { stroke: '#FFF6E0', strokeWidth: 3.5, fill: 'none', strokeLinecap: 'round', opacity: shine }),
    path('M156 126 C174 130 192 132 200 136', { stroke: '#FFF6E0', strokeWidth: 2.5, fill: 'none', strokeLinecap: 'round', opacity: shine * 0.8 }),
  ]);
}

function sparkle(cx: number, cy: number, r: number, o: number): Node {
  return path(`M${cx} ${cy - r} Q${cx + r * 0.18} ${cy - r * 0.18} ${cx + r} ${cy} Q${cx + r * 0.18} ${cy + r * 0.18} ${cx} ${cy + r} ` +
              `Q${cx - r * 0.18} ${cy + r * 0.18} ${cx - r} ${cy} Q${cx - r * 0.18} ${cy - r * 0.18} ${cx} ${cy - r} Z`,
    { fill: '#FFFFFF', opacity: f(o) });
}

export function closeUp(tIn: number, lift = 0): Node[] {
  /* Motion settles at REST_T and holds, so the film's last frame and the
     login screen (closeUp(REST_T, 1)) are the same picture. */
  const t = Math.min(tIn, REST_T);
  const L = inOut(clamp(lift));
  const k = seg(t, 5.65, 6.8);
  const push = f(lerp(1.08, 1, outCubic(k)));                // slow settle
  const shine = f(0.35 + 0.5 * Math.max(0, Math.sin((t - 5.8) * 2.2)));
  const wave = 0.5 - 0.5 * Math.cos((t - 5.4) * 1.4);
  const foamY = f(430 + wave * 30);
  /* lift: the whole close-up rises to clear the bottom half for the login
     card, and the shoes shrink a touch. */
  const rise = f(-L * H * 0.33);
  const shrink = f(1 - L * 0.2);
  return [
    { t: 'rect', p: { x: -1200, y: -1200, width: W + 2400, height: H + 2400, fill: 'url(#sand)' } },
    g({ transform: `translate(0 ${rise})` }, [
    { t: 'circle', p: { cx: W * 0.7, cy: 120, r: 380, fill: 'url(#glow)', opacity: 0.7 } },
    // wet sand and foam creeping in from the top
    path(`M-1200 -400 L${W + 1200} -400 L${W + 1200} ${foamY - 30} Q${W * 0.6} ${foamY + 14} ${W * 0.3} ${foamY - 10} T-1200 ${foamY} Z`,
      { fill: '#C79B8E', opacity: 0.35 }),
    path(`M${W + 1200} ${foamY - 30} Q${W * 0.6} ${foamY + 14} ${W * 0.3} ${foamY - 10} T-1200 ${foamY}`,
      { stroke: '#FFFFFF', strokeWidth: 5, fill: 'none', opacity: 0.8 }),
    // sand grain speckle
    ...[...Array(26)].map((_, i) => ({ t: 'circle', p: {
      cx: (i * 71) % W, cy: 470 + ((i * 137) % 360), r: 1 + (i % 3) * 0.5, fill: '#B98A66', opacity: 0.35,
    } })),
    g({ transform: `translate(${W / 2} ${H * 0.52}) scale(${f(push * shrink)}) translate(${-W / 2} ${-H * 0.52})` }, [
      { t: 'ellipse', p: { cx: 200, cy: 612, rx: 175, ry: 16, fill: 'url(#shadow)' } },
      stiletto(92, 432, 1.18, 'url(#goldDark)', shine * 0.6),
      stiletto(36, 416, 1.3, 'url(#gold)', shine),
      sparkle(272, 560, 10 + 4 * Math.sin(t * 5), 0.9 * seg(t, 6.0, 6.3)),
      sparkle(96, 470, 7 + 3 * Math.sin(t * 6 + 1), 0.8 * seg(t, 6.2, 6.5)),
      sparkle(310, 470, 5 + 2 * Math.sin(t * 7 + 2), 0.7 * seg(t, 6.4, 6.7)),
    ]),
    ]),
  ];
}

/* ── camera + composition ── */
export function scene(t: number): Node[] {
  const zoom = inOut(seg(t, 5.25, 6.45));
  const s = lerp(1, 4.6, zoom);
  const [feetX, feetY] = FEET;
  const fx = lerp(W / 2, feetX, zoom);
  const fy = lerp(H / 2, feetY - 4, zoom);
  const cx = W / 2, cy = lerp(H / 2, H * 0.56, zoom);
  const wide = g(
    { transform: `translate(${f(cx)} ${f(cy)}) scale(${f(s)}) translate(${f(-fx)} ${f(-fy)})` },
    [...sky(t), ...sea(t), ...shore(t), palm(t), ...footprintsFront(t), ...walkerFront(t)],
  );
  const tc = t - SHIFT;                                  // close-up clock
  const cross = seg(tc, 5.65, 6.05);
  const out: Node[] = [];
  if (cross < 1) out.push(wide);
  if (cross > 0) out.push(g({ opacity: f(cross) }, closeUp(tc, seg(tc, 7.55, 8.45))));
  const flash = Math.max(0, 1 - Math.abs(tc - 5.85) / 0.35);
  if (flash > 0) out.push({ t: 'rect', p: { x: -1200, y: -1200, width: W + 2400, height: H + 2400, fill: '#FFF3E6', opacity: f(0.85 * flash) } });
  if (cross < 1) out.push({ t: 'rect', p: { x: -1200, y: H * 0.72, width: W + 2400, height: H * 0.28 + 400, fill: 'url(#fade)', opacity: f(0.35 * (1 - cross)) } });
  return out;
}
const FEET = feetFocus();

/* Overlay timings the app uses for text and the final fade. */
export const titleOpacity = (t: number) => seg(t - SHIFT, 6.1, 6.8) * (1 - seg(t - SHIFT, 7.45, 7.9));
export const titleRise = (t: number) => (1 - outCubic(seg(t - SHIFT, 6.1, 7.0))) - seg(t - SHIFT, 7.45, 7.9) * 0.8;
/* The login screen underneath shows the same frame, so this fade is invisible
   except for the card arriving. */
export const filmOpacity = (t: number) => 1 - seg(t - SHIFT, 8.45, 8.9);
/* When the app should start bringing in the login card. */
export const CARD_CUE = 8.35 + SHIFT;
