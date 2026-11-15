// Compare two boxes.json files: per view, elements present in both whose box moved or resized by more than the tolerance.
// Usage: node compare.mjs <before boxes.json> <after boxes.json> [tolerance px=2]
import {readFileSync} from 'node:fs';
const [a, b, tol = '2'] = process.argv.slice(2);
const before = JSON.parse(readFileSync(a)), after = JSON.parse(readFileSync(b)), t = Number(tol);
let total = 0;
for (const view of Object.keys(before)) {
  const x = before[view], y = after[view] || {};
  const moved = [], onlyBefore = Object.keys(x).filter(k => !(k in y)).length, onlyAfter = Object.keys(y).filter(k => !(k in x)).length;
  for (const k of Object.keys(x)) if (k in y) {
    const d = Math.max(...x[k].map((v, i) => Math.abs(v - y[k][i])));
    if (d > t) moved.push([d, k, x[k], y[k]]);
  }
  moved.sort((p, q) => q[0] - p[0]);
  total += moved.length;
  console.log(`${view}: ${Object.keys(x).length} elements, moved>${t}px ${moved.length}, only before ${onlyBefore}, only after ${onlyAfter}`);
  for (const [d, k, p, q] of moved.slice(0, 4)) console.log(`    ${d}px ${k.split('>').slice(-3).join('>')} ${JSON.stringify(p)} -> ${JSON.stringify(q)}`);
}
console.log(`total moved: ${total}`);
