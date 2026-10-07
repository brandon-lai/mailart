import { Rng } from "../prng";
import { type Ctx, type Pt, esc, mix, n, poly, torn, wobble } from "../svg";

export type TapeProps = {
  seed: number;
  pattern: "plain" | "stripes" | "dots" | "grid" | "kraft";
  color: string;
  opacity: number;
};

export type TicketProps = {
  seed: number;
  shape: "ticket" | "tag";
  text: string;
  number: string;
  color: string;
};

export type ScrapProps = {
  seed: number;
  src: string;
  natW: number;
  natH: number;
  /** Offset of the crop inside the source image, in source px. */
  cropX: number;
  cropY: number;
  scale: number;
};

export type CutoutProps = {
  src: string;
  /** cut-outs get a white paper border, the way scissors leave one */
  border: number;
  flip: boolean;
  /** stamp/specimen items sit higher; figures cast a longer shadow */
  shadow: "near" | "far";
  pin?: boolean;
  rect?: boolean; // not cut out: a print with torn edges
  seed?: number;
};

export const TAPE_COLORS = ["#e8c7a0", "#cfe0d6", "#f2d0d4", "#d8d2ec", "#f1e3a8", "#c9dbe8", "#efe8da"];

export function drawTape(p: TapeProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const tear = (a: Pt, b: Pt) => torn(rng, a, b, 3.2, 4.5);
  const edge = (a: Pt, b: Pt) => wobble(rng, a, b, 0.4, 20, 0.5);
  const d = poly([...edge([0, 0], [w, 0]).slice(0, -1), ...tear([w, 0], [w, h]).slice(0, -1), ...edge([w, h], [0, h]).slice(0, -1), ...tear([0, h], [0, 0]).slice(0, -1)]);
  ctx.defs.push(`<clipPath id="${id}-c"><path d="${d}"/></clipPath>`);
  const deep = mix(p.color, "#000000", 0.28);
  let pattern = "";
  if (p.pattern === "stripes") {
    for (let x = -h; x < w + h; x += 16) pattern += `<path d="M${n(x)},0L${n(x + 7)},0L${n(x + 7 - h)},${n(h)}L${n(x - h)},${n(h)}Z" fill="${deep}" opacity="0.35"/>`;
  } else if (p.pattern === "dots") {
    for (let x = 6; x < w; x += 13) for (let y = 6; y < h; y += 13) pattern += `<circle cx="${n(x + ((y / 13) % 2) * 6)}" cy="${n(y)}" r="2.2" fill="${deep}" opacity="0.4"/>`;
  } else if (p.pattern === "grid") {
    for (let x = 0; x < w; x += 9) pattern += `<line x1="${n(x)}" y1="0" x2="${n(x)}" y2="${n(h)}" stroke="${deep}" stroke-width="0.8" opacity="0.35"/>`;
    for (let y = 0; y < h; y += 9) pattern += `<line x1="0" y1="${n(y)}" x2="${n(w)}" y2="${n(y)}" stroke="${deep}" stroke-width="0.8" opacity="0.35"/>`;
  } else if (p.pattern === "kraft") {
    pattern = `<rect width="${n(w)}" height="${n(h)}" filter="url(#${ctx.uid}-grain)" opacity="0.9"/>`;
  }
  // Tape is translucent; light catches along one edge.
  return `<g opacity="${n(p.opacity)}" clip-path="url(#${id}-c)"><rect width="${n(w)}" height="${n(h)}" fill="${p.color}"/>${pattern}<rect width="${n(w)}" height="2.5" fill="#fff" opacity="0.4"/><rect y="${n(h - 2)}" width="${n(w)}" height="2" fill="#000" opacity="0.08"/></g>`;
}

