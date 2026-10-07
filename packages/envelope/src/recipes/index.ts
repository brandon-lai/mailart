import type { Asset, Box, Library, RecipeId, Stock } from "../types";
import { Builder, bounds, grow } from "../builder";
import type { LabelProps } from "../generators/postmark";
import phrases from "../data/phrases.json";

export type Recipe = {
  id: RecipeId;
  stock: (b: Builder) => Stock;
  /** Does this library have what the recipe needs? */
  eligible: (lib: Library) => boolean;
  build: (b: Builder) => void;
};

const count = (lib: Library, pred: (a: Asset) => boolean) => lib.filter(pred).length;
const plainStock = (b: Builder): Stock => b.rng.weighted([["cream", 4], ["kraft", 3], ["manila", 2], ["airmail", 1]] as const);

/** The rightmost stamp in the postage zone gets a postmark struck across its lower-left. */
function cancel(b: Builder, stampBox: Box) {
  const cx = stampBox.x + stampBox.w * b.rng.range(0.05, 0.3);
  const cy = stampBox.y + stampBox.h * b.rng.range(0.6, 0.85);
  return b.addPostmark(cx, cy, "left");
}

/** Fill with small extras until the minimum element count is met. */
function topUp(b: Builder, region: Box) {
  let guard = 0;
  while (b.count() < 6 && guard++ < 8) {
    const avoid = b.occupied().map((x) => grow(x, 8));
    if (b.rng.chance(0.5)) {
      const s = b.place(190 * b.k, 70 * b.k, region, avoid);
      b.addTicket(s.x, s.y);
    } else {
      const type = b.rng.pick(["par-avion", "registered", "special-delivery"] as const);
      const s = b.place(190 * b.k, 56 * b.k, region, avoid);
      b.addLabel(type, s.x, s.y);
    }
  }
}

