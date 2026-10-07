import { Rng } from "./prng";
import type { EnvelopeInput, EnvelopeSpec, Layer, Library, RecipeId, SizeId } from "./types";
import { RECIPES } from "./types";
import { Builder, LAYER_ORDER, MAX_ADDRESS_COVER, MAX_ELEMENTS, MIN_ELEMENTS, bounds, overlap } from "./builder";
import { RECIPE_TABLE } from "./recipes";
import { SIZES, flapSpec, paperSpec } from "./generators/paper";

export const NAME_MAX = 40;

/** Which recipes this library can actually produce. */
export function eligibleRecipes(library: Library): RecipeId[] {
  return RECIPES.filter((r) => RECIPE_TABLE[r].eligible(library));
}

/**
 * Seed + letter data in, EnvelopeSpec out. Pure and deterministic: no clock,
 * no Math.random, no I/O. The spec is what gets stored and drawn everywhere.
 */
export function composeEnvelope(input: EnvelopeInput, library: Library): EnvelopeSpec {
  const clean: EnvelopeInput = {
    ...input,
    recipientName: input.recipientName.trim().slice(0, NAME_MAX),
    addressLine: input.addressLine?.trim().slice(0, NAME_MAX) || undefined,
  };
  const rng = new Rng(`envelope|${clean.seed}`);
  const eligible = eligibleRecipes(library);
  if (!eligible.length) throw new Error("asset library cannot produce any recipe");
  const recipeId = clean.recipe && eligible.includes(clean.recipe) ? clean.recipe : rng.pick(eligible);
  const recipe = RECIPE_TABLE[recipeId];
  // Gallery and specimen want room for their set pieces; the others vary.
  const sizeId: SizeId = recipeId === "gallery" ? rng.weighted([["square", 3], ["business", 2]] as const) : rng.weighted([["business", 3], ["square", 2]] as const);
  const { w, h } = SIZES[sizeId];

  const b = new Builder(clean, library, w, h, rng);
  const stock = recipe.stock(b);
  const paper = paperSpec(rng, w, h, sizeId, stock);
  const flap = flapSpec(rng, paper, h);
  recipe.build(b);
  const finalRecipe = b.recipeOverride ?? recipeId;

  enforceRules(b);

  const layers = sortLayers(b.layers);
  return {
    version: 1,
    recipe: finalRecipe,
    seed: clean.seed,
    size: { w, h },
    paper,
    flap,
    layers: layers.map(roundLayer),
  };
}

/** Bottom-to-top by kind; within a kind, insertion order. */
function sortLayers(layers: Layer[]): Layer[] {
  return layers
    .map((l, i) => ({ l, i }))
    .sort((a, b) => LAYER_ORDER.indexOf(a.l.kind) - LAYER_ORDER.indexOf(b.l.kind) || a.i - b.i)
    .map(({ l }) => l);
}

const r2 = (v: number) => Math.round(v * 100) / 100;
function roundLayer(l: Layer): Layer {
  return { ...l, x: r2(l.x), y: r2(l.y), w: r2(l.w), h: r2(l.h), rotate: r2(l.rotate) };
}

/** May this kind be drawn over the address? Only postmarks and tape. */
const mayCoverAddress = (l: Layer) => l.kind === "postmark" || l.kind === "tape";
/** Layers drawn above the address in the fixed layer order. */
const drawnAbove = (l: Layer) => LAYER_ORDER.indexOf(l.kind) > LAYER_ORDER.indexOf("address");

export function addressViolations(layers: Layer[]): { blocked: Layer[]; coverRatio: number } {
  const addr = layers.find((l) => l.kind === "address");
  if (!addr) return { blocked: [], coverRatio: 0 };
  const box = bounds(addr);
  const area = box.w * box.h;
  const blocked: Layer[] = [];
  let covered = 0;
  for (const l of layers) {
    if (l === addr || !drawnAbove(l)) continue;
    const o = overlap(bounds(l), box);
    if (o <= 0) continue;
    if (mayCoverAddress(l)) covered += o;
    else blocked.push(l);
  }
  return { blocked, coverRatio: covered / area };
}

