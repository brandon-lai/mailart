import { Rng } from "../prng";
import { type Ctx, esc, n } from "../svg";

export const POSTMARK_INKS = { black: "#1f1d22", red: "#a8282c", violet: "#4b3888" } as const;
export type PostmarkInk = keyof typeof POSTMARK_INKS;

export type PostmarkProps = {
  seed: number;
  ink: PostmarkInk;
  city: string;
  date: string; // "7 OCT 2026"
  bars: number; // 5..7 wavy cancellation lines
  barsSide: "left" | "right";
  r: number; // ring radius
  pressure: number; // 0..1 ink coverage
};

export type LabelProps = {
  seed: number;
  type: "par-avion" | "special-delivery" | "printed-matter" | "registered" | "specimen";
  number?: string;
  text?: string;
};

/**
 * Filters that make ink look hand-struck: edges displaced by noise, and a
 * speckle mask that knocks holes out where the stamp did not touch the paper.
 */
export function inkFilter(ctx: Ctx, id: string, seed: number, pressure: number, scale = 2.6): string {
  // cov ≈ 0.6·speck + 0.75·blot, mean ≈ 0.68. Where it exceeds the threshold the
  // mask goes opaque and "out" knocks the ink away: light pressure, more gaps.
  ctx.defs.push(
    `<filter id="${id}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="${seed % 997}" result="warp"/>
<feDisplacementMap in="SourceGraphic" in2="warp" scale="${n(scale)}" xChannelSelector="R" yChannelSelector="G" result="rough"/>
<feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="${(seed >> 5) % 997}" result="speck"/>
<feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${(seed >> 9) % 997}" result="blot"/>
<feComposite in="speck" in2="blot" operator="arithmetic" k1="0" k2="0.6" k3="0.75" k4="0" result="cov"/>
<feColorMatrix in="cov" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 14 ${n(-14 * (0.8 + pressure * 0.1))}" result="mask"/>
<feComposite in="rough" in2="mask" operator="out"/>
</filter>`,
  );
  return id;
}

export function drawPostmark(p: PostmarkProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const ink = POSTMARK_INKS[p.ink];
  const f = inkFilter(ctx, `${id}-ink`, p.seed, p.pressure);
  const r = p.r;
  const cx = p.barsSide === "right" ? r + 2 : w - r - 2;
  const cy = h / 2;
  const arcR = r * 0.74;
  ctx.defs.push(
    `<path id="${id}-arc" d="M${n(cx - arcR)},${n(cy)} A${n(arcR)},${n(arcR)} 0 0 1 ${n(cx + arcR)},${n(cy)}"/>` +
      `<path id="${id}-arcb" d="M${n(cx - arcR * 1.08)},${n(cy)} A${n(arcR * 1.08)},${n(arcR * 1.08)} 0 0 0 ${n(cx + arcR * 1.08)},${n(cy)}"/>`,
  );
  const city = p.city.toUpperCase().slice(0, 22);
  const cityFs = Math.min(r * 0.3, (Math.PI * arcR * 1.45) / Math.max(6, city.length));
  const parts: string[] = [];
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="none" stroke="${ink}" stroke-width="${n(r * 0.05)}"/>`);
  parts.push(`<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.58)}" fill="none" stroke="${ink}" stroke-width="${n(r * 0.035)}"/>`);
  parts.push(
    `<text font-family="'MA IM Fell SC', serif" font-size="${n(cityFs)}" fill="${ink}" letter-spacing="1"><textPath href="#${id}-arc" startOffset="50%" text-anchor="middle">${esc(city)}</textPath></text>`,
  );
  const [day, mon, year] = p.date.split(" ");
  parts.push(
    `<text x="${n(cx)}" y="${n(cy - r * 0.08)}" font-family="'MA Special Elite', monospace" font-size="${n(r * 0.24)}" fill="${ink}" text-anchor="middle">${esc(`${day} ${mon}`)}</text>` +
      `<text x="${n(cx)}" y="${n(cy + r * 0.24)}" font-family="'MA Special Elite', monospace" font-size="${n(r * 0.24)}" fill="${ink}" text-anchor="middle">${esc(year ?? "")}</text>`,
  );
  // A tiny time slug and star on the lower arc, as on real date stamps.
  parts.push(
    `<text font-family="'MA IM Fell SC', serif" font-size="${n(r * 0.17)}" fill="${ink}"><textPath href="#${id}-arcb" startOffset="50%" text-anchor="middle" dominant-baseline="hanging">${esc(`★ ${rng.int(7, 11)}${rng.pick(["AM", "PM"])} ★`)}</textPath></text>`,
  );
  // Wavy cancellation bars running away from the ring.
  const barLen = w - r * 2 - 6;
  const x0 = p.barsSide === "right" ? cx + r + 4 : 0;
  const gap = (r * 1.7) / (p.bars - 1);
  const amp = rng.range(4, 7);
  const period = rng.range(46, 62);
  const phase = rng.range(0, Math.PI * 2);
  for (let i = 0; i < p.bars; i++) {
    const y = cy - r * 0.85 + gap * i;
    let d = "";
    for (let x = 0; x <= barLen; x += 4) {
      const yy = y + Math.sin((x / period) * Math.PI * 2 + phase) * amp;
      d += `${x === 0 ? "M" : "L"}${n(x0 + x)},${n(yy)}`;
    }
    parts.push(`<path d="${d}" fill="none" stroke="${ink}" stroke-width="${n(r * 0.06)}" stroke-linecap="round"/>`);
  }
  return `<g filter="url(#${f})" opacity="${n(0.78 + p.pressure * 0.15)}">${parts.join("")}</g>`;
}

