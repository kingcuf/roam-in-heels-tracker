/* Renders scene.ts node trees with react-native-svg.

   Every drawing gets its own gradient ids. The film, the login backdrop and
   the (hidden) dashboard card are on the page together, and on the web
   `url(#gold)` resolves to the FIRST element with that id in the document —
   when that one sits inside a display:none tab, Chrome paints nothing, which
   blanked the sky, sea and the gold heels. */
import React, { useRef } from 'react';
import { Circle, Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { DEFS, Node } from './scene';

const COMP: Record<string, any> = {
  g: G, path: Path, rect: Rect, circle: Circle, ellipse: Ellipse,
  linearGradient: LinearGradient, radialGradient: RadialGradient, stop: Stop,
};

let seq = 0;
export function useSvgPrefix() {
  const r = useRef('');
  if (!r.current) r.current = `ih${++seq}_`;
  return r.current;
}

const URL_RE = /^url\(#(.+)\)$/;
function withPrefix(p: Record<string, any> | undefined, px: string) {
  if (!p) return p;
  const out: Record<string, any> = { ...p };
  if (out.id) out.id = px + out.id;
  for (const k of ['fill', 'stroke']) {
    const m = typeof out[k] === 'string' ? URL_RE.exec(out[k]) : null;
    if (m) out[k] = `url(#${px}${m[1]})`;
  }
  return out;
}

export function drawNodes(nodes: Node[], px: string): React.ReactNode[] {
  return nodes.map((n, i) => {
    const Cmp = COMP[n.t];
    if (!Cmp) return null;
    return <Cmp key={i} {...withPrefix(n.p, px)}>{n.c ? drawNodes(n.c, px) : null}</Cmp>;
  });
}

export function SceneDefs({ px }: { px: string }) {
  return <Defs>{drawNodes(DEFS, px)}</Defs>;
}
