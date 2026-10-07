"use client";

import type { EnvelopeSpec } from "@mailart/envelope";
import Stage from "@/components/Stage";

export default function RenderStage({ spec, body, tilt }: { spec: EnvelopeSpec; body: string; tilt: boolean }) {
  return (
    <div id="ma-render" style={{ position: "absolute", left: 0, top: 0 }}>
      <Stage spec={spec} body={body} mode="render" fit={false} tilt={tilt} />
    </div>
  );
}
