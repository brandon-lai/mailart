import { Rng } from "../prng";
import type { FlapSpec, PaperSpec, SizeId, Stock } from "../types";
import { type Ctx, type Pt, mix, n, poly, wobble } from "../svg";

export const CANVAS_W = 1200;
export const SIZES: Record<SizeId, { w: number; h: number }> = {
  business: { w: CANVAS_W, h: Math.round(CANVAS_W / 2.3) }, // 522
  square: { w: CANVAS_W, h: Math.round(CANVAS_W / 1.5) }, // 800
};

const STOCK_COLORS: Record<Stock, string[]> = {
  cream: ["#f2e7cf", "#efe2c6", "#f4ead6", "#ece0c4"],
  kraft: ["#c69d70", "#bf9466", "#cba57a"],
  manila: ["#e6d29c", "#e2cc92", "#e9d7a6"],
  airmail: ["#f7f4ec", "#f4f1e8"],
};

export const AIRMAIL_RED = "#c3343e";
export const AIRMAIL_BLUE = "#26428f";

export function paperSpec(rng: Rng, w: number, h: number, sizeId: SizeId, stock: Stock): PaperSpec {
  const foxCount = rng.int(0, 6);
  const foxing = Array.from({ length: foxCount }, () => ({
    x: rng.range(0, w),
    y: rng.range(0, h),
    r: rng.range(3, 14),
    o: rng.range(0.12, 0.32),
  }));
  const creases: PaperSpec["creases"] = [];
  if (rng.chance(0.55)) {
    // A fold a third of the way across, like a letter that travelled in a pocket.
    const x = w * rng.pick([0.33, 0.5, 0.66]) + rng.range(-20, 20);
    creases.push({ x1: x + rng.range(-6, 6), y1: 0, x2: x + rng.range(-6, 6), y2: h, o: rng.range(0.25, 0.5) });
  }
  if (rng.chance(0.3)) {
    const y = h * rng.range(0.35, 0.65);
    creases.push({ x1: 0, y1: y + rng.range(-5, 5), x2: w, y2: y + rng.range(-5, 5), o: rng.range(0.2, 0.4) });
  }
  return {
    seed: rng.seed(),
    stock,
    sizeId,
    color: rng.pick(STOCK_COLORS[stock]),
    grain: stock === "kraft" ? rng.range(0.6, 0.9) : rng.range(0.35, 0.7),
    foxing,
    creases,
    coffeeRing: rng.chance(0.18)
      ? { x: rng.range(w * 0.1, w * 0.9), y: rng.range(h * 0.5, h * 0.95), r: rng.range(55, 85), o: rng.range(0.18, 0.3) }
      : undefined,
    edgeDarkness: rng.range(0.25, 0.6),
  };
}

export function flapSpec(rng: Rng, paper: PaperSpec, h: number): FlapSpec {
  const shape = rng.weighted([
    ["pointed", 5],
    ["wallet", 3],
    ["round", 2],
  ] as const);
  const depth = shape === "wallet" ? h * rng.range(0.32, 0.4) : h * rng.range(0.42, 0.55);
  const liner = rng.weighted([
    ["tint", 4],
    ["marble", 2],
    ["none", 3],
  ] as const);
  return {
    seed: rng.seed(),
    shape,
    depth,
    outside: paper.color,
    inside: mix(paper.color, "#3a2a18", 0.22),
    liner,
    linerColor: rng.pick(["#2b4a8a", "#3b5d4a", "#7a2f3a", "#4a3b6b", "#2f2f35"]),
  };
}

