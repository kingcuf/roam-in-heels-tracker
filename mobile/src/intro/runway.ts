/* The walker for the intro film — a front-facing runway walk toward the
   camera along the shoreline, in real perspective.

   Reference: a supermodel catwalk ("horse walk"): each foot lands on or
   across the centre line, the hips swing and pop over the standing leg, the
   shoulders counter-tilt, the head stays level with the chin up, and the arms
   swing loosely. At the end of the walk she stops, flips her hair with one
   hand, and settles with the other hand on her hip.

   Everything is computed in a small 3D world (y up, z toward the camera) and
   projected, so the planted foot stays on the sand while she grows nearer.
   Pure functions of time; no React. */
import type { Node } from './scene';

type P2 = [number, number];
type P3 = [number, number, number];

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const ease = (k: number) => k * k * (3 - 2 * k);
const f = (n: number) => Math.round(n * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;

/* ── camera + stage ── */
const HORIZON = 470;
const CX = 195;                 // screen centre x
const FOCAL = 300;
const CAM_H = 150;              // eye height, world units (she is ~190 tall)
const D0 = 500, D1 = 184;       // distance from camera: start → where she stops
export const WALK_END = 4.2;
export const FLIP_A = 4.35, FLIP_B = 5.2;
const X0 = -34, X1 = 6;         // she drifts slightly across the frame

/* ── body proportions (world units) ── */
const THIGH = 44, SHIN = 42;
const HEEL = 9;                 // stiletto height: ankle above the sand when standing
const HIP_H = HEEL + THIGH + SHIN;
const HIP_W = 8.5;
const STRIDE = 54;              // world units per step
const INK = '#2B1A22';
const INK2 = '#3A2530';
const DRESS = '#1E1218';

/* Gait curves for one leg, u ∈ [0,1): 0 heel strike (leg forward) · 0.5 toe-off
   (leg behind) · 0.75 knee high as it passes. Keys are [u, value]. */
const THETA: P2[] = [[0, 21], [0.25, 4], [0.5, -15], [0.62, -7], [0.78, 17], [0.9, 25], [1, 21]];
const KNEE: P2[] = [[0, 0], [0.2, 3], [0.42, 2], [0.52, 12], [0.62, 30], [0.74, 36], [0.86, 16], [0.96, 2], [1, 0]];
const POINT: P2[] = [[0, 0], [0.45, 4], [0.58, 22], [0.72, 30], [0.88, 12], [1, 0]];
function curve(keys: P2[], u: number) {
  u = ((u % 1) + 1) % 1;
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [u0, v0] = keys[i - 1], [u1, v1] = keys[i];
      return lerp(v0, v1, ease((u - u0) / (u1 - u0 || 1)));
    }
  }
  return keys[keys.length - 1][1];
}

/* Distance walked: cruise, then brake over the last second. */
function walked(t: number) {
  const B = 3.1, E = WALK_END;
  const total = B + (E - B) / 2;
  const d = t <= B ? t : t >= E ? total : B + (t - B) - ((t - B) ** 2) / (2 * (E - B));
  return clamp(d / total);
}
const phase = (t: number) => (walked(t) * (D0 - D1)) / (2 * STRIDE);   // cycles

/* A leg's vertical reach (hip to ankle) for its current angles. */
const reach = (L: { theta: number; knee: number }) =>
  THIGH * Math.cos(rad(L.theta)) + SHIN * Math.cos(rad(L.theta - L.knee));
/* The body rides on whichever leg reaches lower — that foot is on the sand. */
const supportLeg = (p: { legs: { theta: number; knee: number }[] }) => (reach(p.legs[0]) >= reach(p.legs[1]) ? 0 : 1);

/* Heel strikes = the moments the supporting leg changes, i.e. when a foot
   actually lands in the animation. The click sounds are scheduled from these,
   so picture and sound can't drift apart. */
