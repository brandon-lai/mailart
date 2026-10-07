import { describe, expect, it } from "vitest";
import {
  addressViolations,
  bounds,
  composeEnvelope,
  defaultLibrary,
  inPostage,
  MAX_ADDRESS_COVER,
  MAX_ELEMENTS,
  MIN_ELEMENTS,
  overlap,
  renderEnvelope,
  RECIPES,
  type EnvelopeInput,
} from "../src";

const NAMES = ["Margaret Okafor", "Theo", "Rosalind Fairweather-Hughes", "Wen Li", "Mr. J. Whitcombe", "A", "Dear Old Felix the Third of Ely"];
const input = (i: number, extra: Partial<EnvelopeInput> = {}): EnvelopeInput => ({
  seed: `test-${i}`,
  recipientName: NAMES[i % NAMES.length],
  addressLine: i % 3 === 0 ? "c/o the 4th floor" : undefined,
  senderCity: ["Lisbon", "Toronto", "Valparaíso"][i % 3],
  sentAt: "2026-10-07T12:00:00Z",
  ...extra,
});

const SEEDS = Array.from({ length: 500 }, (_, i) => i);
const specs = SEEDS.map((i) => composeEnvelope(input(i), defaultLibrary));

describe("determinism", () => {
  it("same seed and letter data give an identical spec", () => {
    for (const i of [0, 7, 99, 321]) {
      expect(JSON.stringify(composeEnvelope(input(i), defaultLibrary))).toBe(JSON.stringify(specs[i]));
    }
  });
  it("same spec renders identical markup", () => {
    const a = renderEnvelope(specs[5], { assetBase: "/lib/" });
    const b = renderEnvelope(composeEnvelope(input(5), defaultLibrary), { assetBase: "/lib/" });
    expect(a.front).toBe(b.front);
    expect(a.flap).toBe(b.flap);
  });
  it("different seeds give different envelopes", () => {
    expect(new Set(specs.map((s) => JSON.stringify(s.layers))).size).toBe(specs.length);
  });
  it("never calls Math.random", () => {
    const orig = Math.random;
    Math.random = () => {
      throw new Error("Math.random called");
    };
    try {
      composeEnvelope(input(1234), defaultLibrary);
      renderEnvelope(specs[0], { assetBase: "/lib/" });
    } finally {
      Math.random = orig;
    }
  });
});

describe("layout rules across 500 seeds", () => {
  it("address protection is never broken", () => {
    for (const s of specs) {
      const v = addressViolations(s.layers);
      expect(v.blocked.map((l) => `${s.seed}:${l.kind}`)).toEqual([]);
      expect(v.coverRatio).toBeLessThanOrEqual(MAX_ADDRESS_COVER);
    }
  });
  it("every envelope has exactly one address, inside the paper", () => {
    for (const s of specs) {
      const a = s.layers.filter((l) => l.kind === "address");
      expect(a).toHaveLength(1);
      const b = bounds(a[0]);
      expect(b.x).toBeGreaterThanOrEqual(-2);
      expect(b.x + b.w).toBeLessThanOrEqual(s.size.w + 2);
      expect(b.y + b.h).toBeLessThanOrEqual(s.size.h + 2);
    }
  });
  it("no asset repeats within an envelope", () => {
    for (const s of specs) {
      const ids = s.layers.map((l) => l.assetId).filter(Boolean);
      expect(new Set(ids).size, s.seed).toBe(ids.length);
    }
  });
  it("element count stays between 6 and 14", () => {
    for (const s of specs) {
      expect(s.layers.length, s.seed).toBeGreaterThanOrEqual(MIN_ELEMENTS);
      expect(s.layers.length, s.seed).toBeLessThanOrEqual(MAX_ELEMENTS);
    }
  });
  it("rotations stay within ±8°, except tape", () => {
    for (const s of specs) for (const l of s.layers) if (l.kind !== "tape") expect(Math.abs(l.rotate)).toBeLessThanOrEqual(8);
  });
  it("a stamp sits in the postage zone with a postmark on it", () => {
    for (const s of specs) {
      const P = { postage: { x: s.size.w - 340, y: 18, w: 322, h: s.size.h > 600 ? 270 : 210 } };
      const corner = s.layers.filter((l) => l.kind === "stamp" && inPostage(P, l));
      expect(corner.length, s.seed).toBeGreaterThan(0);
      const marked = corner.some((st) => s.layers.some((l) => l.kind === "postmark" && overlap(bounds(l), bounds(st)) > 0));
      expect(marked, s.seed).toBe(true);
    }
  });
  it("layers are ordered paper → scraps → address → cut-outs → stamps → labels → postmarks → tape", () => {
    const order = ["scrap", "address", "cutout", "stamp", "label", "postmark", "tape"];
    for (const s of specs) {
      const idx = s.layers.map((l) => order.indexOf(l.kind));
      expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    }
  });
  it("stamp and postmark inks come from one family", () => {
    const cool = new Set(["ultramarine", "violet", "green"]);
    for (const s of specs) {
      const inks = s.layers.filter((l) => l.kind === "stamp").map((l) => l.props.ink as string);
      const pms = s.layers.filter((l) => l.kind === "postmark").map((l) => l.props.ink as string);
      const isCool = inks.length ? cool.has(inks[0]) : true;
      for (const k of inks) expect(cool.has(k)).toBe(isCool);
      for (const p of pms) expect(isCool ? ["black", "violet"] : ["black", "red"]).toContain(p);
    }
  });
  it("every recipe appears, and a forced recipe is honoured", () => {
    const seen = new Set(specs.map((s) => s.recipe));
    for (const r of RECIPES) expect(seen.has(r)).toBe(true);
    for (const r of RECIPES) {
      const forced = Array.from({ length: 20 }, (_, i) => composeEnvelope(input(i, { recipe: r }), defaultLibrary).recipe);
      expect(forced.filter((x) => x === r).length).toBeGreaterThanOrEqual(18);
    }
  });
  it("never draws the recipient email: it is not an input", () => {
    const s = composeEnvelope({ ...input(3), recipientName: "Ann" }, defaultLibrary);
    expect(JSON.stringify(s)).not.toMatch(/@/);
  });
  it("caps names drawn on the envelope at 40 characters", () => {
    const s = composeEnvelope(input(1, { recipientName: "x".repeat(80) }), defaultLibrary);
    const a = s.layers.find((l) => l.kind === "address")!;
    const lines = a.props.lines as { text: string }[];
    expect(lines[0].text.length).toBe(40);
  });
});
