import Link from "next/link";
import { consumeVerificationToken, hasDatabase, queueLetter } from "@mailart/db";
import { SITE_NAME } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirm your email", robots: { index: false } };

/** GET /verify?token= : marks the sender verified, queues the render, says so. */
export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let title = "That link doesn't work";
  let body = "It may have been copied incompletely. Try clicking it again from the email.";
  if (!hasDatabase()) {
    body = "This deployment has no database, so there is nothing to confirm here.";
  } else if (token) {
    const r = await consumeVerificationToken(token);
    if (r.ok) {
      await queueLetter(r.letterId);
      title = "Your letter is on its way";
      body = "Thanks for confirming. We're sealing and stamping it now; it will be in their inbox in a minute or two. Future letters from this address go straight out.";
    } else if (r.reason === "expired") {
      body = "The link expired after 24 hours, so the letter wasn't sent. Write it again and we'll send a fresh link.";
    } else if (r.reason === "used") {
      title = "Already confirmed";
      body = "This link has been used, and the letter went out then.";
    }
  }
  return (
    <main className="wrap simple-page">
      <Link href="/" className="wordmark">{SITE_NAME}</Link>
      <h1>{title}</h1>
      <p>{body}</p>
      <Link href="/" className="btn ghost">Write a letter</Link>
    </main>
  );
}
