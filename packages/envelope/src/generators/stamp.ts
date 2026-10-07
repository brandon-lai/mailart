import { Rng } from "../prng";
import type { Box } from "../types";
import { type Ctx, duotoneFilter, esc, mix, n } from "../svg";

export const STAMP_INKS = {
  carmine: "#a8233a",
  violet: "#56378a",
  ultramarine: "#26449e",
  green: "#2c6844",
  sepia: "#6b4628",
  orange: "#c8602a",
} as const;
export type StampInk = keyof typeof STAMP_INKS;
export const COOL_INKS: StampInk[] = ["ultramarine", "violet", "green"];
export const WARM_INKS: StampInk[] = ["carmine", "sepia", "orange"];

export const DENOMINATIONS = ["4", "1½", "50c", "2", "10", "5c", "3d", "25", "½", "8", "1", "15c", "6d", "20"];

export type StampProps = {
  seed: number;
  variant: "single" | "pair" | "block" | "framed";
  frame: "rect" | "oval";
  ink: StampInk;
  country: string;
  denomination: string;
  /** Picture source and the crop (in source pixels) the stamp shows. */
  src: string;
  crop: Box;
  natW: number;
  natH: number;
  /** single-stamp size; the layer box holds the whole variant */
  sw: number;
  sh: number;
  /** framed variant: distance from the frame's top up to the envelope's top edge */
  hangTo?: number;
  frameStyle?: "gilt" | "walnut" | "ebony";
};

const PAPER = "#f6f0e2";

/** Layout of a variant: footprint for given single-stamp size. */
export function stampFootprint(variant: StampProps["variant"], sw: number, sh: number) {
  if (variant === "pair") return { w: sw * 2, h: sh };
  if (variant === "block") return { w: sw * 2, h: sh * 2 };
  if (variant === "framed") {
    const b = frameBorder(sw);
    return { w: sw + b * 2, h: sh + b * 2 };
  }
  return { w: sw, h: sh };
}

const frameBorder = (sw: number) => Math.round(sw * 0.2);

export function drawStamp(p: StampProps, ctx: Ctx, layerId: string): string {
  const rng = new Rng(p.seed);
  const id = `${ctx.uid}-${layerId}`;
  const ink = STAMP_INKS[p.ink];
  ctx.defs.push(duotoneFilter(`${id}-duo`, mix(ink, "#000000", 0.15), mix(PAPER, ink, 0.08)));
  ctx.defs.push(
    // Fine horizontal engraving lines, multiplied over the picture.
    `<pattern id="${id}-eng" width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="1.1" fill="${ink}" opacity="0.32"/></pattern>`,
  );
  const design = stampDesign(p, rng, id, ink, ctx);
  if (p.variant === "single") return perforated(p.sw, p.sh, design, id, rng, ctx, 0);
  if (p.variant === "pair") {
    return perforated(p.sw, p.sh, design, id, rng, ctx, 0) + `<g transform="translate(${n(p.sw)},0)">${perforated(p.sw, p.sh, design, id, rng, ctx, 1)}</g>`;
  }
  if (p.variant === "block") {
    let out = "";
    for (let i = 0; i < 4; i++) {
      out += `<g transform="translate(${n((i % 2) * p.sw)},${n(Math.floor(i / 2) * p.sh)})">${perforated(p.sw, p.sh, design, id, rng, ctx, i)}</g>`;
    }
    return out;
  }
  return framed(p, rng, id, design, ctx);
}

/**
 * White margin with half-circle perforations cut from every edge.
 * `k` varies the tiny registration offset between stamps of a sheet.
 */