/**
 * Layout rules that hold for every recipe, checked after the recipe runs:
 * address protection (2), postage-zone stamp + postmark (3), element count
 * and rotation bounds (5). Repairs remove optional elements rather than
 * shifting them, so the result stays deterministic and simple to reason about.
 */
function enforceRules(b: Builder) {
  // Rule 3: a stamp in the postage zone with a postmark on it. Recipes aim for
  // this by construction; when geometry defeats them, a plain stamp goes in the corner.
  if (!b.layers.some((l) => l.kind === "stamp" && inPostage(b, l))) {
    const src = b.stampSource(["vignette", "bust"]);
    if (src) {
      const S = 78 * b.k;
      b.addStamp(src, "single", b.W - 40 - S / 2, 30 + S * 0.61, S, b.rot(4));
    }
  }
  const corner = b.layers.find((l) => l.kind === "stamp" && inPostage(b, l));
  if (corner && !b.layers.some((l) => l.kind === "postmark" && overlap(bounds(l), bounds(corner)) > 0)) {
    const cb = bounds(corner);
    b.addPostmark(cb.x + cb.w * 0.2, cb.y + cb.h * 0.75, "left");
  }
  // Rule 2: nothing but postmarks and tape over the address, and those ≤ 15%.
  let v = addressViolations(b.layers);
  for (const l of v.blocked) b.remove(l);
  v = addressViolations(b.layers);
  const addr = b.address;
  while (addr && v.coverRatio > MAX_ADDRESS_COVER) {
    const box = bounds(addr);
    const worst = b.layers
      .filter(mayCoverAddress)
      .map((l) => ({ l, o: overlap(bounds(l), box) }))
      .sort((a, c) => c.o - a.o)[0];
    if (!worst || worst.o === 0) break;
    if (worst.l.kind === "postmark") {
      // Slide the postmark up out of the way rather than lose the cancellation.
      worst.l.y = Math.max(-worst.l.h / 3, box.y - worst.l.h - 4);
      if (overlap(bounds(worst.l), box) > 0) b.remove(worst.l);
    } else b.remove(worst.l);
    v = addressViolations(b.layers);
  }

  // Rule 5: rotation bounds (tape is exempt).
  for (const l of b.layers) {
    if (l.kind !== "tape") l.rotate = Math.max(-8, Math.min(8, l.rotate));
  }

  // Rule 5: element count. Trim optional extras first, newest first.
  const optionalOrder: Layer["kind"][] = ["tape", "label", "scrap"];
  for (const kind of optionalOrder) {
    while (b.count() > MAX_ELEMENTS) {
      const extra = [...b.layers].reverse().find((l) => l.kind === kind && !(kind === "label" && l.props.type === "specimen"));
      if (!extra) break;
      b.remove(extra);
    }
  }
  while (b.count() > MAX_ELEMENTS) {
    const s = [...b.layers].reverse().find((l) => l.kind === "stamp" && !inPostage(b, l));
    if (!s) break;
    b.remove(s);
  }
  let guard = 0;
  while (b.count() < MIN_ELEMENTS && guard++ < 12) {
    const P = { x: 30, y: 24, w: b.W * 0.45, h: b.H * 0.4 };
    const avoid = b.occupied();
    const s = b.place(190 * b.k, 70 * b.k, P, avoid, 30);
    const t = b.addTicket(s.x, s.y);
    if (addressViolations(b.layers).blocked.includes(t)) b.remove(t);
  }

}

export function inPostage(b: { postage: { x: number; y: number; w: number; h: number } }, l: Layer): boolean {
  const lb = bounds(l);
  const cx = lb.x + lb.w / 2;
  const cy = lb.y + lb.h / 2;
  const P = b.postage;
  return cx >= P.x && cx <= P.x + P.w && cy >= P.y && cy <= P.y + P.h;
}
