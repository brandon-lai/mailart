"use client";

import { useCallback, useRef, useState } from "react";
import type { EnvelopeSpec } from "@mailart/envelope";
import Stage, { STAGE_W, stageGeometry } from "@/components/Stage";
import { playPaper } from "@/lib/paperSound";

/**
 * Closed envelope PNG first (fast, matches the email). The live stage is
 * already mounted underneath at t=0, so the tap swaps pictures without a jump,
 * then plays the opening and reveals the letter on paper.
 */
export default function LetterView({ spec, png, body, senderName, paragraphs }: { spec: EnvelopeSpec; png: string | null; body: string; senderName: string; paragraphs: string[][] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const onDone = useCallback(() => {
    setDone(true);
    setTimeout(() => sheet.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  }, []);
  // The PNG covers exactly the envelope's box inside the stage, so the swap is invisible.
  const g = stageGeometry(spec);
  const pngBox = { left: `${(g.left / STAGE_W) * 100}%`, width: `${(g.ew / STAGE_W) * 100}%`, top: `${(g.top / g.fh) * 100}%` };
  const tap = () => {
    if (open) return;
    setOpen(true);
    playPaper();
  };
  return (
    <>
      <section className="wrap letter-stage">
        <button className={`env-tap ${open ? "opened" : ""} ${png ? "has-png" : ""}`} onClick={tap} aria-label="Tap to open the envelope" disabled={open}>
          <Stage spec={spec} body={body} mode="play" open={open} onDone={onDone} />
          {png && !open && (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="env-png" src={png} alt="A closed envelope" style={pngBox} />
          )}
        </button>
        <p className={`tap-hint kicker ${open ? "gone" : ""}`}>Tap to open</p>
      </section>
      <section className={`wrap letter-sheet-wrap ${done ? "shown" : ""}`} aria-hidden={!done}>
        <div ref={sheet} className="letter-sheet">
          {paragraphs.map((lines, i) => (
            <p key={i}>
              {lines.map((l, j) => (
                <span key={j}>
                  {l}
                  {j < lines.length - 1 ? <br /> : null}
                </span>
              ))}
            </p>
          ))}
          <p className="signoff">{senderName}</p>
        </div>
      </section>
    </>
  );
}