function perforated(w: number, h: number, design: string, id: string, rng: Rng, ctx: Ctx, k: number): string {
  const maskId = `${id}-perf-${n(w)}x${n(h)}`;
  if (!ctx.defs.some((d) => d.includes(`id="${maskId}"`))) {
    const r = Math.max(2.4, w / 34);
    const gap = r * 2.7;
    const holes: string[] = [];
    const nx = Math.max(3, Math.round(w / gap));
    const ny = Math.max(3, Math.round(h / gap));
    for (let i = 0; i <= nx; i++) {
      const x = (w / nx) * i;
      holes.push(`<circle cx="${n(x)}" cy="0" r="${n(r)}"/><circle cx="${n(x)}" cy="${n(h)}" r="${n(r)}"/>`);
    }
    for (let i = 0; i <= ny; i++) {
      const y = (h / ny) * i;
      holes.push(`<circle cx="0" cy="${n(y)}" r="${n(r)}"/><circle cx="${n(w)}" cy="${n(y)}" r="${n(r)}"/>`);
    }
    ctx.defs.push(
      `<mask id="${maskId}" maskUnits="userSpaceOnUse" x="-2" y="-2" width="${n(w + 4)}" height="${n(h + 4)}"><rect width="${n(w)}" height="${n(h)}" fill="#fff"/><g fill="#000">${holes.join("")}</g></mask>`,
    );
  }
  const shift = k === 0 ? 0 : (rng.next() - 0.5) * 1.2;
  return `<g mask="url(#${maskId})"><rect width="${n(w)}" height="${n(h)}" fill="${PAPER}"/><g transform="translate(${n(shift)},${n(shift * 0.6)})">${design}</g></g>`;
}

/** Everything printed on one stamp: picture, frame, country, value. Drawn at 0,0 within sw x sh. */
function stampDesign(p: StampProps, rng: Rng, id: string, ink: string, ctx: Ctx): string {
  const { sw: w, sh: h } = p;
  const m = Math.max(5, w * 0.075); // white margin
  const iw = w - m * 2;
  const ih = h - m * 2;
  const band = Math.max(11, ih * 0.13); // country name band
  const fs = Math.max(6.5, Math.min(band * 0.62, (iw * 1.75) / Math.max(10, p.country.length)));
  const picX = m + 3;
  const picY = m + band;
  const picW = iw - 6;
  const picH = ih - band - band * 0.9;
  const clipId = `${id}-pic-${p.frame}`;
  if (!ctx.defs.some((d) => d.includes(`id="${clipId}"`))) {
    ctx.defs.push(
      p.frame === "oval"
        ? `<clipPath id="${clipId}"><ellipse cx="${n(picX + picW / 2)}" cy="${n(picY + picH / 2)}" rx="${n(picW / 2 - 2)}" ry="${n(picH / 2 - 1)}"/></clipPath>`
        : `<clipPath id="${clipId}"><rect x="${n(picX)}" y="${n(picY)}" width="${n(picW)}" height="${n(picH)}"/></clipPath>`,
    );
  }
  // Fit the crop to cover the picture window, keeping its aspect.
  const s = Math.max(picW / p.crop.w, picH / p.crop.h);
  const imgX = picX + picW / 2 - (p.crop.x + p.crop.w / 2) * s;
  const imgY = picY + picH / 2 - (p.crop.y + p.crop.h / 2) * s;
  const parts: string[] = [];
  // Solid ink frame area, then the picture window cut into it.
  parts.push(`<rect x="${n(m)}" y="${n(m)}" width="${n(iw)}" height="${n(ih)}" fill="${ink}"/>`);
  parts.push(
    `<rect x="${n(m + 1.5)}" y="${n(m + 1.5)}" width="${n(iw - 3)}" height="${n(ih - 3)}" fill="none" stroke="${PAPER}" stroke-width="0.8"/>`,
  );
  parts.push(
    `<g clip-path="url(#${clipId})"><rect x="${n(picX)}" y="${n(picY)}" width="${n(picW)}" height="${n(picH)}" fill="${PAPER}"/>` +
      `<g filter="url(#${id}-duo)"><image href="${esc(ctx.assetUrl(p.src))}" x="${n(imgX)}" y="${n(imgY)}" width="${n(p.natW * s)}" height="${n(p.natH * s)}" preserveAspectRatio="none"/></g>` +
      `<rect x="${n(picX)}" y="${n(picY)}" width="${n(picW)}" height="${n(picH)}" fill="url(#${id}-eng)" style="mix-blend-mode:multiply"/></g>`,
  );
  if (p.frame === "oval") {
    parts.push(
      `<ellipse cx="${n(picX + picW / 2)}" cy="${n(picY + picH / 2)}" rx="${n(picW / 2 - 2)}" ry="${n(picH / 2 - 1)}" fill="none" stroke="${PAPER}" stroke-width="1.1"/>`,
    );
    // Corner ornaments: little rosettes in the spandrels.
    const r = Math.min(picW, picH) * 0.09;
    for (const [cx, cy] of [
      [picX + r * 1.1, picY + r * 1.1],
      [picX + picW - r * 1.1, picY + r * 1.1],
      [picX + r * 1.1, picY + picH - r * 1.1],
      [picX + picW - r * 1.1, picY + picH - r * 1.1],
    ]) {
      parts.push(rosette(cx, cy, r, PAPER));
    }
  } else {
    parts.push(
      `<rect x="${n(picX)}" y="${n(picY)}" width="${n(picW)}" height="${n(picH)}" fill="none" stroke="${PAPER}" stroke-width="1"/>`,
    );
  }
  // Country across the top band.
  parts.push(
    `<text x="${n(w / 2)}" y="${n(m + band * 0.74)}" font-family="'MA IM Fell SC', serif" font-size="${n(fs)}" fill="${PAPER}" text-anchor="middle" letter-spacing="0.3">${esc(p.country.toUpperCase())}</text>`,
  );
  // Denomination: in a corner disc for oval frames, in the bottom band for rect.
  const by = picY + picH;
  const bh = m + ih - by;
  if (p.frame === "oval" || rng.chance(0.5)) {
    const r = bh * 0.9;
    for (const cx of [m + r + 1, w - m - r - 1]) {
      parts.push(
        `<circle cx="${n(cx)}" cy="${n(by + bh / 2)}" r="${n(r)}" fill="${ink}" stroke="${PAPER}" stroke-width="0.9"/>` +
          `<text x="${n(cx)}" y="${n(by + bh / 2 + r * 0.42)}" font-family="'MA IM Fell', serif" font-size="${n(r * 1.25)}" fill="${PAPER}" text-anchor="middle">${esc(p.denomination)}</text>`,
      );
    }
    parts.push(
      `<text x="${n(w / 2)}" y="${n(by + bh * 0.68)}" font-family="'MA IM Fell SC', serif" font-size="${n(bh * 0.5)}" fill="${PAPER}" text-anchor="middle" letter-spacing="0.5">POSTAGE</text>`,
    );
  } else {
    parts.push(
      `<text x="${n(w / 2)}" y="${n(by + bh * 0.78)}" font-family="'MA IM Fell', serif" font-size="${n(bh * 0.95)}" fill="${PAPER}" text-anchor="middle">${esc(p.denomination)}</text>`,
    );
  }
  // Printing is never perfect: a slight ink unevenness.
  return `<g opacity="${n(rng.range(0.9, 0.98))}">${parts.join("")}</g>`;
}