// --------------------------------------------------------------------------
// Stamp heads: figures in a row, each head replaced by a portrait stamp, the
// row of stamps running along the postage corner.
// --------------------------------------------------------------------------
const stampHeads: Recipe = {
  id: "stamp-heads",
  stock: plainStock,
  eligible: (lib) =>
    count(lib, (a) => a.kind === "figure" && a.pose === "front" && !!a.headBox && a.cutout) >= 1 &&
    count(lib, (a) => a.kind === "bust" || a.kind === "vignette") >= 1,
  build(b) {
    const { W, H, rng } = b;
    const S = rng.range(92, 112) * b.k; // stamp width
    const SH = S * 1.22;
    const top = rng.range(26, 40);
    const want = rng.int(1, 4);
    const stampCy = top + SH / 2;
    type Planned = { a: Asset; scale: number; fw: number; fh: number; hx: number; hy: number };
    const planned: Planned[] = [];
    const candidates = rng.shuffle(b.assets(["figure"], { pose: ["front"], headBox: true, cutout: true, solo: true }));
    for (const a of candidates) {
      if (planned.length >= want) break;
      const hb = a.headBox!;
      // Stamp width ≈ 1.3x head width: that fixes the figure's scale.
      const scale = S / 1.3 / hb.w;
      const fh = a.h * scale;
      // Figures far taller than the envelope lose too much body; tiny ones float.
      if (fh < H * 0.7 || fh > H * 2) continue;
      // Wide cut-outs (seated sitters, crinolines) would push the address off the paper.
      if (a.w * scale > W * (planned.length ? 0.34 : 0.48)) continue;
      planned.push({ a, scale, fw: a.w * scale, fh, hx: (hb.x + hb.w / 2) * scale, hy: (hb.y + hb.h / 2) * scale });
    }
    // Lay the row out right to left: neighbours overlap a little (a crowd, not a
    // line-up) but every stamp keeps its own space, and nobody leaves the paper.
    const xs: number[] = [];
    let cx = 0;
    planned.forEach((p, i) => {
      if (i > 0) {
        const prev = planned[i - 1];
        const need = Math.max(S * 1.12, (prev.fw - prev.hx + p.hx) * rng.range(0.55, 0.75));
        cx -= need;
      }
      xs.push(cx);
    });
    // Shift so the rightmost figure ends inside the right edge, stamps in the corner.
    const rightExtent = Math.max(...planned.map((p, i) => xs[i] - p.hx + p.fw), S / 2);
    const shift = W - rng.range(24, 44) - rightExtent;
    const placed: { fig: ReturnType<Builder["addCutout"]>; cx: number }[] = [];
    planned.forEach((p, i) => {
      const x = xs[i] + shift - p.hx;
      if (x < W * 0.3 && placed.length > 0) return; // leave the left for the address
      b.used.add(p.a.id);
      const fig = b.addCutout(p.a, x, stampCy - p.hy, p.fw, p.fh, 0, { shadow: "far" });
      placed.push({ fig, cx: xs[i] + shift });
    });
    if (!placed.length) {
      // No figure fits: fall back to a dense collage rather than an empty envelope.
      b.recipeOverride = "dense-collage";
      return denseCollage.build(b);
    }
    // One portrait stamp per head, all from different sources.
    let rightmost: Box | undefined;
    for (const p of placed) {
      const src = b.stampSource(["bust"]);
      if (!src) break;
      const s = b.addStamp(src, "single", p.cx, stampCy, S, rng.range(-3, 3), { frame: rng.chance(0.6) ? "oval" : "rect" });
      if (!rightmost) rightmost = bounds(s);
    }
    if (rightmost) cancel(b, rightmost);

    // Address: to the left of the figures, low on the envelope.
    const leftmostFig = Math.min(...placed.map((p) => bounds(p.fig).x));
    const region = { x: 40, y: H * 0.42, w: Math.max(260, leftmostFig - 60), h: H * 0.58 - 24 };
    b.addAddress(region);

    // Extras: something on the left half, tape on a figure, sometimes a label.
    const leftRegion = { x: 30, y: 24, w: Math.max(200, leftmostFig - 50), h: H * 0.45 };
    const avoid = () => b.occupied().map((x) => grow(x, 10));
    if (rng.chance(0.6) && b.count() < 12) {
      const sw = rng.range(170, 260) * b.k;
      b.addScrap(leftRegion, sw, sw * rng.range(0.55, 0.8), avoid());
    }
    if (rng.chance(0.55) && b.count() < 13) {
      const type = rng.pick(["par-avion", "registered", "special-delivery", "printed-matter"] as const);
      const s = b.place(200 * b.k, 56 * b.k, leftRegion, avoid());
      b.addLabel(type, s.x, s.y);
    }
    if (rng.chance(0.7) && b.count() < 14) {
      const f = rng.pick(placed).fig;
      const fb = bounds(f);
      b.addTape(fb.x + fb.w / 2, Math.min(H - 40, fb.y + fb.h * 0.62), rng.range(110, 150));
    }
    topUp(b, leftRegion);
  },
};

