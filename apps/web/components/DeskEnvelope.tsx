"use client";

import Link from "next/link";
import type { EnvelopeSpec } from "@mailart/envelope";
import { EnvelopeFront } from "./Stage";

/** The hero: one sample envelope lying on the desk, a letter half out from under it. */
export default function DeskEnvelope({ spec, slug }: { spec: EnvelopeSpec; slug: string }) {
  return (
    <Link href={`/l/${slug}`} className="desk-link" aria-label="Open a sample letter">
      <div className="desk-sheet" />
      <div className="desk-front">
        <EnvelopeFront spec={spec} />
      </div>
    </Link>
  );
}