/** The paper itself: stock colour, grain, edge darkening, foxing, creases, coffee ring, airmail border. */
export function drawPaper(p: PaperSpec, w: number, h: number, ctx: Ctx): string {
  const id = ctx.uid;
  const rng = new Rng(p.seed);
  const dark = mix(p.color, "#3b2610", 0.45);
  ctx.defs.push(`
<filter id="${id}-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="${p.seed % 1000}" result="t"/>
<feColorMatrix in="t" type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.18  0 0 0 0 0.1  0 0 0 ${n(p.grain * 0.55)} ${n(-p.grain * 0.2)}"/>
</filter>
<filter id="${id}-fiber" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.006 0.09" numOctaves="3" seed="${(p.seed >> 8) % 1000}"/>
<feColorMatrix type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.2  0 0 0 0 0.1  0 0 0 ${n(p.grain * 0.5)} ${n(-p.grain * 0.24)}"/>
</filter>
<radialGradient id="${id}-vig" cx="50%" cy="50%" r="75%">
<stop offset="0.6" stop-color="${dark}" stop-opacity="0"/>
<stop offset="1" stop-color="${dark}" stop-opacity="${n(p.edgeDarkness * 0.55)}"/>
</radialGradient>
<radialGradient id="${id}-fox">
<stop offset="0" stop-color="#8a5a2a" stop-opacity="0.9"/>
<stop offset="0.55" stop-color="#9b6a35" stop-opacity="0.45"/>
<stop offset="1" stop-color="#a0723c" stop-opacity="0"/>
</radialGradient>
<filter id="${id}-coffee" x="-20%" y="-20%" width="140%" height="140%">
<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="${(p.seed >> 4) % 1000}"/>
<feDisplacementMap in="SourceGraphic" scale="9"/>
</filter>
<clipPath id="${id}-paper"><rect width="${w}" height="${h}" rx="5"/></clipPath>`);

  const parts: string[] = [];
  parts.push(`<rect width="${w}" height="${h}" rx="5" fill="${p.color}"/>`);
  // A faint broad lighting gradient so the sheet is not one flat colour.
  parts.push(
    `<rect width="${w}" height="${h}" fill="${mix(p.color, "#ffffff", 0.35)}" opacity="${n(rng.range(0.15, 0.3))}" transform="skewX(-20)" style="mix-blend-mode:soft-light"/>`,
  );
  parts.push(`<rect width="${w}" height="${h}" filter="url(#${id}-fiber)"/>`);
  parts.push(`<rect width="${w}" height="${h}" filter="url(#${id}-grain)"/>`);

  if (p.stock === "airmail") parts.push(airmailBorder(rng, w, h));

  for (const c of p.creases) {
    // A crease is a dark line with a lit edge beside it.
    parts.push(
      `<line x1="${n(c.x1)}" y1="${n(c.y1)}" x2="${n(c.x2)}" y2="${n(c.y2)}" stroke="${dark}" stroke-width="1.4" opacity="${n(c.o * 0.6)}"/>` +
        `<line x1="${n(c.x1 + 1.5)}" y1="${n(c.y1 + 1)}" x2="${n(c.x2 + 1.5)}" y2="${n(c.y2 + 1)}" stroke="#fff" stroke-width="1.6" opacity="${n(c.o * 0.5)}"/>`,
    );
  }
  for (const f of p.foxing) {
    parts.push(
      `<ellipse cx="${n(f.x)}" cy="${n(f.y)}" rx="${n(f.r)}" ry="${n(f.r * 0.8)}" fill="url(#${id}-fox)" opacity="${n(f.o)}"/>`,
    );
  }
  if (p.coffeeRing) {
    const c = p.coffeeRing;
    parts.push(
      `<g filter="url(#${id}-coffee)" opacity="${n(c.o)}"><circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(c.r)}" fill="#8b5a2b" fill-opacity="0.12" stroke="#6b3e1a" stroke-width="5"/>` +
        `<circle cx="${n(c.x + 4)}" cy="${n(c.y + 2)}" r="${n(c.r - 3)}" fill="none" stroke="#6b3e1a" stroke-width="1.5" stroke-opacity="0.7"/></g>`,
    );
  }
  parts.push(`<rect width="${w}" height="${h}" fill="url(#${id}-vig)"/>`);
  return `<g clip-path="url(#${id}-paper)">${parts.join("")}</g>`;
}

function airmailBorder(rng: Rng, w: number, h: number): string {
  // Red and blue parallelograms around the edge, 45 degrees, with white gaps.
  const band = 20;
  const seg = 34;
  const out: string[] = [];
  let i = rng.int(0, 1);
  const paint = (pts: Pt[]) => {
    out.push(`<path d="${poly(pts)}" fill="${i % 2 ? AIRMAIL_RED : AIRMAIL_BLUE}"/>`);
    i++;
  };
  for (let x = -band; x < w + band; x += seg * 1.5) {
    paint([[x, 0], [x + seg, 0], [x + seg - band, band], [x - band, band]]);
    paint([[x, h], [x + seg, h], [x + seg + band, h - band], [x + band, h - band]]);
  }
  for (let y = band; y < h - band; y += seg * 1.5) {
    paint([[0, y], [0, y + seg], [band, y + seg + band], [band, y + band]]);
    paint([[w, y], [w, y + seg], [w - band, y + seg - band], [w - band, y - band]]);
  }
  return `<g opacity="0.92">${out.join("")}</g>`;
}