// --------------------------------------------------------------------------
// Gallery: framed stamps hung from the top edge, figures seen from behind
// looking up at them.
// --------------------------------------------------------------------------
const gallery: Recipe = {
  id: "gallery",
  stock: (b) => b.rng.weighted([["cream", 4], ["kraft", 3], ["manila", 2]] as const),
  eligible: (lib) => count(lib, (a) => a.kind === "figure" && a.pose === "back" && a.cutout) >= 2,
  build(b) {
    const { W, H, rng } = b;
    // A plain postage stamp in the corner; the frames hang in the middle.
    const cornerSrc = b.stampSource(["vignette", "bust"]);
    const cs = rng.range(80, 96) * b.k;
    let corner: Box | undefined;
    if (cornerSrc) {
      const st = b.addStamp(cornerSrc, "single", W - 40 - cs / 2, 34 + cs * 0.61, cs, rng.range(-3, 3));
      corner = bounds(st);
    }
    const nFrames = rng.int(2, 3);
    const sw = (H > 600 ? rng.range(92, 112) : rng.range(66, 80)) * (nFrames === 2 ? 1.12 : 1);
    const x0 = W * rng.range(0.37, 0.41);
    const x1 = W - 230;
    const step = (x1 - x0) / nFrames;
    const frameTop = H > 600 ? rng.range(62, 84) : rng.range(42, 54);
    const frames: Box[] = [];
    const style = rng.pick(["gilt", "walnut", "ebony", "gilt"] as const);
    for (let i = 0; i < nFrames; i++) {
      const src = b.stampSource(["bust", "vignette", "animal"]);
      if (!src) break;
      const cx = x0 + step * (i + 0.5);
      // Evenly spaced; heights may differ a little, as on a salon wall.
      const ft = frameTop + rng.range(-6, 10);
      const portrait = src.kind === "bust" || src.kind === "figure";
      const fw = portrait ? sw : sw * 1.2;
      const fhh = portrait ? sw * 1.22 : sw * 0.8;
      const bdr = Math.round(fw * 0.2);
      const cy = ft + (fhh + bdr * 2) / 2;
      const st = b.addStamp(src, "framed", cx, cy, fw, rng.range(-2.5, 2.5), { hangTo: ft - 6, frameStyle: style });
      frames.push(bounds(st));
    }
    if (corner) cancel(b, corner);
    // The address claims the lower left before any figure is placed.
    const addr = b.addAddress({ x: 36, y: H * 0.45, w: W * 0.34, h: H * 0.55 - 20 });
    const addrRight = bounds(addr).x + bounds(addr).w + 16;
    // Figures below, from behind, each facing a frame.
    const nFigs = Math.max(2, Math.min(4, rng.int(2, 4)));
    const figs = rng.shuffle(b.assets(["figure"], { pose: ["back"], cutout: true })).slice(0, nFigs);
    const figTop = Math.max(...frames.map((f) => f.y + f.h)) + rng.range(18, 36);
    const figH = (H - figTop) * rng.range(1.2, 1.5); // cropped at the waist or knees
    figs.forEach((a, i) => {
      const f = frames[i % frames.length];
      const share = figs.length > frames.length && i >= frames.length;
      let fh = figH;
      let fw = (a.w / a.h) * fh;
      // Very wide cut-outs (cloaks, crinolines) are scaled down to stay in their bay.
      const maxW = W * 0.3;
      if (fw > maxW) {
        fh *= maxW / fw;
        fw = maxW;
      }
      const cx = f.x + f.w / 2 + (share ? rng.pick([-1, 1]) * fw * 0.45 : rng.range(-20, 20));
      const x = Math.min(W - fw - 10, Math.max(addrRight, cx - fw / 2));
      b.used.add(a.id);
      b.addCutout(a, x, figTop + rng.range(-8, 14) + (figH - fh), fw, fh, rng.range(-1.5, 1.5), { shadow: "far" });
    });
    const figLeft = Math.min(W, ...b.layers.filter((l) => l.kind === "cutout").map((l) => bounds(l).x));
    const avoid = () => b.occupied().map((x) => grow(x, 10));
    const left = { x: 26, y: 20, w: Math.max(220, figLeft - 40), h: H * 0.4 };
    if (rng.chance(0.5)) {
      const s = b.place(190 * b.k, 70 * b.k, left, avoid());
      b.addTicket(s.x, s.y);
    }
    if (rng.chance(0.5)) {
      const s = b.place(170 * b.k, 56 * b.k, left, avoid());
      b.addLabel(rng.pick(["registered", "special-delivery", "printed-matter"] as const), s.x, s.y);
    }
    topUp(b, left);
  },
};

