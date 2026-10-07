import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { composeEnvelope, defaultLibrary, type EnvelopeSpec } from "@mailart/envelope";
import { getLetter, hasDatabase } from "@mailart/db";
import { sampleBySlug, sampleSpec } from "@/lib/samples";
import RenderStage from "./RenderStage";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function authorised(given: string | null) {
  const want = process.env.WORKER_SECRET || (process.env.NODE_ENV !== "production" ? "dev-worker-secret" : "");
  if (!want || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

const CHECK_BODY = "Dear friend,\n\nThis is a test of the envelope renderer.";

/**
 * The page the render worker screenshots. Requires the worker secret header.
 * ids: a letter uuid; "sample:<slug>" for a demo letter; "seed:<seed>" for a
 * synthetic envelope (the worker's acceptance check, no database needed).
 */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tilt?: string }> }) {
  const h = await headers();
  if (!authorised(h.get("x-worker-secret"))) notFound();
  const { id } = await params;
  let spec: EnvelopeSpec;
  let body: string;
  if (id.startsWith("sample%3A") || id.startsWith("sample:")) {
    const s = sampleBySlug(decodeURIComponent(id).slice(7));
    if (!s) notFound();
    spec = sampleSpec(s);
    body = s.body;
  } else if (id.startsWith("seed%3A") || id.startsWith("seed:")) {
    const seed = decodeURIComponent(id).slice(5);
    spec = composeEnvelope({ seed, recipientName: "Rosalind Fairweather", addressLine: seed.length % 2 ? "c/o the 4th floor" : undefined, senderCity: "Valparaíso", sentAt: "2026-10-07T12:00:00Z" }, defaultLibrary);
    body = CHECK_BODY;
  } else {
    if (!hasDatabase()) notFound();
    const l = await getLetter(id);
    if (!l || !l.envelopeSpec) notFound();
    spec = l.envelopeSpec as EnvelopeSpec;
    body = l.body;
  }
  // The GIF drops the settle tilt (shadow shift stays): measured, the tilt moves
  // every envelope pixel for six frames and more than doubles the file, forcing
  // 600 px and pushing square envelopes past 1 MB. ?tilt=1 restores it.
  const tilt = (await searchParams).tilt === "1";
  return <RenderStage spec={spec} body={body} tilt={tilt} />;
}
