// Renders intro film frames to SVG files for review: node scripts/render-intro.mjs <outDir> t1 t2 ...
import { writeFileSync, mkdirSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Node's type stripping needs explicit extensions; the app's bundler does not.
// Copy the two scene modules to a temp dir with './runway' → './runway.ts'.
const tmp = mkdtempSync(join(tmpdir(), 'intro-'));
for (const n of ['scene', 'runway']) {
  const src = readFileSync(new URL(`../src/intro/${n}.ts`, import.meta.url), 'utf8')
    .replace(/from '\.\/(scene|runway)'/g, "from './$1.ts'");
  writeFileSync(join(tmp, `${n}.ts`), src);
}
const { scene, DEFS, W, H, STRIKES } = await import(join(tmp, 'scene.ts'));

const kebab = (k) => k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const tag = { linearGradient: 'linearGradient', radialGradient: 'radialGradient' };
const toSvg = (n) => {
  const attrs = Object.entries(n.p || {}).map(([k, v]) => `${kebab(k)}="${v}"`).join(' ');
  const name = tag[n.t] || n.t;
  return n.c ? `<${name} ${attrs}>${n.c.map(toSvg).join('')}</${name}>` : `<${name} ${attrs}/>`;
};
const [out, ...ts] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
for (const t of ts.map(Number)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>${DEFS.map(toSvg).join('')}</defs>${scene(t).map(toSvg).join('')}</svg>`;
  writeFileSync(`${out}/f_${t.toFixed(2)}.svg`, svg);
}
console.log('strikes', STRIKES.join(', '));