// --------------------------------------------------------------------------
// Dense collage: airmail border, one large portrait or animal, a cluster of
// stamps, labels, tape and two postmarks. The address still reads.
// --------------------------------------------------------------------------
const denseCollage: Recipe = {
  id: "dense-collage",
  stock: () => "airmail",
  eligible: (lib) => count(lib, (a) => a.kind === "bust" || a.kind === "animal") >= 1,
  build(b) {
    const { W, H, rng } = b;
    const P = b.postage;
    const avoid = () => b.occupied().map((x) => grow(x, 6));

    // Hero: a big animal cut-out or a torn portrait print, left of centre.
    const hero = rng.chance(0.5) ? b.take(["animal"], { cutout: true }) ?? b.take(["bust"]) : b.take(["bust"]) ?? b.take(["animal"]);
    let heroBox: Box | undefined;
    if (hero) {
      const hh = H * rng.range(0.62, 0.82);
      const hw = Math.min((hero.w / hero.h) * hh, W * 0.38);
      const h2 = (hero.h / hero.w) * hw;
      const x = rng.range(50, W * 0.2);
      const y = rng.range(30, Math.max(31, H - h2 - 30));
      const l = b.addCutout(hero, x, y, hw, h2, b.rot(6), { shadow: "far", flip: rng.chance(0.3) });
      heroBox = bounds(l);
      if (!hero.cutout) b.tapeCorner(l, rng.pick([0, 1]));
    }
    // Scrap behind the hero.
    if (heroBox && rng.chance(0.75)) {
      const sw = rng.range(200, 300) * b.k;
      b.addScrap({ x: heroBox.x - 40, y: heroBox.y + heroBox.h * 0.3, w: heroBox.w + 120, h: heroBox.h * 0.8 }, sw, sw * rng.range(0.5, 0.75));
    }

    // Stamps: a block or pair in the corner, singles around it.
    const total = rng.int(3, 6);
    const S = rng.range(70, 86) * b.k;
    const stamps: Box[] = [];
    const mainVariant = total >= 5 && rng.chance(0.5) ? "block" : rng.chance(0.6) ? "pair" : "single";
    const main = b.stampSource(["bust", "vignette"]);
    if (main) {
      const fpW = mainVariant === "single" ? S : S * 2;
      const fpH = mainVariant === "block" ? S * 2.44 : S * 1.22;
      const st = b.addStamp(main, mainVariant, W - 46 - fpW / 2, 34 + fpH / 2, S, b.rot(4));
      stamps.push(bounds(st));
    }
    const singlesRegion = { x: W * 0.42, y: 20, w: W * 0.58 - 30, h: H * 0.42 };
    const singles = total - (mainVariant === "block" ? 4 : mainVariant === "pair" ? 2 : 1);
    for (let i = 0; i < singles && b.count() < 11; i++) {
      const src = b.stampSource(["vignette", "bust", "animal"]);
      if (!src) break;
      const s = b.place(S * 1.2, S * 1.3, singlesRegion, avoid(), 30);
      const st = b.addStamp(src, "single", s.x + S * 0.6, s.y + S * 0.65, S * rng.range(0.9, 1.05), b.rot(7));
      stamps.push(bounds(st));
    }
    // Labels: PAR AVION always on airmail, maybe one more.
    const labelRegion = { x: W * 0.36, y: H * 0.3, w: W * 0.4, h: H * 0.3 };
    const pa = b.place(170 * b.k, 56 * b.k, labelRegion, avoid());
    b.addLabel("par-avion", pa.x, pa.y);
    if (rng.chance(0.55)) {
      const t = rng.pick(["registered", "special-delivery"] as LabelProps["type"][]);
      const s = b.place(190 * b.k, 56 * b.k, { x: 30, y: 26, w: W * 0.5, h: H * 0.3 }, avoid());
      b.addLabel(t, s.x, s.y);
    }
    // Address: lower right half, clear of everything that may not cover it.
    b.addAddress({ x: W * 0.4, y: H * 0.5, w: W * 0.6 - 50, h: H * 0.5 - 26 });
    // Two postmarks: one on the corner stamps, one across another stamp.
    if (stamps[0]) cancel(b, stamps[0]);
    const other = stamps[1] ?? stamps[0];
    if (other) b.addPostmark(other.x + other.w * 0.5, other.y + other.h * 0.7, rng.pick(["left", "right"]), b.rot(14));
    // Tape.
    const tapes = rng.int(1, 2);
    for (let i = 0; i < tapes && b.count() < 14; i++) {
      const target = rng.pick(b.layers.filter((l) => l.kind === "stamp" || l.kind === "label" || l.kind === "scrap"));
      if (target) b.tapeCorner(target);
    }
    topUp(b, { x: 30, y: 24, w: W * 0.5, h: H * 0.5 });
    void P;
  },
};

