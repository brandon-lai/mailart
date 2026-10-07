/**
 * Writes per-glyph advance widths for every envelope font, so the compositor
 * can size and protect the address block without a browser (it is a pure
 * function and must run identically in Node and in the page).
 */
import opentype from "opentype.js";
import { writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const FONTS = ["homemade-apple", "nothing-you-could-do", "la-belle-aurore", "reenie-beanie", "special-elite", "im-fell-sc", "im-fell"];
const out: Record<string, { em: number; avg: number; adv: Record<string, number> }> = {};
for (const name of FONTS) {
  const font = opentype.loadSync(path.join(ROOT, "apps/web/public/fonts", name, `${name}.ttf`));
  const adv: Record<string, number> = {};
  let sum = 0, n = 0;
  for (let c = 32; c < 127; c++) {
    const ch = String.fromCharCode(c);
    const w = font.charToGlyph(ch).advanceWidth ?? 0;
    adv[ch] = Math.round((w / font.unitsPerEm) * 1000) / 1000;
    if (c > 32) { sum += adv[ch]; n++; }
  }
  out[name] = { em: 1, avg: Math.round((sum / n) * 1000) / 1000, adv };
}
writeFileSync(path.join(ROOT, "packages/envelope/src/data/font-metrics.json"), JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.avg])));