export function drawTicket(p: TicketProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const ink = "#2a2420";
  const type = "'MA Special Elite', monospace";
  if (p.shape === "ticket") {
    // Notched corners like a cloakroom ticket.
    const r = h * 0.14;
    ctx.defs.push(
      `<mask id="${id}-m"><rect width="${n(w)}" height="${n(h)}" fill="#fff"/><g fill="#000"><circle cx="0" cy="0" r="${n(r)}"/><circle cx="${n(w)}" cy="0" r="${n(r)}"/><circle cx="0" cy="${n(h)}" r="${n(r)}"/><circle cx="${n(w)}" cy="${n(h)}" r="${n(r)}"/></g></mask>`,
    );
    const fs = Math.min(h * 0.28, ((w - 24) / Math.max(8, p.text.length)) * 1.75);
    return (
      `<g mask="url(#${id}-m)"><rect width="${n(w)}" height="${n(h)}" fill="${p.color}"/><rect width="${n(w)}" height="${n(h)}" filter="url(#${ctx.uid}-grain)" opacity="0.6"/>` +
      `<rect x="6" y="6" width="${n(w - 12)}" height="${n(h - 12)}" fill="none" stroke="${ink}" stroke-width="0.8" stroke-dasharray="3 2" opacity="0.6"/>` +
      `<text x="${n(w / 2)}" y="${n(h * 0.48)}" font-family="${type}" font-size="${n(fs)}" fill="${ink}" text-anchor="middle" opacity="0.85">${esc(p.text)}</text>` +
      `<text x="${n(w / 2)}" y="${n(h * 0.78)}" font-family="${type}" font-size="${n(h * 0.17)}" fill="#a3282c" text-anchor="middle" letter-spacing="2">Nº ${esc(p.number)}</text></g>`
    );
  }
  // Shipping tag: clipped corners on the left, reinforced eyelet, a loop of string.
  const c = h * 0.3;
  const d = poly([[c, 0], [w, 0], [w, h], [c, h], [0, h - c], [0, c]]);
  const ex = c * 0.9;
  const fs = Math.min(h * 0.26, ((w - c - 20) / Math.max(6, p.text.length)) * 1.7);
  const loop = `<path d="M${n(ex)},${n(h / 2)} C${n(-30)},${n(h * 0.1 + rng.range(-8, 8))} ${n(-50)},${n(h * 0.9)} ${n(-70 + rng.range(-10, 10))},${n(h * 0.6)}" fill="none" stroke="#8a6d4a" stroke-width="1.6"/>`;
  return (
    `<path d="${d}" fill="${p.color}"/><path d="${d}" filter="url(#${ctx.uid}-grain)" opacity="0.6"/>` +
    `<circle cx="${n(ex)}" cy="${n(h / 2)}" r="${n(h * 0.13)}" fill="#c9b48a"/><circle cx="${n(ex)}" cy="${n(h / 2)}" r="${n(h * 0.07)}" fill="#6b5a40"/>` +
    loop +
    `<text x="${n(c + (w - c) / 2)}" y="${n(h * 0.5)}" font-family="${type}" font-size="${n(fs)}" fill="${ink}" text-anchor="middle" opacity="0.85">${esc(p.text)}</text>` +
    `<line x1="${n(c + 12)}" y1="${n(h * 0.66)}" x2="${n(w - 12)}" y2="${n(h * 0.66)}" stroke="${ink}" stroke-width="0.6" opacity="0.4"/>` +
    `<text x="${n(c + (w - c) / 2)}" y="${n(h * 0.86)}" font-family="${type}" font-size="${n(h * 0.15)}" fill="${ink}" text-anchor="middle" opacity="0.7">Nº ${esc(p.number)}</text>`
  );
}

/** A torn rectangle cut from one of the ephemera backgrounds. */
export function drawScrap(p: ScrapProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const tear = (a: Pt, b: Pt) => wobble(rng, a, b, 2.4, 7, 0.75);
  const straight = (a: Pt, b: Pt) => wobble(rng, a, b, 0.5, 30, 0.5);
  // One or two sides torn, the rest cut.
  const tornSides = new Set(rng.shuffle([0, 1, 2, 3]).slice(0, rng.int(2, 4)));
  const e = (i: number, a: Pt, b: Pt) => (tornSides.has(i) ? tear(a, b) : straight(a, b));
  const d = poly([...e(0, [0, 0], [w, 0]).slice(0, -1), ...e(1, [w, 0], [w, h]).slice(0, -1), ...e(2, [w, h], [0, h]).slice(0, -1), ...e(3, [0, h], [0, 0]).slice(0, -1)]);
  ctx.defs.push(`<clipPath id="${id}-c"><path d="${d}"/></clipPath>`);
  return (
    `<g filter="url(#${ctx.uid}-shadow)"><g clip-path="url(#${id}-c)"><rect width="${n(w)}" height="${n(h)}" fill="#efe6d2"/>` +
    `<image href="${esc(ctx.assetUrl(p.src))}" x="${n(-p.cropX * p.scale)}" y="${n(-p.cropY * p.scale)}" width="${n(p.natW * p.scale)}" height="${n(p.natH * p.scale)}" preserveAspectRatio="none" opacity="0.92"/>` +
    `</g></g>`
  );
}

/** A library image: either a scissor cut-out (alpha PNG) or a rectangular print with torn edges. */
export function drawCutout(p: CutoutProps, ctx: Ctx, layerId: string, w: number, h: number): string {
  const id = `${ctx.uid}-${layerId}`;
  const flip = p.flip ? ` transform="translate(${n(w)},0) scale(-1,1)"` : "";
  const img = `<image href="${esc(ctx.assetUrl(p.src))}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="none"/>`;
  if (p.rect) {
    const rng = new Rng(p.seed ?? 1);
    const tear = (a: Pt, b: Pt) => wobble(rng, a, b, 1.8, 8, 0.7);
    const d = poly([...tear([0, 0], [w, 0]).slice(0, -1), ...tear([w, 0], [w, h]).slice(0, -1), ...tear([w, h], [0, h]).slice(0, -1), ...tear([0, h], [0, 0]).slice(0, -1)]);
    ctx.defs.push(`<clipPath id="${id}-c"><path d="${d}"/></clipPath>`);
    return `<g filter="url(#${ctx.uid}-shadow)"><g clip-path="url(#${id}-c)"><rect width="${n(w)}" height="${n(h)}" fill="#efe7d6"/><g${flip}>${img}</g></g></g>`;
  }
  const filter = p.shadow === "near" ? `${ctx.uid}-cut-near` : `${ctx.uid}-cut-far`;
  let pin = "";
  if (p.pin) {
    // An entomology pin through the thorax: head, a short glint, a tiny shadow.
    pin = `<g><ellipse cx="${n(w / 2 + 3)}" cy="${n(h * 0.42 + 4)}" rx="4" ry="2" fill="#000" opacity="0.25"/><circle cx="${n(w / 2)}" cy="${n(h * 0.42)}" r="4.2" fill="#2b2b30"/><circle cx="${n(w / 2 - 1.3)}" cy="${n(h * 0.42 - 1.3)}" r="1.4" fill="#d8d8de"/></g>`;
  }
  return `<g filter="url(#${filter})"><g${flip}>${img}</g></g>${pin}`;
}