// --------------------------------------------------------------------------
// Specimen: butterflies and botanicals pinned around one portrait or animal,
// with an ornate museum label.
// --------------------------------------------------------------------------
const specimen: Recipe = {
  id: "specimen",
  stock: (b) => b.rng.weighted([["cream", 5], ["manila", 3], ["kraft", 2]] as const),
  eligible: (lib) => count(lib, (a) => (a.kind === "insect" || a.kind === "botanical") && a.cutout) >= 4,
  build(b) {
    const { W, H, rng } = b;
    const centre = b.take(["bust"]) ?? b.take(["animal"], { cutout: true }) ?? b.take(["animal"]);
    // The collection occupies the left ~62% of the envelope.
    const area: Box = { x: 34, y: 26, w: W * 0.6, h: H - 52 };
    let cBox: Box | undefined;
    if (centre) {
      const ch = H * rng.range(0.46, 0.58);
      const cw = Math.min((centre.w / centre.h) * ch, area.w * 0.38);
      const h2 = (centre.h / centre.w) * cw;
      const cx = area.x + area.w * rng.range(0.42, 0.55);
      const cy = area.y + area.h * 0.47;
      const l = b.addCutout(centre, cx - cw / 2, cy - h2 / 2, cw, h2, b.rot(2.5), { shadow: "near" });
      cBox = bounds(l);
    }
    // Small items on a loose grid with jitter around the centrepiece.
    const cols = 4;
    const rows = H > 600 ? 4 : 3;
    const cellW = area.w / cols;
    const cellH = area.h / rows;
    const cells: { cx: number; cy: number }[] = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const cx = area.x + cellW * (c + 0.5) + rng.range(-cellW * 0.12, cellW * 0.12);
        const cy = area.y + cellH * (r + 0.5) + rng.range(-cellH * 0.12, cellH * 0.12);
        if (cBox && overlap1(cx, cy, cellW * 0.42, cellH * 0.42, cBox)) continue;
        cells.push({ cx, cy });
      }
    const nItems = Math.min(cells.length, rng.int(4, 7));
    const chosen = rng.shuffle(cells).slice(0, nItems);
    for (const cell of chosen) {
      const a = b.take(["insect", "botanical"], { cutout: true });
      if (!a) break;
      const box = Math.min(cellW, cellH) * rng.range(0.62, 0.8);
      const s = box / Math.max(a.w, a.h);
      const w = a.w * s;
      const h = a.h * s;
      b.addCutout(a, cell.cx - w / 2, cell.cy - h / 2, w, h, b.rot(8), { shadow: "near", pin: a.kind === "insect" });
    }
    // Ornate label under the centrepiece.
    const lw = 230 * b.k;
    const lh = 74 * b.k;
    const lx = cBox ? cBox.x + cBox.w / 2 - lw / 2 : area.x + area.w / 2 - lw / 2;
    const ly = cBox ? Math.min(H - lh - 22, cBox.y + cBox.h + 10) : H - lh - 30;
    b.add("label", { x: lx, y: ly, w: lw, h: lh, rotate: b.rot(1.5) }, { seed: rng.seed(), type: "specimen", text: rng.pick(phrases.specimen), number: `No. ${rng.int(1, 240)}` });

    // Postage: one or two stamps in the corner, cancelled.
    const S = rng.range(80, 96) * b.k;
    const src = b.stampSource(["insect", "botanical", "vignette", "bust"]);
    if (src) {
      const st = b.addStamp(src, rng.chance(0.3) ? "pair" : "single", W - 46 - S * 0.6, 34 + S * 0.65, S, b.rot(3));
      cancel(b, bounds(st));
    }
    if (b.count() < 13 && rng.chance(0.5)) {
      const s2 = b.stampSource(["vignette", "bust", "botanical"]);
      if (s2) b.addStamp(s2, "single", W - 70 - S * 2, 40 + S * 0.62, S * 0.92, b.rot(5));
    }
    b.addAddress({ x: W * 0.58, y: H * 0.45, w: W * 0.42 - 40, h: H * 0.55 - 24 });
    topUp(b, { x: W * 0.62, y: H * 0.2, w: W * 0.36, h: H * 0.3 });
  },
};

function overlap1(cx: number, cy: number, rw: number, rh: number, b: Box) {
  return cx + rw > b.x && cx - rw < b.x + b.w && cy + rh > b.y && cy - rh < b.y + b.h;
}

export const RECIPE_TABLE: Record<RecipeId, Recipe> = {
  "stamp-heads": stampHeads,
  gallery,
  "dense-collage": denseCollage,
  specimen,
};
