import { Rng } from "../prng";
import metrics from "../data/font-metrics.json";
import { type Ctx, esc, n } from "../svg";

export const HAND_FONTS = ["homemade-apple", "nothing-you-could-do", "la-belle-aurore", "reenie-beanie"] as const;
export const TYPE_FONT = "special-elite";
export type AddressFont = (typeof HAND_FONTS)[number] | typeof TYPE_FONT;

export const FONT_FAMILY: Record<string, string> = {
  "homemade-apple": "'MA Homemade Apple', cursive",
  "nothing-you-could-do": "'MA Nothing You Could Do', cursive",
  "la-belle-aurore": "'MA La Belle Aurore', cursive",
  "reenie-beanie": "'MA Reenie Beanie', cursive",
  "special-elite": "'MA Special Elite', monospace",
  "im-fell-sc": "'MA IM Fell SC', serif",
  "im-fell": "'MA IM Fell', serif",
};

/** Optical size: these faces have wildly different x-heights at the same font-size. */
const SIZE_FACTOR: Record<AddressFont, number> = {
  "homemade-apple": 0.78,
  "nothing-you-could-do": 1,
  "la-belle-aurore": 1.05,
  "reenie-beanie": 1.35,
  "special-elite": 0.82,
};

export const INKS = { blueBlack: "#1d2742", sepia: "#5a3a1c" } as const;

type Metrics = Record<string, { avg: number; adv: Record<string, number> }>;

/** Width of a string in px at the given font-size, from the font's own advance table. */
export function textWidth(font: string, text: string, size: number): number {
  const m = (metrics as Metrics)[font];
  let w = 0;
  for (const ch of text) w += m.adv[ch] ?? m.avg;
  return w * size;
}

export type AddressProps = {
  seed: number;
  font: AddressFont;
  ink: keyof typeof INKS;
  lines: { text: string; size: number; dx: number; dy: number; rotate: number }[];
  slip: boolean; // typed on a pasted paper slip
};

/**
 * Lay out the address and return its props plus the box it occupies. The box
 * is computed from glyph advances so the protection rule checks real extents.
 */
export function layoutAddress(
  rng: Rng,
  name: string,
  line: string | undefined,
  maxW: number,
  baseSize: number,
): { props: AddressProps; w: number; h: number } {
  const typed = rng.chance(0.2);
  const font: AddressFont = typed ? TYPE_FONT : rng.pick(HAND_FONTS);
  const factor = SIZE_FACTOR[font];
  const texts = [name, ...(line ? [line] : [])];
  const pad = typed ? 18 : 6;
  const lines: AddressProps["lines"] = [];
  let y = 0;
  let maxLineW = 0;
  texts.forEach((text, i) => {
    let size = baseSize * factor * (i === 0 ? 1 : 0.68);
    const w0 = textWidth(font, text, size);
    if (w0 > maxW - pad * 2) size *= (maxW - pad * 2) / w0;
    const lineH = size * (font === "homemade-apple" ? 1.5 : 1.25);
    y += lineH;
    const dx = i === 0 ? 0 : rng.range(10, 36) * (typed ? 0 : 1); // handwriting drifts right
    const w = textWidth(font, text, size) + dx;
    maxLineW = Math.max(maxLineW, w);
    lines.push({ text, size, dx, dy: y + rng.range(-3, 3), rotate: rng.range(-2, 2) });
  });
  const props: AddressProps = { seed: rng.seed(), font, ink: rng.pick(["blueBlack", "blueBlack", "sepia"] as const), lines, slip: typed && rng.chance(0.6) };
  // Descenders and rotation need a little room.
  return { props, w: maxLineW + pad * 2, h: y + pad * 2 + baseSize * 0.35 };
}

export function drawAddress(p: AddressProps, ctx: Ctx, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const typed = p.font === TYPE_FONT;
  const pad = typed ? 18 : 6;
  const ink = INKS[p.ink];
  const parts: string[] = [];
  if (p.slip) {
    parts.push(
      `<rect x="0" y="0" width="${n(w)}" height="${n(h)}" fill="#fbf8f0" stroke="#d9cfb8" stroke-width="0.8" filter="url(#${ctx.uid}-shadow)"/>`,
    );
  }
  for (const l of p.lines) {
    const x = pad + l.dx;
    const y = pad + l.dy;
    parts.push(
      `<text x="${n(x)}" y="${n(y)}" transform="rotate(${n(l.rotate)} ${n(x)} ${n(y)})" font-family="${FONT_FAMILY[p.font]}" font-size="${n(l.size)}" fill="${ink}" opacity="${n(typed ? rng.range(0.82, 0.9) : rng.range(0.9, 0.97))}">${esc(l.text)}</text>`,
    );
  }
  return parts.join("");
}