export const STRIKES: number[] = (() => {
  const out: number[] = [];
  let prev = supportLeg(pose(0));
  for (let t = 0.004; t <= WALK_END + 0.4; t += 0.004) {
    const cur = supportLeg(pose(t));
    if (cur !== prev && (!out.length || t - out[out.length - 1] > 0.2)) out.push(Math.round(t * 1000) / 1000);
    prev = cur;
  }
  // the settling tap as she plants the crossed foot, unless a strike is already there
  if (!out.length || Math.abs(out[out.length - 1] - 4.3) > 0.25) out.push(4.3);
  return out;
})();

/* ── pose ── */
type Pose = {
  D: number; X: number; bob: number;
  pelvisTilt: number; pelvisShift: number; torsoTilt: number; headTilt: number;
  legs: { theta: number; knee: number; point: number; footX: number; }[];   // [left, right] (screen-left first)
  armL: { swing: number; out: number; elbow: number; hip: number };
  armR: { swing: number; out: number; elbow: number; hip: number; flip: number };
  hair: number; hairFlip: number;
};

function pose(t: number): Pose {
  const w = walked(t);
  const moving = 1 - seg(t, 3.5, WALK_END);
  const ph = phase(t);
  const stand = 1 - moving;

  const legs = [0, 0.5].map((off, i) => {
    const u = ph + off;
    // catwalk: each foot lands across the centre line
    const land = i === 0 ? 2.5 : -2.5;
    const inSwing = ((u % 1) + 1) % 1 > 0.5;
    const footX = inSwing ? lerp(-land * 0.3, land, ease(((((u % 1) + 1) % 1) - 0.5) * 2)) : land;
    // standing pose: left leg is the weight leg, right crosses in front, knee soft
    const sTheta = i === 0 ? 0 : 7, sKnee = i === 0 ? 0 : 14, sPoint = i === 0 ? 0 : 10, sX = i === 0 ? 3.5 : -4.5;
    return {
      theta: lerp(curve(THETA, u), sTheta, stand),
      knee: lerp(curve(KNEE, u), sKnee, stand),
      point: lerp(curve(POINT, u), sPoint, stand),
      footX: lerp(footX, sX, stand),
    };
  });

  // which leg carries the weight: the one closer to straight-down
  const s = Math.sin(ph * 2 * Math.PI);      // + when the left leg is in stance
  const flipK = seg(t, FLIP_A, FLIP_B);
  const flipArc = Math.sin(flipK * Math.PI);  // 0 → 1 → 0
  const hipK = ease(seg(t, FLIP_B - 0.25, FLIP_B + 0.35));

  return {
    D: lerp(D0, D1, w),
    X: lerp(X0, X1, w),
    bob: 0,   // the body now rides on the supporting leg — see walkerFront
    pelvisTilt: lerp(7 * s, 8, stand),          // hip hikes over the stance leg; pops in the pose
    pelvisShift: lerp(4.5 * s, 4, stand),
    torsoTilt: lerp(-3 * s, -3.5, stand) + flipArc * -6,
    headTilt: lerp(0, 4, stand) + flipArc * 10 - flipK * 2,
    legs,
    armL: {
      swing: lerp(-13 * Math.sin(ph * 2 * Math.PI + Math.PI), 0, stand),
      out: lerp(6, 48, hipK),
      elbow: lerp(12, 118, hipK),
      hip: hipK,
    },
    armR: {
      swing: lerp(-13 * Math.sin(ph * 2 * Math.PI), 0, stand),
      out: lerp(6, 8, stand),
      elbow: 14,
      hip: 0,
      flip: flipK,
    },
    hair: 5 * Math.sin(ph * 2 * Math.PI - 0.8) * moving,
    hairFlip: flipK,
  };
}

/* ── projection ── */
function projector(p: Pose) {
  const P = (x: number, y: number, z: number): P2 => {
    const d = p.D - z;
    return [CX + ((p.X + x) * FOCAL) / d, HORIZON + ((CAM_H - y) * FOCAL) / d];
  };
  return { P, k: FOCAL / p.D };
}