function rosette(cx: number, cy: number, r: number, color: string): string {
  let petals = "";
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8;
    petals += `<circle cx="${n(cx + Math.cos(a) * r * 0.55)}" cy="${n(cy + Math.sin(a) * r * 0.55)}" r="${n(r * 0.28)}"/>`;
  }
  return `<g fill="${color}" opacity="0.9">${petals}<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.25)}"/></g>`;
}

const FRAME_COLORS = {
  gilt: { base: "#b8913e", light: "#f0d58a", dark: "#6e5220" },
  walnut: { base: "#6b4527", light: "#a77a52", dark: "#3a2312" },
  ebony: { base: "#2a2522", light: "#6a615a", dark: "#0e0c0b" },
};

/** A stamp inside a hand-drawn ornate picture frame, hung from the envelope's top edge. */
function framed(p: StampProps, rng: Rng, id: string, design: string, ctx: Ctx): string {
  const b = frameBorder(p.sw);
  const W = p.sw + b * 2;
  const H = p.sh + b * 2;
  const c = FRAME_COLORS[p.frameStyle ?? "gilt"];
  ctx.defs.push(
    `<linearGradient id="${id}-fr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.light}"/><stop offset="0.45" stop-color="${c.base}"/><stop offset="1" stop-color="${c.dark}"/></linearGradient>`,
  );
  const parts: string[] = [];
  // Hanging string: from two screw-eyes on the frame up to one nail at the top edge.
  if (p.hangTo !== undefined) {
    const nailY = -p.hangTo;
    const nailX = W / 2 + rng.range(-6, 6);
    parts.push(
      `<path d="M${n(W * 0.18)},${n(b * 0.4)} L${n(nailX)},${n(nailY + 4)} L${n(W * 0.82)},${n(b * 0.4)}" fill="none" stroke="#3b3027" stroke-width="1.3" stroke-linejoin="round"/>` +
        `<circle cx="${n(nailX)}" cy="${n(nailY + 4)}" r="3.2" fill="#55493e"/><circle cx="${n(nailX - 0.8)}" cy="${n(nailY + 3.2)}" r="1.1" fill="#a99d8f"/>`,
    );
  }
  // Moulding: outer bevel, inner bevel, beaded inner edge.
  parts.push(`<rect width="${n(W)}" height="${n(H)}" rx="2" fill="url(#${id}-fr)" stroke="${c.dark}" stroke-width="1"/>`);
  parts.push(
    `<rect x="${n(b * 0.22)}" y="${n(b * 0.22)}" width="${n(W - b * 0.44)}" height="${n(H - b * 0.44)}" fill="none" stroke="${c.light}" stroke-width="${n(b * 0.12)}" opacity="0.7"/>`,
  );
  parts.push(
    `<rect x="${n(b * 0.55)}" y="${n(b * 0.55)}" width="${n(W - b * 1.1)}" height="${n(H - b * 1.1)}" fill="none" stroke="${c.dark}" stroke-width="${n(b * 0.1)}" opacity="0.8"/>`,
  );
  // Ornate corners: scrolled leaves drawn with a few curves.
  for (const [sx, sy, cx, cy] of [
    [1, 1, 0, 0],
    [-1, 1, W, 0],
    [1, -1, 0, H],
    [-1, -1, W, H],
  ]) {
    const s = b * 1.15;
    parts.push(
      `<g transform="translate(${n(cx)},${n(cy)}) scale(${sx},${sy})"><path d="M0,0 C${n(s * 0.9)},${n(s * 0.1)} ${n(s * 1.1)},${n(s * 0.7)} ${n(s * 0.55)},${n(s * 0.75)} C${n(s * 0.25)},${n(s * 0.78)} ${n(s * 0.3)},${n(s * 0.4)} ${n(s * 0.55)},${n(s * 0.45)} M0,0 C${n(s * 0.1)},${n(s * 0.9)} ${n(s * 0.7)},${n(s * 1.1)} ${n(s * 0.75)},${n(s * 0.55)}" fill="${c.light}" stroke="${c.dark}" stroke-width="0.8" opacity="0.95"/></g>`,
    );
  }
  // Beading along the inner edge.
  const beads: string[] = [];
  const step = Math.max(5, b * 0.42);
  for (let x = b; x <= W - b; x += step) beads.push(`<circle cx="${n(x)}" cy="${n(b * 0.8)}" r="${n(b * 0.09)}"/><circle cx="${n(x)}" cy="${n(H - b * 0.8)}" r="${n(b * 0.09)}"/>`);
  for (let y = b; y <= H - b; y += step) beads.push(`<circle cx="${n(b * 0.8)}" cy="${n(y)}" r="${n(b * 0.09)}"/><circle cx="${n(W - b * 0.8)}" cy="${n(y)}" r="${n(b * 0.09)}"/>`);
  parts.push(`<g fill="${c.light}" opacity="0.85">${beads.join("")}</g>`);
  // A cream mat, then the stamp itself.
  parts.push(`<rect x="${n(b - 2)}" y="${n(b - 2)}" width="${n(p.sw + 4)}" height="${n(p.sh + 4)}" fill="#efe6d0"/>`);
  parts.push(`<g transform="translate(${n(b)},${n(b)})">${perforated(p.sw, p.sh, design, id, rng, ctx, 0)}</g>`);
  return parts.join("");
}
