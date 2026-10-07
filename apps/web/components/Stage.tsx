"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { renderEnvelope, type EnvelopeSpec } from "@mailart/envelope";

/** Stage geometry, in stage pixels. The GIF frame is exactly this box. */
export const STAGE_W = 1200;
const ENV_W = 1000;
export const DURATION = 2400;

export function stageGeometry(spec: EnvelopeSpec) {
  const es = ENV_W / spec.size.w;
  const eh = Math.round(spec.size.h * es);
  // About 1.6x the envelope height, room for the flap and the letter above it.
  const fh = Math.round(eh * 1.6 + 60);
  const top = fh - 40 - eh;
  const left = (STAGE_W - ENV_W) / 2;
  return { es, ew: ENV_W, eh, fh, top, left, flapH: Math.ceil((spec.flap.depth + 4) * es), rise: Math.round(eh * 0.56) };
}

/** First line of the letter, as typed on the sheet that slides out. */
export function firstLine(body: string) {
  const line = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > 52 ? line.slice(0, 50).trimEnd() + "…" : line;
}

type Props = {
  spec: EnvelopeSpec;
  body: string;
  assetBase?: string;
  /** "render": paused, driven by the worker via window.__ma. "play": runs once when `open` becomes true. */
  mode: "render" | "play" | "closed";
  open?: boolean;
  onDone?: () => void;
  /** Fit to container width (letter page) or draw at native size (render). */
  fit?: boolean;
  /** The settle tilt moves every envelope pixel for six frames: the GIF's biggest cost. */
  tilt?: boolean;
};

export default function Stage({ spec, body, assetBase = "/lib/", mode, open, onDone, fit = true, tilt = true }: Props) {
  const g = stageGeometry(spec);
  const r = useMemo(() => renderEnvelope(spec, { assetBase }), [spec, assetBase]);
  const outer = useRef<HTMLDivElement>(null);
  const env = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const flap = useRef<HTMLDivElement>(null);
  const letter = useRef<HTMLDivElement>(null);
  const anims = useRef<Animation[]>([]);
  const [scale, setScale] = useState(fit ? 0 : 1);

  // Measure synchronously before paint, then observe: waiting for the first
  // ResizeObserver callback leaves the stage blank for a frame (or forever headless).
  useLayoutEffect(() => {
    if (!fit || !outer.current) return;
    const el = outer.current;
    const measure = () => setScale(el.clientWidth / STAGE_W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Build the paused timeline once per spec.
  useEffect(() => {
    if (!env.current || !flap.current || !letter.current || !shadow.current) return;
    const t = (ms: number) => ms / DURATION;
    const opts: KeyframeAnimationOptions = { duration: DURATION, fill: "both", easing: "linear" };
    const a = [
      env.current.animate(
        [
          { offset: 0, transform: "translate(0px,0px) rotate(0deg)" },
          { offset: t(600), transform: "translate(0px,0px) rotate(0deg)", easing: "cubic-bezier(.3,.7,.3,1)" },
          { offset: t(1000), transform: tilt ? "translate(0px,-8px) rotate(-1.4deg)" : "translate(0px,0px) rotate(0deg)" },
          { offset: 1, transform: tilt ? "translate(0px,-8px) rotate(-1.4deg)" : "translate(0px,0px) rotate(0deg)" },
        ],
        opts,
      ),
      shadow.current.animate(
        [
          { offset: 0, transform: "translate(0px,10px) scale(1)", opacity: 0.55 },
          { offset: t(600), transform: "translate(0px,10px) scale(1)", opacity: 0.55, easing: "cubic-bezier(.3,.7,.3,1)" },
          { offset: t(1000), transform: "translate(10px,22px) scale(1.02)", opacity: 0.42 },
          { offset: 1, transform: "translate(10px,22px) scale(1.02)", opacity: 0.42 },
        ],
        opts,
      ),
      flap.current.animate(
        [
          { offset: 0, transform: "perspective(1800px) rotateX(0deg)" },
          { offset: t(1000), transform: "perspective(1800px) rotateX(0deg)", easing: "cubic-bezier(.45,0,.25,1)" },
          { offset: t(1600), transform: "perspective(1800px) rotateX(180deg)" },
          { offset: 1, transform: "perspective(1800px) rotateX(180deg)" },
        ],
        opts,
      ),
      letter.current.animate(
        [
          { offset: 0, transform: "translateY(0px)" },
          { offset: t(1600), transform: "translateY(0px)", easing: "cubic-bezier(.2,.75,.25,1)" },
          { offset: 1, transform: `translateY(${-g.rise}px)` },
        ],
        opts,
      ),
    ];
    a.forEach((x) => x.pause());
    anims.current = a;

    if (mode === "render") {
      const imgs = r.assets;
      const ready = Promise.all([
        document.fonts.ready,
        ...imgs.map((src) => {
          const im = new Image();
          im.src = src;
          return im.decode().catch(() => undefined);
        }),
      ]).then(
        () =>
          // Two frames so the SVG <image>s have painted from the decoded cache.
          new Promise<void>((res) => requestAnimationFrame(() => requestAnimationFrame(() => res()))),
      );
      (window as any).__ma = {
        duration: DURATION,
        ready,
        seek(ms: number) {
          for (const x of anims.current) x.currentTime = ms;
        },
        box: { width: STAGE_W, height: g.fh },
      };
    }
    return () => a.forEach((x) => x.cancel());
  }, [r, mode, g.rise, g.fh, tilt]);

  useEffect(() => {
    if (mode !== "play" || !open) return;
    const a = anims.current;
    a.forEach((x) => {
      x.currentTime = 0;
      x.play();
    });
    const done = a[0]?.finished.then(() => onDone?.()).catch(() => undefined);
    void done;
  }, [mode, open, onDone]);

  const line = firstLine(body);
  const stage = (
    <div className="ma-stage" style={{ width: STAGE_W, height: g.fh }}>
      <div ref={env} className="ma-envelope" style={{ left: g.left, top: g.top, width: g.ew, height: g.eh }}>
        <div ref={shadow} className="ma-shadow" />
        <div ref={flap} className="ma-flap ma-svg" style={{ height: g.flapH }} dangerouslySetInnerHTML={{ __html: r.flap }} />
        <div ref={letter} className="ma-letter" style={{ top: g.eh * 0.05, height: g.eh * 0.9 }}>
          <div className="ma-letter-line">{line}</div>
          <div className="ma-letter-rule" style={{ top: "38%" }} />
          <div className="ma-letter-rule" style={{ top: "48%" }} />
          <div className="ma-letter-rule" style={{ top: "58%" }} />
          <div className="ma-letter-fold" />
        </div>
        <div className="ma-front ma-svg" dangerouslySetInnerHTML={{ __html: r.front }} />
      </div>
    </div>
  );

  if (!fit) return stage;
  return (
    <div ref={outer} className="ma-stage-outer" style={{ height: scale ? g.fh * scale : undefined, aspectRatio: scale ? undefined : `${STAGE_W} / ${g.fh}` }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: "0 0", visibility: scale ? "visible" : "hidden" }}>{stage}</div>
    </div>
  );
}

/** Just the closed envelope front, sized to its container. */
export function EnvelopeFront({ spec, assetBase = "/lib/" }: { spec: EnvelopeSpec; assetBase?: string }) {
  const r = useMemo(() => renderEnvelope(spec, { assetBase }), [spec, assetBase]);
  return <div className="ma-env-static ma-svg"><div className="ma-front" dangerouslySetInnerHTML={{ __html: r.front }} /></div>;
}
