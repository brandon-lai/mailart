import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import type { EnvelopeSpec } from "@mailart/envelope";
import { getLetterBySlug, hasDatabase } from "@mailart/db";
import { paragraphs } from "@mailart/emails";
import { sampleBySlug, sampleSpec } from "@/lib/samples";
import { SITE_NAME, SITE_URL } from "@/lib/config";
import LetterView from "./LetterView";

export const dynamic = "force-dynamic";

type Shown = { senderName: string; body: string; spec: EnvelopeSpec; png: string | null; recipientName: string };

/** Never exposes the recipient's email: only the name drawn on the envelope. */
const load = cache(async (slug: string): Promise<Shown | null> => {
  const s = sampleBySlug(slug);
  if (s) return { senderName: s.senderName, body: s.body, spec: sampleSpec(s), png: `/samples/${s.slug}.png`, recipientName: s.recipientName };
  if (!hasDatabase()) return null;
  const row = await getLetterBySlug(slug);
  if (!row || !row.letter.envelopeSpec || row.letter.status !== "sent") return null;
  return { senderName: row.senderName, body: row.letter.body, spec: row.letter.envelopeSpec as EnvelopeSpec, png: row.letter.pngUrl, recipientName: row.letter.recipientName };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const l = await load((await params).slug);
  if (!l) return { robots: { index: false } };
  const title = `A letter from ${l.senderName}`;
  const image = l.png ? (l.png.startsWith("http") ? l.png : `${SITE_URL}${l.png}`) : undefined;
  return {
    title,
    description: `Sealed and stamped, sent with ${SITE_NAME}.`,
    robots: { index: false, follow: false },
    openGraph: { title, description: `Sealed and stamped, sent with ${SITE_NAME}.`, images: image ? [{ url: image, width: 1200 }] : [] },
    twitter: { card: "summary_large_image", title, images: image ? [image] : [] },
  };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const l = await load((await params).slug);
  if (!l) notFound();
  return (
    <main className="letter-page">
      <header className="wrap site-head">
        <Link href="/" className="wordmark">{SITE_NAME}</Link>
      </header>
      <LetterView spec={l.spec} png={l.png} body={l.body} senderName={l.senderName} paragraphs={paragraphs(l.body)} />
      <footer className="wrap site-foot letter-foot">
        <Link href={`/?reply=${encodeURIComponent(l.senderName)}#write`} className="btn">Write a letter back</Link>
      </footer>
    </main>
  );
}
