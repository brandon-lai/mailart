import type { Rng } from "./prng";

/** Round for output. Keeps markup small and identical across runtimes. */
export const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type Pt = [number, number];

/**
 * Points along a segment, displaced perpendicular to it by smoothed noise.
 * This is the torn/wobbly edge used by flaps, scraps and tape ends.
 */
export function wobble(rng: Rng, a: Pt, b: Pt, amp: number, step: number, roughness = 0.5): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.round(len / step));
  const nx = -dy / len;
  const ny = dx / len;
  const pts: Pt[] = [];
  let d = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Random walk pulled back toward zero, mixed with a little high-frequency jitter.
    d = d * (1 - roughness) + rng.gauss() * amp * roughness;
    const off = i === 0 || i === steps ? 0 : d + rng.gauss() * amp * 0.25;
    pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  return pts;
}

/** Jagged, torn edge: sharp zigzag rather than smooth wobble. */
export function torn(rng: Rng, a: Pt, b: Pt, depth: number, step: number): Pt[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.round(len / step));
  const nx = -dy / len;
  const ny = dx / len;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(1, Math.max(0, i / steps + (i > 0 && i < steps ? rng.range(-0.3, 0.3) / steps : 0)));
    const off = i === 0 || i === steps ? 0 : rng.range(-depth, depth);
    pts.push([a[0] + dx * t + nx * off, a[1] + dy * t + ny * off]);
  }
  return pts;
}

export const poly = (pts: Pt[]) => "M" + pts.map((p) => `${n(p[0])},${n(p[1])}`).join("L") + "Z";
export const line = (pts: Pt[]) => "M" + pts.map((p) => `${n(p[0])},${n(p[1])}`).join("L");

/** Closed path around a rectangle with each side wobbled/torn independently. */
export function roughRect(
  rng: Rng,
  w: number,
  h: number,
  edge: (a: Pt, b: Pt) => Pt[],
): string {
  const top = edge([0, 0], [w, 0]);
  const right = edge([w, 0], [w, h]);
  const bottom = edge([w, h], [0, h]);
  const left = edge([0, h], [0, 0]);
  return poly([...top.slice(0, -1), ...right.slice(0, -1), ...bottom.slice(0, -1), ...left.slice(0, -1)]);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round((v + (cb[i] - v) * t) * 255));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** feComponentTransfer tables that map luminance onto an ink-to-paper ramp. */
export function duotoneFilter(id: string, dark: string, light: string, contrast = 1.15): string {
  const d = hexToRgb(dark);
  const l = hexToRgb(light);
  const fn = (i: number) => `tableValues="${n(d[i])} ${n((d[i] + l[i]) / 2)} ${n(l[i])}"`;
  return `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
<feColorMatrix type="saturate" values="0"/>
<feComponentTransfer><feFuncR type="linear" slope="${contrast}" intercept="${n((1 - contrast) / 2)}"/><feFuncG type="linear" slope="${contrast}" intercept="${n((1 - contrast) / 2)}"/><feFuncB type="linear" slope="${contrast}" intercept="${n((1 - contrast) / 2)}"/></feComponentTransfer>
<feComponentTransfer><feFuncR type="table" ${fn(0)}/><feFuncG type="table" ${fn(1)}/><feFuncB type="table" ${fn(2)}/></feComponentTransfer>
</filter>`;
}

/** Generators receive this alongside their params: ids must be unique per envelope on a page. */
export type Ctx = {
  uid: string;
  assetUrl: (file: string) => string;
  defs: string[]; // generators push filters/patterns/clips here
};
