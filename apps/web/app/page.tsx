import Link from "next/link";
import { hasDatabase } from "@mailart/db";
import { emailConfigured } from "@mailart/emails";
import { SAMPLES, sampleSpec } from "@/lib/samples";
import { SITE_NAME } from "@/lib/config";
import Compose from "@/components/Compose";
import DeskEnvelope from "@/components/DeskEnvelope";

export default async function Home({ searchParams }: { searchParams: Promise<{ reply?: string }> }) {
  const { reply } = await searchParams;
  const canSend = hasDatabase() && emailConfigured().ok;
  const hero = SAMPLES[0];
  return (
    <main>
      <header className="wrap site-head">
        <Link href="/" className="wordmark">{SITE_NAME}</Link>
        <span className="kicker">letters by email, sealed &amp; stamped</span>
      </header>

      <section className="desk">
        <div className="wrap desk-inner">
          <div className="desk-copy">
            <h1>Write a letter.<br />We&rsquo;ll make the envelope.</h1>
            <p>
              Every letter arrives in a one-of-a-kind collage envelope built from public-domain prints and photographs.
              It opens in their inbox, and the letter is right there underneath.
            </p>
            <a href="#write" className="btn accent">Start writing</a>
          </div>
          <div className="desk-env">
            <DeskEnvelope spec={sampleSpec(hero)} slug={hero.slug} />
          </div>
        </div>
      </section>

      <section id="write" className="wrap compose-wrap">
        <Compose canSend={canSend} replyTo={reply} />
      </section>

      <section className="wrap samples">
        <h2>Letters already in the post</h2>
        <p className="muted">Three sample letters, rendered by the same pipeline that renders yours.</p>
        <div className="sample-row">
          {SAMPLES.map((s) => (
            <Link key={s.slug} href={`/l/${s.slug}`} className="sample-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/samples/${s.slug}.thumb.webp`} alt={`Envelope addressed to ${s.recipientName}`} loading="lazy" />
              <span className="kicker">from {s.senderName}, {s.senderCity}</span>
            </Link>
          ))}
        </div>
      </section>

      <footer className="wrap site-foot">
        <span>{SITE_NAME}. Envelope images from The Met and the Art Institute of Chicago open-access collections.</span>
        <span>No tracking pixels. Recipients can block all future letters in one click.</span>
      </footer>
    </main>
  );
}