const rot = (x: number, y: number, deg: number): P2 => {
  const a = rad(deg), c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

/* Tapered tube through screen points with half-widths, smoothed. */
function tube(pts: P2[], hw: number[]): string {
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
    L.push([pts[i][0] - dy * hw[i], pts[i][1] + dx * hw[i]]);
    R.push([pts[i][0] + dy * hw[i], pts[i][1] - dx * hw[i]]);
  }
  return smooth([...L, ...R.reverse()]);
}
/* Closed, smoothed outline through points (quadratic through midpoints). */
function smooth(ps: P2[]): string {
  const m = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = ps.length;
  let d = `M${f(m(ps[n - 1], ps[0])[0])} ${f(m(ps[n - 1], ps[0])[1])}`;
  for (let i = 0; i < n; i++) {
    const q = m(ps[i], ps[(i + 1) % n]);
    d += ` Q${f(ps[i][0])} ${f(ps[i][1])} ${f(q[0])} ${f(q[1])}`;
  }
  return d + ' Z';
}
const path = (d: string, p: Record<string, string | number>): Node => ({ t: 'path', p: { d, ...p } });
const RIM = { stroke: 'rgba(255,196,140,0.45)', strokeWidth: 0.7 };

/* ── the figure ── */
export function walkerFront(t: number): Node[] {
  const p = pose(t);
  const { P, k } = projector(p);
  /* Hip height follows the supporting leg, so the planted foot is exactly on
     the sand at every heel strike (a fixed height left it hovering). */
  const hipY = HEEL + Math.max(reach(p.legs[0]), reach(p.legs[1]));
  const out: Node[] = [];

  // local (body) → world helpers
  const pel = (x: number, y: number): P3 => {
    const [rx, ry] = rot(x, y, -p.pelvisTilt);
    return [rx + p.pelvisShift, hipY + ry, 0];
  };
  const tor = (x: number, y: number): P3 => {          // y measured up from the waist
    const w = pel(0, 16);
    const [rx, ry] = rot(x, y, -p.torsoTilt);
    return [w[0] + rx, w[1] + ry, 0];
  };
  const Pw = (q: P3) => P(q[0], q[1], q[2]);

  /* shadow on the sand */
  const g0 = P(p.pelvisShift, 0, 0);
  out.push({ t: 'ellipse', p: { cx: f(g0[0]), cy: f(g0[1] + 1), rx: f(24 * k), ry: f(4 * k), fill: 'url(#shadow)' } });

  /* legs — the one further forward is drawn last */
  const legNodes = p.legs.map((L, i) => {
    const side = i === 0 ? -1 : 1;
    const hip = pel(side * HIP_W, 0);
    const th = rad(L.theta), kn = rad(L.theta - L.knee);
    const ankleX = L.footX + p.pelvisShift * 0.4;
    const knee: P3 = [lerp(hip[0], ankleX, 0.45) + side * 0.8, hip[1] - THIGH * Math.cos(th), THIGH * Math.sin(th)];
    const ankle: P3 = [ankleX, knee[1] - SHIN * Math.cos(kn), knee[2] + SHIN * Math.sin(kn)];
    // standing foot rests with the ankle at heel height
    const lift = Math.max(0, ankle[1] - HEEL);
    const pt = rad(L.point);
    const toe: P3 = [ankle[0] - side * 0.6, ankle[1] - HEEL * Math.cos(pt) - 0.5, ankle[2] + 12 * Math.cos(pt)];
    const heelTip: P3 = [ankle[0] + side * 0.3, ankle[1] - HEEL, ankle[2] - 3];
    const calf: P3 = [lerp(knee[0], ankle[0], 0.35), lerp(knee[1], ankle[1], 0.35), lerp(knee[2], ankle[2], 0.35)];
    const midThigh: P3 = [lerp(hip[0], knee[0], 0.5), lerp(hip[1], knee[1], 0.5), lerp(hip[2], knee[2], 0.5)];
    const pts = [hip, midThigh, knee, calf, ankle].map(Pw);
    const hw = [8.2, 6.6, 3.9, 4.6, 2.2].map((v) => v * k * (FOCAL / (FOCAL - 0)) / (FOCAL / p.D) * (FOCAL / p.D));
    const A = Pw(ankle), T = Pw(toe), H = Pw(heelTip);
    const sw = 3.0 * k;
    const nodes: Node[] = [
      path(tube(pts, hw), { fill: i === 0 ? INK : INK2, ...RIM }),
      // stiletto heel, seen just outside the foot
      path(`M${f(A[0] + side * sw * 0.55)} ${f(A[1] - 0.5 * k)} L${f(H[0] + side * sw * 0.9)} ${f(H[1])} L${f(H[0] + side * sw * 0.55)} ${f(H[1])} Z`,
        { fill: 'url(#goldDark)' }),
      // pointed pump: open top at the ankle, vamp widening, sharp toe
      path(smooth([
        [A[0] - sw * 0.9, A[1] - 1.2 * k], [A[0] + sw * 0.9, A[1] - 1.2 * k],
        [A[0] + sw * 1.25, lerp(A[1], T[1], 0.45)], [T[0] + sw * 0.35, T[1] - 1.2 * k],
        [T[0], T[1] + 0.8 * k], [T[0] - sw * 0.35, T[1] - 1.2 * k], [A[0] - sw * 1.25, lerp(A[1], T[1], 0.45)],
      ]), { fill: 'url(#gold)' }),
      // instep skin showing through the low-cut vamp
      path(smooth([[A[0] - sw * 0.6, A[1] - 0.8 * k], [A[0] + sw * 0.6, A[1] - 0.8 * k], [A[0], lerp(A[1], T[1], 0.32)]]),
        { fill: i === 0 ? INK : INK2 }),
      // glint
      path(`M${f(A[0] - side * sw * 0.7)} ${f(lerp(A[1], T[1], 0.4))} L${f(T[0] - side * sw * 0.15)} ${f(T[1] - 1.6 * k)}`,
        { stroke: 'rgba(255,240,210,0.8)', strokeWidth: f(0.45 * k), fill: 'none', strokeLinecap: 'round' }),
    ];
    return { z: ankle[2] + knee[2], nodes, lift };
  });
  legNodes.sort((a, b) => a.z - b.z).forEach((l) => out.push(...l.nodes));

  /* hair — back mass, behind the body */
  const headC = tor(0, 64);
  const [hx, hy] = Pw(headC);
  const flip = p.hairFlip;
  const flipArc = Math.sin(flip * Math.PI);
  const sway = p.hair;
  const hairBack = [
    tor(-10, 72), tor(10, 72), tor(15 + sway * 0.3, 54), tor(17 + sway, 34 + flipArc * 20),
    tor(8 + sway, 30), tor(-8 + sway, 30), tor(-17 + sway - flipArc * 14, 34 + flipArc * 26), tor(-15 + sway * 0.3, 54),
  ].map(Pw);
  out.push(path(smooth(hairBack), { fill: '#1C1016' }));

  /* torso + dress */
  const bodyL = [
    tor(-7, 49), tor(-16, 46), tor(-15, 40), tor(-13, 30), tor(-10, 18), tor(-9, 6), tor(-10, 0),
  ];
  const hem = 20 + 2 * Math.sin(p.hair * 0.3);
  const hipsL = [pel(-15, 10), pel(-16.5, 0), pel(-16 - p.pelvisTilt * 0.15, -hem)];
  const hipsR = [pel(16 - p.pelvisTilt * 0.15, -hem), pel(16.5, 0), pel(15, 10)];
  const bodyR = [
    tor(10, 0), tor(9, 6), tor(10, 18), tor(13, 30), tor(15, 40), tor(16, 46), tor(7, 49),
  ];
  const neckTop = [tor(3.2, 58), tor(-3.2, 58)];
  // skin silhouette (shoulders/neck) under the dress
  out.push(path(smooth([...neckTop, tor(-4, 50), ...bodyL.slice(0, 3), ...bodyR.slice(-3), tor(4, 50)].map(Pw)), { fill: INK }));
  // dress: from the bust line to the hem
  const dress = [tor(-14, 38), tor(-13, 30), ...bodyL.slice(4), ...hipsL, ...hipsR, ...bodyR.slice(0, 3), tor(13, 30), tor(14, 38), tor(0, 36)];
  out.push(path(smooth(dress.map(Pw)), { fill: DRESS, stroke: 'rgba(255,196,140,0.28)', strokeWidth: 0.6 }));
  // straps
  for (const sx of [-1, 1]) {
    const a = Pw(tor(sx * 8, 38)), b = Pw(tor(sx * 11, 48));
    out.push({ t: 'path', p: { d: `M${f(a[0])} ${f(a[1])} L${f(b[0])} ${f(b[1])}`, stroke: DRESS, strokeWidth: f(0.9 * k) } });
  }

  /* arms */
  const arm = (side: -1 | 1, a: Pose['armL'] & { flip?: number }) => {
    const sh0 = tor(side * 14.5, 45);
    let elbow: P3, hand: P3;
    const fl = a.flip || 0;
    if (fl > 0 && fl < 1) {
      // hair flip: the hand rises past the temple, sweeps over the crown, and falls back
      const up = Math.sin(fl * Math.PI);
      const ang = lerp(20, 170, ease(Math.min(1, fl * 1.6))) - (fl > 0.62 ? (fl - 0.62) * 300 : 0);
      const [ex, ey] = rot(0, -24, -side * ang);
      elbow = [sh0[0] + ex * 1 + side * 6 * up, sh0[1] + ey, 6 * up];
      const [hx2, hy2] = rot(0, -22, -side * (ang + 40 * up));
      hand = [elbow[0] + hx2 - side * 8 * up, elbow[1] + hy2 + 4 * up, 8 * up];
    } else if (a.hip > 0) {
      // hand on hip, elbow out
      const [ex, ey] = rot(0, -24, side * a.out);
      elbow = [sh0[0] + ex, sh0[1] + ey, -2 * a.hip];
      const handHip = pel(side * 15, 8);
      const [nx, ny] = rot(0, -22, side * (a.out - a.elbow));
      const free: P3 = [elbow[0] + nx, elbow[1] + ny, 0];
      hand = [lerp(free[0], handHip[0], a.hip), lerp(free[1], handHip[1], a.hip), 0];
    } else {
      const sw = rad(a.swing);
      const [ex, ey] = rot(0, -24, side * a.out);
      elbow = [sh0[0] + ex, sh0[1] + ey * Math.cos(sw), -24 * Math.sin(sw)];
      const fa = sw + rad(a.elbow);
      const [hx2] = rot(0, -22, side * (a.out + 4));
      hand = [elbow[0] + hx2 * 0.35 + side * 0.5, elbow[1] - 22 * Math.cos(fa), elbow[2] - 22 * Math.sin(fa) + 4];
    }
    const onHip = a.hip > 0.5;
    const tipW: P3 = onHip ? [hand[0] - side * 5, hand[1] - 1, hand[2]] : [hand[0], hand[1] - 5, hand[2]];
    // straight segments either side of the elbow: two points per bone keep the
    // smoothing from bowing the arm into a curve
    const mid = (a0: P3, b0: P3, t0: number): P3 => [lerp(a0[0], b0[0], t0), lerp(a0[1], b0[1], t0), lerp(a0[2], b0[2], t0)];
    const pts = [sh0, mid(sh0, elbow, 0.8), elbow, mid(elbow, hand, 0.2), hand, tipW].map(Pw);
    return path(tube(pts, [4.6 * k, 3.6 * k, 3.1 * k, 2.9 * k, 2.2 * k, 1.4 * k]), { fill: INK, ...RIM });
  };
  out.push(arm(-1, p.armL));

  /* neck + head */
  out.push(path(tube([Pw(tor(0, 50)), Pw(tor(0, 60))], [3.4 * k, 3.1 * k]), { fill: INK }));
  const hr = 9.6 * k;
  const ht = p.headTilt;
  out.push({ t: 'g', p: { transform: `rotate(${f(-ht)} ${f(hx)} ${f(hy)})` }, c: [
    { t: 'ellipse', p: { cx: f(hx), cy: f(hy), rx: f(hr * 0.86), ry: f(hr * 1.2), fill: INK, ...RIM } },
    // jaw toward the chin — chin up, attitude
    path(`M${f(hx - hr * 0.8)} ${f(hy + hr * 0.2)} Q${f(hx)} ${f(hy + hr * 1.55)} ${f(hx + hr * 0.8)} ${f(hy + hr * 0.2)} Z`, { fill: INK }),
    // hairline / crown volume
    path(`M${f(hx - hr * 1.05)} ${f(hy + hr * 0.1)} Q${f(hx - hr * 1.1)} ${f(hy - hr * 1.45)} ${f(hx)} ${f(hy - hr * 1.35)} Q${f(hx + hr * 1.15)} ${f(hy - hr * 1.4)} ${f(hx + hr * 1.05)} ${f(hy + hr * 0.1)} Q${f(hx + hr * 0.7)} ${f(hy - hr * 0.8)} ${f(hx)} ${f(hy - hr * 0.95)} Q${f(hx - hr * 0.7)} ${f(hy - hr * 0.8)} ${f(hx - hr * 1.05)} ${f(hy + hr * 0.1)} Z`, { fill: '#1C1016' }),
  ] });

  /* front locks over the shoulders; the right one is thrown back in the flip */
  const lock = (side: -1 | 1, thrown: number) => {
    const s0 = tor(side * 8, 66), s1 = tor(side * (12 + sway * 0.2), 52);
    const endDown = tor(side * (13 + sway * 0.4), 34);
    const endUp = tor(side * 24, 78);
    const endBack = tor(-side * 4, 70);
    const e = thrown < 0.5 ? [lerp(endDown[0], endUp[0], thrown * 2), lerp(endDown[1], endUp[1], thrown * 2), 0] as P3
      : [lerp(endUp[0], endBack[0], (thrown - 0.5) * 2), lerp(endUp[1], endBack[1], (thrown - 0.5) * 2), 0] as P3;
    const vis = thrown >= 0.98 ? 0 : 1;
    return vis ? path(tube([s0, s1, e].map(Pw), [2.6 * k, 3.4 * k, 1.2 * k]), { fill: '#1C1016' }) : null;
  };
  const lockL = lock(-1, 0);
  const lockR = lock(1, flip);
  if (lockL) out.push(lockL);
  if (lockR) out.push(lockR);

  /* the flip's hair sweep — loose strands arcing over the head */
  if (flipArc > 0.02) {
    const base = tor(3, 70);
    for (let j = 0; j < 9; j++) {
      const lag = j * 0.025;
      const fj = clamp(flip - lag);
      const a = lerp(-30, 205, ease(fj));
      const r = 24 + j * 1.6;
      const pts: P2[] = [];
      for (let q = 0; q <= 4; q++) {
        const rr = (r * q) / 4;
        const bend = Math.sin((q / 4) * Math.PI) * (6 - j) * (flipArc > 0 ? 1 : 0);
        const [dx, dy] = rot(rr, bend, -(a - q * 6));
        pts.push(Pw([base[0] + dx, base[1] + dy, 4]));
      }
      out.push(path(tube(pts, [2.6 * k, 2.8 * k, 2.2 * k, 1.4 * k, 0.5 * k]), { fill: '#1C1016', opacity: f(clamp(flipArc * 1.4) * (0.95 - j * 0.06)) }));
    }
  }

  out.push(arm(1, p.armR));
  return out;
}

/* Footprints left in the wet sand, in perspective. */
export function footprintsFront(t: number): Node[] {
  const out: Node[] = [];
  STRIKES.slice(0, -1).forEach((st, i) => {
    if (st > t) return;
    const p = pose(st);
    const { P, k } = projector({ ...p, D: p.D - 12 });
    const [x, y] = P((i % 2 ? -2.5 : 2.5) + p.pelvisShift * 0.4, 0, 0);
    out.push({ t: 'ellipse', p: { cx: f(x), cy: f(y), rx: f(2.6 * k), ry: f(0.9 * k), fill: '#A87C5C', opacity: f(0.45 * (1 - seg(t - st, 1, 5))) } });
  });
  return out;
}

/* Where the camera pushes in at the end: her feet in the final pose. */
export function feetFocus(): P2 {
  const p = pose(FLIP_B + 1);
  const { P } = projector(p);
  return P(p.pelvisShift * 0.4, 2, 4);
}
