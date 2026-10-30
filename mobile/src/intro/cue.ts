/* One-shot signal from the intro film to the screen underneath it: "bring
   your content in now". Lets the login card rise exactly as the film hands
   over, instead of having already animated in, hidden, behind it. */
import { useEffect, useState } from 'react';

let ready = true;                        // true when no film is playing
const subs = new Set<() => void>();

export function introStarted() { ready = false; }
export function introCue() {
  if (ready) return;
  ready = true;
  subs.forEach((f) => f());
}
export function useIntroCue() {
  const [r, setR] = useState(ready);
  useEffect(() => {
    if (ready) { setR(true); return; }
    const f = () => setR(true);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return r;
}
