import { hash32 } from "./prng";
import type { EnvelopeSpec, Layer } from "./types";
import { type Ctx, n } from "./svg";
import { drawFlapInside, drawPaper, flapPath } from "./generators/paper";
import { drawStamp, type StampProps } from "./generators/stamp";
import { drawLabel, drawPostmark, type LabelProps, type PostmarkProps } from "./generators/postmark";
import { drawAddress, type AddressProps } from "./generators/address";
import {
  drawCutout,
  drawScrap,
  drawTape,
  drawTicket,
  type CutoutProps,
  type ScrapProps,
  type TapeProps,
  type TicketProps,
} from "./generators/ephemera";

export type RenderOptions = {
  /** Base URL for library files, e.g. "/lib/" or "https://cdn.example.com/lib/". */
  assetBase: string;
};

export type RenderedEnvelope = {
  w: number;
  h: number;
  front: string; // full <svg> for the envelope face
  flap: string; // full <svg> for the flap's inside face, hanging from y=0
  flapDepth: number;
  assets: string[]; // every image URL, so callers can preload and decode
};

function sharedDefs(uid: string): string {
  return `
<filter id="${uid}-shadow" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="1.2" dy="2.2" stdDeviation="1.8" flood-color="#2a1a0a" flood-opacity="0.32"/></filter>
<filter id="${uid}-cut-near" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
<feMorphology in="SourceAlpha" operator="dilate" radius="2.5" result="grown"/>
<feComponentTransfer in="grown" result="solid"><feFuncA type="discrete" tableValues="0 1 1 1 1"/></feComponentTransfer>
<feFlood flood-color="#fbf8f0"/><feComposite in2="solid" operator="in" result="border"/>
<feGaussianBlur in="solid" stdDeviation="2" result="blur"/><feOffset dx="1.5" dy="2.5" result="off"/>
<feComponentTransfer in="off" result="shadow"><feFuncA type="linear" slope="0.38"/></feComponentTransfer>
<feMerge><feMergeNode in="shadow"/><feMergeNode in="border"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="${uid}-cut-far" x="-12%" y="-8%" width="124%" height="120%" color-interpolation-filters="sRGB">
<feMorphology in="SourceAlpha" operator="dilate" radius="3" result="grown"/>
<feComponentTransfer in="grown" result="solid"><feFuncA type="discrete" tableValues="0 1 1 1 1"/></feComponentTransfer>
<feFlood flood-color="#fbf8f0"/><feComposite in2="solid" operator="in" result="border"/>
<feGaussianBlur in="solid" stdDeviation="3.5" result="blur"/><feOffset dx="3" dy="5" result="off"/>
<feComponentTransfer in="off" result="shadow"><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
<feMerge><feMergeNode in="shadow"/><feMergeNode in="border"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`;
}

export function envelopeUid(spec: EnvelopeSpec): string {
  return "e" + hash32(`${spec.seed}|${spec.recipe}|${spec.layers.length}`).toString(36);
}

function drawLayer(l: Layer, ctx: Ctx): string {
  const p = l.props;
  switch (l.kind) {
    case "stamp": {
      const body = drawStamp(p as unknown as StampProps, ctx, l.id);
      // Stamps are paper stuck on paper: a small shadow. Framed ones hang, so a deeper one.
      return `<g filter="url(#${ctx.uid}-shadow)">${body}</g>`;
    }
    case "postmark":
      return drawPostmark(p as unknown as PostmarkProps, ctx, l.id, l.w, l.h);
    case "label": {
      const lp = p as unknown as LabelProps;
      const body = drawLabel(lp, ctx, l.id, l.w, l.h);
      return lp.type === "printed-matter" ? body : `<g filter="url(#${ctx.uid}-shadow)">${body}</g>`;
    }
    case "address":
      return drawAddress(p as unknown as AddressProps, ctx, l.w, l.h);
    case "tape":
      return drawTape(p as unknown as TapeProps, ctx, l.id, l.w, l.h);
    case "scrap":
      if (p.draw === "ticket") return `<g filter="url(#${ctx.uid}-shadow)">${drawTicket(p as unknown as TicketProps, ctx, l.id, l.w, l.h)}</g>`;
      return drawScrap(p as unknown as ScrapProps, ctx, l.id, l.w, l.h);
    case "cutout":
      return drawCutout(p as unknown as CutoutProps, ctx, l.id, l.w, l.h);
  }
}

function layerSrcs(l: Layer): string[] {
  const src = l.props.src;
  return typeof src === "string" ? [src] : [];
}

export function renderEnvelope(spec: EnvelopeSpec, opts: RenderOptions): RenderedEnvelope {
  const { w, h } = spec.size;
  const uid = envelopeUid(spec);
  const base = opts.assetBase.endsWith("/") ? opts.assetBase : opts.assetBase + "/";
  const assetUrl = (file: string) => (/^(https?:|data:|\/)/.test(file) ? file : base + file);
  const ctx: Ctx = { uid, assetUrl, defs: [sharedDefs(uid)] };

  const body: string[] = [drawPaper(spec.paper, w, h, ctx)];
  for (const l of spec.layers) {
    const t = `translate(${n(l.x)},${n(l.y)})${l.rotate ? ` rotate(${n(l.rotate)} ${n(l.w / 2)} ${n(l.h / 2)})` : ""}`;
    body.push(`<g data-layer="${l.id}" data-kind="${l.kind}" transform="${t}">${drawLayer(l, ctx)}</g>`);
  }
  // Clip everything to the envelope. A crisp paper edge on top.
  const front =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" class="ma-front">` +
    `<defs>${ctx.defs.join("")}<clipPath id="${uid}-edge"><rect width="${w}" height="${h}" rx="5"/></clipPath></defs>` +
    `<g clip-path="url(#${uid}-edge)">${body.join("")}</g>` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="5" fill="none" stroke="#000" stroke-opacity="0.12"/></svg>`;

  const fctx: Ctx = { uid, assetUrl, defs: [] };
  const inside = drawFlapInside(spec.flap, w, fctx);
  const fd = Math.ceil(spec.flap.depth + 4);
  const flap =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${fd}" width="${w}" height="${fd}" class="ma-flap">` +
    `<defs>${fctx.defs.join("")}</defs>${inside}</svg>`;

  const assets = Array.from(new Set(spec.layers.flatMap(layerSrcs))).map(assetUrl);
  return { w, h, front, flap, flapDepth: spec.flap.depth, assets };
}

export { flapPath };