/** Size of each label at scale 1 (the compositor scales the layer box). */
export const LABEL_SIZES: Record<LabelProps["type"], { w: number; h: number }> = {
  "par-avion": { w: 168, h: 56 },
  "special-delivery": { w: 190, h: 44 },
  "printed-matter": { w: 200, h: 42 },
  registered: { w: 150, h: 54 },
  specimen: { w: 230, h: 74 },
};

export function drawLabel(p: LabelProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const serif = "'MA IM Fell SC', serif";
  const sans = "'MA Special Elite', monospace";
  switch (p.type) {
    case "par-avion": {
      const blue = "#1f3c8c";
      return (
        `<rect width="${n(w)}" height="${n(h)}" rx="2" fill="${blue}"/>` +
        `<rect x="3" y="3" width="${n(w - 6)}" height="${n(h - 6)}" rx="1.5" fill="none" stroke="#f4f1e8" stroke-width="1"/>` +
        `<text x="${n(w / 2)}" y="${n(h * 0.46)}" font-family="${serif}" font-size="${n(h * 0.36)}" fill="#f4f1e8" text-anchor="middle" letter-spacing="1.5">PAR AVION</text>` +
        `<text x="${n(w / 2)}" y="${n(h * 0.8)}" font-family="${serif}" font-size="${n(h * 0.24)}" fill="#f4f1e8" text-anchor="middle" letter-spacing="1">BY AIR MAIL</text>`
      );
    }
    case "special-delivery": {
      const red = "#b2292f";
      let stripes = "";
      for (let x = -h; x < w; x += 14) stripes += `<path d="M${n(x)},${n(h)}L${n(x + h)},0L${n(x + h + 6)},0L${n(x + 6)},${n(h)}Z"/>`;
      ctx.defs.push(`<clipPath id="${id}-c"><rect width="${n(w)}" height="${n(h)}"/></clipPath>`);
      return (
        `<rect width="${n(w)}" height="${n(h)}" fill="#f6f2e6"/>` +
        `<g clip-path="url(#${id}-c)" fill="${red}">${stripes}</g>` +
        `<rect x="10" y="7" width="${n(w - 20)}" height="${n(h - 14)}" fill="#f6f2e6"/>` +
        `<text x="${n(w / 2)}" y="${n(h * 0.64)}" font-family="${serif}" font-size="${n(h * 0.38)}" fill="${red}" text-anchor="middle" letter-spacing="1.2">SPECIAL DELIVERY</text>`
      );
    }
    case "printed-matter": {
      // A rubber stamp, not a sticker: struck straight onto the envelope.
      const ink = rng.pick(["#1f1d22", "#4b3888", "#a8282c"]);
      const f = inkFilter(ctx, `${id}-ink`, p.seed, rng.range(0.3, 0.8), 2);
      return `<g filter="url(#${f})" opacity="0.82"><rect x="2" y="2" width="${n(w - 4)}" height="${n(h - 4)}" fill="none" stroke="${ink}" stroke-width="3"/><text x="${n(w / 2)}" y="${n(h * 0.67)}" font-family="${sans}" font-size="${n(h * 0.46)}" fill="${ink}" text-anchor="middle" letter-spacing="2">PRINTED MATTER</text></g>`;
    }
    case "specimen": {
      // A museum label: double rule border, scalloped corners, italic title.
      const ink = "#2b2118";
      const c = 9;
      const d = `M${c},0 H${n(w - c)} A${c},${c} 0 0 0 ${n(w)},${c} V${n(h - c)} A${c},${c} 0 0 0 ${n(w - c)},${n(h)} H${c} A${c},${c} 0 0 0 0,${n(h - c)} V${c} A${c},${c} 0 0 0 ${c},0 Z`;
      const fs = Math.min(h * 0.27, ((w - 30) / Math.max(10, (p.text ?? "").length)) * 2.05);
      return (
        `<path d="${d}" fill="#f7f1e1"/>` +
        `<g transform="translate(5,5) scale(${n((w - 10) / w)},${n((h - 10) / h)})"><path d="${d}" fill="none" stroke="${ink}" stroke-width="1.6"/></g>` +
        `<g transform="translate(9,9) scale(${n((w - 18) / w)},${n((h - 18) / h)})"><path d="${d}" fill="none" stroke="${ink}" stroke-width="0.7"/></g>` +
        `<text x="${n(w / 2)}" y="${n(h * 0.52)}" font-family="'MA IM Fell', serif" font-style="italic" font-size="${n(fs)}" fill="${ink}" text-anchor="middle">${esc(p.text ?? "")}</text>` +
        `<line x1="${n(w * 0.3)}" y1="${n(h * 0.63)}" x2="${n(w * 0.7)}" y2="${n(h * 0.63)}" stroke="${ink}" stroke-width="0.6"/>` +
        `<text x="${n(w / 2)}" y="${n(h * 0.82)}" font-family="'MA IM Fell SC', serif" font-size="${n(h * 0.16)}" fill="${ink}" text-anchor="middle" letter-spacing="1.5">${esc(p.number ?? "")}</text>`
      );
    }
    case "registered": {
      const red = "#b2292f";
      return (
        `<rect width="${n(w)}" height="${n(h)}" fill="#f8f5ec" stroke="#2a2522" stroke-width="1"/>` +
        `<rect x="0" y="0" width="${n(h)}" height="${n(h)}" fill="${red}"/>` +
        `<text x="${n(h / 2)}" y="${n(h * 0.76)}" font-family="${serif}" font-size="${n(h * 0.78)}" fill="#f8f5ec" text-anchor="middle">R</text>` +
        `<text x="${n(h + 8)}" y="${n(h * 0.4)}" font-family="${serif}" font-size="${n(h * 0.24)}" fill="#2a2522">REGISTERED</text>` +
        `<text x="${n(h + 8)}" y="${n(h * 0.8)}" font-family="${sans}" font-size="${n(h * 0.32)}" fill="#2a2522">No ${esc(p.number ?? "0000")}</text>`
      );
    }
  }
}