/**
 * The back flap's inside face, drawn hanging down from the hinge at y=0. The
 * renderer rotates it 180deg about the top edge, so this is what shows above
 * the envelope once it opens.
 */
export function flapPath(f: FlapSpec, w: number): string {
  const rng = new Rng(f.seed);
  const d = f.depth;
  let pts: Pt[];
  const edge = (a: Pt, b: Pt) => wobble(rng, a, b, 1.4, 14, 0.6);
  if (f.shape === "pointed") {
    pts = [...edge([0, 0], [w / 2, d]).slice(0, -1), ...edge([w / 2, d], [w, 0])];
  } else if (f.shape === "wallet") {
    const r = 60;
    pts = [
      ...edge([0, 0], [r * 0.4, d - r * 0.4]).slice(0, -1),
      ...edge([r * 0.4, d - r * 0.4], [r, d]).slice(0, -1),
      ...edge([r, d], [w - r, d]).slice(0, -1),
      ...edge([w - r, d], [w - r * 0.4, d - r * 0.4]).slice(0, -1),
      ...edge([w - r * 0.4, d - r * 0.4], [w, 0]),
    ];
  } else {
    pts = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = Math.PI * t;
      const wob = i === 0 || i === steps ? 0 : rng.gauss() * 1.2;
      pts.push([w / 2 - Math.cos(a) * (w / 2) + wob, Math.sin(a) * d * 0.98 + wob]);
    }
  }
  return poly([[0, 0], ...pts, [w, 0]]);
}

export function drawFlapInside(f: FlapSpec, w: number, ctx: Ctx): string {
  const id = `${ctx.uid}-flap`;
  const d = flapPath(f, w);
  const defs: string[] = [`<clipPath id="${id}-clip"><path d="${d}"/></clipPath>`];
  let liner = "";
  if (f.liner === "tint") {
    // Security-tint pattern, as printed inside real envelopes.
    defs.push(
      `<pattern id="${id}-tint" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0,0L9,9M-2,7L2,11M7,-2L11,2" stroke="${f.linerColor}" stroke-width="2.2"/><circle cx="4.5" cy="1.5" r="1" fill="${f.linerColor}"/></pattern>`,
    );
    liner = `<rect x="0" y="0" width="${w}" height="${f.depth}" fill="url(#${id}-tint)" opacity="0.8"/>`;
  } else if (f.liner === "marble") {
    defs.push(
      `<filter id="${id}-marble" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="turbulence" baseFrequency="0.008 0.03" numOctaves="4" seed="${f.seed % 997}"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 0.7 0 0.8 0.1 0.9"/></feComponentTransfer><feFlood flood-color="${f.linerColor}"/><feComposite operator="in" in2="SourceGraphic"/></filter>`,
    );
    liner = `<rect x="0" y="0" width="${w}" height="${f.depth}" fill="${mix(f.linerColor, "#ffffff", 0.75)}"/><g filter="url(#${id}-marble)"><rect width="${w}" height="${f.depth}" fill="#000"/></g>`;
  }
  // Light falls off toward the hinge: it is the deep end of the pocket.
  defs.push(
    `<linearGradient id="${id}-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.38"/><stop offset="0.5" stop-color="#000" stop-opacity="0.1"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>`,
  );
  defs.push(
    `<filter id="${id}-grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="${f.seed % 1000}"/><feColorMatrix type="matrix" values="0 0 0 0 0.2  0 0 0 0 0.14  0 0 0 0 0.08  0 0 0 0.35 -0.1"/></filter>`,
  );
  ctx.defs.push(...defs);
  // The paper edge is visible as a thin lighter rim around the liner.
  return `<g clip-path="url(#${id}-clip)"><rect width="${w}" height="${n(f.depth + 2)}" fill="${f.inside}"/><g transform="translate(0,0)">${
    liner ? `<g clip-path="url(#${id}-clip)" transform="translate(${n(w * 0.012)},0) scale(0.976,0.95)">${liner}</g>` : ""
  }</g><rect width="${w}" height="${n(f.depth + 2)}" fill="url(#${id}-shade)"/><rect width="${w}" height="${n(f.depth + 2)}" filter="url(#${id}-grain)"/></g><path d="${d}" fill="none" stroke="${mix(f.inside, "#000", 0.35)}" stroke-width="1.2" opacity="0.6"/>`;
}
