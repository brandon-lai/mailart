import { Rng } from "./prng";
import type { Asset, AssetKind, Box, EnvelopeInput, InkFamily, Layer, LayerKind, Library, Pose } from "./types";
import { COOL_INKS, DENOMINATIONS, WARM_INKS, stampFootprint, type StampInk, type StampProps } from "./generators/stamp";
import { LABEL_SIZES, type LabelProps, type PostmarkInk, type PostmarkProps } from "./generators/postmark";
import { layoutAddress } from "./generators/address";
import { TAPE_COLORS, type CutoutProps, type ScrapProps, type TapeProps, type TicketProps } from "./generators/ephemera";
import countries from "./data/countries.json";
import phrases from "./data/phrases.json";

export const LAYER_ORDER: LayerKind[] = ["scrap", "address", "cutout", "stamp", "label", "postmark", "tape"];
export const MIN_ELEMENTS = 6;
export const MAX_ELEMENTS = 14;
export const MAX_ADDRESS_COVER = 0.15;

/** Axis-aligned bounds of a rotated layer box. */
export function bounds(l: Pick<Layer, "x" | "y" | "w" | "h" | "rotate">): Box {
  const a = (l.rotate * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const bw = l.w * c + l.h * s;
  const bh = l.w * s + l.h * c;
  const cx = l.x + l.w / 2;
  const cy = l.y + l.h / 2;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export const grow = (b: Box, m: number): Box => ({ x: b.x - m, y: b.y - m, w: b.w + m * 2, h: b.h + m * 2 });

export class Builder {
  readonly rng: Rng;
  readonly layers: Layer[] = [];
  readonly used = new Set<string>();
  readonly family: InkFamily;
  readonly stampInks: StampInk[];
  readonly postmarkInks: PostmarkInk[];
  private counter = 0;
  /** Set when a recipe had to fall back to another (e.g. no figure fits). */
  recipeOverride?: import("./types").RecipeId;
  /** Scale for dimensions tuned on the business size. */
  readonly k: number;

  constructor(
    readonly input: EnvelopeInput,
    readonly library: Library,
    readonly W: number,
    readonly H: number,
    rng: Rng,
  ) {
    this.rng = rng;
    this.family = rng.chance(0.5) ? "cool" : "warm";
    this.stampInks = this.family === "cool" ? COOL_INKS : WARM_INKS;
    this.postmarkInks = this.family === "cool" ? ["black", "black", "violet"] : ["black", "black", "red"];
    this.k = H > 600 ? 1.2 : 1;
  }

  /** The postage zone: top right, where the post office expects to find the stamps. */
  get postage(): Box {
    return { x: this.W - 340, y: 18, w: 322, h: this.H > 600 ? 270 : 210 };
  }

  get address(): Layer | undefined {
    return this.layers.find((l) => l.kind === "address");
  }

  nextId(kind: string) {
    return `${kind}${++this.counter}`;
  }

  add(kind: LayerKind, box: { x: number; y: number; w: number; h: number; rotate?: number }, props: Record<string, unknown>, assetId?: string): Layer {
    const layer: Layer = {
      id: this.nextId(kind),
      kind,
      ...(assetId ? { assetId } : {}),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      rotate: box.rotate ?? 0,
      props,
    };
    this.layers.push(layer);
    return layer;
  }

  remove(layer: Layer) {
    const i = this.layers.indexOf(layer);
    if (i >= 0) this.layers.splice(i, 1);
    if (layer.assetId) this.used.delete(layer.assetId);
  }

  assets(kinds: AssetKind[], opts: { pose?: Pose[]; cutout?: boolean; headBox?: boolean; solo?: boolean; stampable?: boolean; whole?: boolean } = {}): Asset[] {
    return this.library.filter(
      (a) =>
        kinds.includes(a.kind) &&
        (!opts.solo || !a.group) &&
        (!opts.stampable || !a.silhouette) &&
        (!opts.whole || !a.mounted) &&
        !this.used.has(a.id) &&
        (opts.pose === undefined || (a.pose !== undefined && opts.pose.includes(a.pose))) &&
        (opts.cutout === undefined || a.cutout === opts.cutout) &&
        (!opts.headBox || !!a.headBox),
    );
  }

  /** Pick an unused asset and mark it used. Never the same asset twice per envelope. */
  take(kinds: AssetKind[], opts: Parameters<Builder["assets"]>[1] = {}): Asset | undefined {
    const pool = this.assets(kinds, opts);
    if (!pool.length) return undefined;
    const a = this.rng.pick(pool);
    this.used.add(a.id);
    return a;
  }

  rot(max = 6) {
    return this.rng.range(-max, max);
  }

  // ---- placement -------------------------------------------------------

  /** Boxes that new elements should avoid, optionally only some kinds. */
  occupied(kinds?: LayerKind[]): Box[] {
    return this.layers.filter((l) => !kinds || kinds.includes(l.kind)).map(bounds);
  }

  /**
   * Find a spot for a w x h box inside `region` that overlaps `avoid` least.
   * Deterministic: candidates come from the rng in a fixed order.
   */
  place(w: number, h: number, region: Box, avoid: Box[], tries = 40, rotate = 0): { x: number; y: number; cost: number } {
    let best = { x: region.x, y: region.y, cost: Infinity };
    for (let i = 0; i < tries; i++) {
      const x = region.x + this.rng.range(0, Math.max(0, region.w - w));
      const y = region.y + this.rng.range(0, Math.max(0, region.h - h));
      const b = bounds({ x, y, w, h, rotate });
      let cost = 0;
      for (const a of avoid) cost += overlap(b, a);
      // Stay on the paper.
      cost += Math.max(0, -b.x) * h + Math.max(0, b.x + b.w - this.W) * h + Math.max(0, -b.y) * w + Math.max(0, b.y + b.h - this.H) * w;
      if (cost < best.cost) best = { x, y, cost };
      if (cost === 0) break;
    }
    return best;
  }

  // ---- element factories ---------------------------------------------

  /** Address block, placed in `region` where it collides with nothing that may not cover it. */
  addAddress(region: Box, baseSize = 62): Layer {
    const { recipientName, addressLine } = this.input;
    const maxW = Math.min(region.w, 470 * this.k);
    const blocking = this.layers.filter((l) => l.kind !== "postmark" && l.kind !== "tape").map((l) => grow(bounds(l), 10));
    let size = baseSize * this.k;
    let layout = layoutAddress(this.rng, recipientName, addressLine, maxW, size);
    let rotate = this.rng.range(-2, 2);
    let spot = this.place(layout.w, layout.h, region, blocking, 60, rotate);
    // Shrink rather than collide.
    for (let i = 0; i < 3 && spot.cost > 0; i++) {
      size *= 0.86;
      layout = layoutAddress(this.rng, recipientName, addressLine, maxW * 0.9, size);
      spot = this.place(layout.w, layout.h, region, blocking, 60, rotate);
    }
    return this.add("address", { x: spot.x, y: spot.y, w: layout.w, h: layout.h, rotate }, layout.props as unknown as Record<string, unknown>);
  }

  stampInk(): StampInk {
    return this.rng.pick(this.stampInks);
  }

  /** Crop (in source px) for a stamp picture: around the head for portraits, the centre for vignettes. */
  stampCrop(a: Asset, aspect: number): Box {
    let cx: number, cy: number, cw: number;
    if (a.headBox && (a.kind === "figure" || a.kind === "bust")) {
      const hb = a.headBox;
      cx = hb.x + hb.w / 2;
      cy = hb.y + hb.h * (a.kind === "figure" ? 0.75 : 0.62);
      cw = hb.w * (a.kind === "figure" ? 1.9 : 1.55);
    } else {
      cx = a.w / 2;
      cy = a.h / 2;
      cw = Math.min(a.w, a.h * aspect) * this.rng.range(0.7, 0.95);
    }
    let ch = cw / aspect;
    if (ch > a.h) {
      ch = a.h;
      cw = ch * aspect;
    }
    if (cw > a.w) {
      cw = a.w;
      ch = cw / aspect;
    }
    const x = Math.min(Math.max(0, cx - cw / 2), a.w - cw);
    const y = Math.min(Math.max(0, cy - ch / 2), a.h - ch);
    return { x, y, w: cw, h: ch };
  }

  stampProps(a: Asset, variant: StampProps["variant"], sw: number, sh: number, frame?: StampProps["frame"]): StampProps {
    const f = frame ?? (a.kind === "bust" || a.kind === "figure" ? this.rng.pick(["oval", "rect"] as const) : "rect");
    // Picture window aspect ≈ stamp aspect after margins and bands.
    const aspect = (sw * 0.8) / (sh * 0.62);
    return {
      seed: this.rng.seed(),
      variant,
      frame: f,
      ink: this.stampInk(),
      country: this.rng.pick(countries),
      denomination: this.rng.pick(DENOMINATIONS),
      src: a.file,
      natW: a.w,
      natH: a.h,
      crop: this.stampCrop(a, aspect),
      sw,
      sh,
    };
  }

  /** Add a stamp layer centred at (cx, cy). */
  addStamp(a: Asset, variant: StampProps["variant"], cx: number, cy: number, sw: number, rotate: number, extra: Partial<StampProps> = {}): Layer {
    const landscape = a.kind === "vignette" || (a.kind !== "bust" && a.kind !== "figure" && a.w > a.h * 1.2);
    const sh = landscape ? sw * 0.8 : sw * 1.22;
    const p = { ...this.stampProps(a, variant, landscape ? sw * 1.2 : sw, sh), ...extra };
    const fp = stampFootprint(variant, p.sw, p.sh);
    return this.add("stamp", { x: cx - fp.w / 2, y: cy - fp.h / 2, w: fp.w, h: fp.h, rotate }, p as unknown as Record<string, unknown>, a.id);
  }

  /** A stamp picture source: portraits first, then vignettes, animals, anything. */
  stampSource(prefer: AssetKind[] = ["bust"]): Asset | undefined {
    return (
      this.take(prefer, { stampable: true, ...(prefer.includes("bust") ? { headBox: true } : {}) }) ??
      this.take(["bust", "vignette"], { stampable: true }) ??
      this.take(["animal", "botanical", "insect"], { stampable: true })
    );
  }

  postmarkDate(): string {
    const d = new Date(this.input.sentAt);
    const mon = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][d.getUTCMonth()];
    return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}`;
  }

  /** Circular date stamp whose ring sits on (cx, cy); bars run toward `side`. */
  addPostmark(cx: number, cy: number, side: "left" | "right", rotate = this.rot(10)): Layer {
    const r = this.rng.range(46, 56) * this.k;
    const barLen = this.rng.range(150, 230) * this.k;
    const w = r * 2 + 6 + barLen;
    const h = r * 2 + 8;
    const p: PostmarkProps = {
      seed: this.rng.seed(),
      ink: this.rng.pick(this.postmarkInks),
      city: this.input.senderCity || "Poste",
      date: this.postmarkDate(),
      bars: this.rng.int(5, 7),
      barsSide: side,
      r,
      pressure: this.rng.range(0.25, 0.9),
    };
    // Ring centre: r+2 from the box edge on the ring's side.
    const ringX = side === "right" ? r + 2 : w - r - 2;
    return this.add("postmark", { x: cx - ringX, y: cy - h / 2, w, h, rotate }, p as unknown as Record<string, unknown>);
  }

  addLabel(type: LabelProps["type"], x: number, y: number, rotate = this.rot(5)): Layer {
    const s = LABEL_SIZES[type];
    const p: LabelProps = { seed: this.rng.seed(), type, number: String(this.rng.int(1000, 99999)).padStart(5, "0") };
    return this.add("label", { x, y, w: s.w * this.k, h: s.h * this.k, rotate }, p as unknown as Record<string, unknown>);
  }

  /** Tape across a point, at an angle that reads as "holding something down". */
  addTape(cx: number, cy: number, len?: number, angle?: number): Layer {
    const w = (len ?? this.rng.range(120, 190)) * this.k;
    const h = this.rng.range(30, 40) * this.k;
    const p: TapeProps = {
      seed: this.rng.seed(),
      pattern: this.rng.weighted([
        ["plain", 3],
        ["stripes", 2],
        ["dots", 2],
        ["grid", 1],
        ["kraft", 2],
      ] as const),
      color: this.rng.pick(TAPE_COLORS),
      opacity: this.rng.range(0.6, 0.78),
    };
    return this.add("tape", { x: cx - w / 2, y: cy - h / 2, w, h, rotate: angle ?? this.rng.pick([-1, 1]) * this.rng.range(25, 50) }, p as unknown as Record<string, unknown>);
  }

  /** Tape over one corner of a layer. */
  tapeCorner(l: Layer, corner = this.rng.int(0, 3)) {
    const b = bounds(l);
    const cx = corner % 2 === 0 ? b.x + 12 : b.x + b.w - 12;
    const cy = corner < 2 ? b.y + 10 : b.y + b.h - 10;
    const sign = (corner === 0 || corner === 3 ? -1 : 1) * this.rng.range(30, 50);
    return this.addTape(cx, cy, this.rng.range(90, 130), sign);
  }

  addTicket(x: number, y: number, rotate = this.rot(8)): Layer {
    const tag = this.rng.chance(0.4);
    const text = this.rng.pick(tag ? phrases.tag : phrases.ticket);
    const w = (tag ? 170 : 190) * this.k;
    const h = (tag ? 76 : 70) * this.k;
    const p: TicketProps & { draw: "ticket" } = {
      draw: "ticket",
      seed: this.rng.seed(),
      shape: tag ? "tag" : "ticket",
      text,
      number: String(this.rng.int(1, 99999)).padStart(5, "0"),
      color: this.rng.pick(["#efe3c4", "#e9c9c3", "#cfe0cc", "#f2e6a8", "#d9d3e8", "#f3efe4"]),
    };
    return this.add("scrap", { x, y, w, h, rotate }, p as unknown as Record<string, unknown>);
  }

  /** A torn piece of an ephemera background (map, ledger, sheet music). */
  addScrap(region: Box, w: number, h: number, avoid: Box[] = []): Layer | undefined {
    const a = this.take(["ephemera"]);
    if (!a) return undefined;
    const scale = Math.max(w / a.w, h / a.h) * this.rng.range(1.1, 1.8);
    const p: ScrapProps = {
      seed: this.rng.seed(),
      src: a.file,
      natW: a.w,
      natH: a.h,
      cropX: this.rng.range(0, Math.max(0, a.w - w / scale)),
      cropY: this.rng.range(0, Math.max(0, a.h - h / scale)),
      scale,
    };
    const rotate = this.rot(7);
    const spot = this.place(w, h, region, avoid, 30, rotate);
    return this.add("scrap", { x: spot.x, y: spot.y, w, h, rotate }, p as unknown as Record<string, unknown>, a.id);
  }

  /** A library image drawn at height `h` (or width, for wide things) at its natural aspect. */
  addCutout(a: Asset, x: number, y: number, w: number, h: number, rotate: number, extra: Partial<CutoutProps> = {}): Layer {
    const p: CutoutProps = { src: a.file, border: 3, flip: false, shadow: "far", rect: !a.cutout, seed: this.rng.seed(), ...extra };
    return this.add("cutout", { x, y, w, h, rotate }, p as unknown as Record<string, unknown>, a.id);
  }

  count() {
    return this.layers.length;
  }
}
