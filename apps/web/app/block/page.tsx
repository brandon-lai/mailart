import Link from "next/link";
import { readBlockToken } from "@mailart/db";
import { SITE_NAME } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata = { title: "Block letters", robots: { index: false } };

/** Recipient opt-out. Showing the page changes nothing; the button does. */
export default async function Block({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token, done } = await searchParams;
  if (done) {
    return (
      <main className="wrap simple-page">
        <span className="wordmark">{SITE_NAME}</span>
        <h1>Done</h1>
        <p>You won&rsquo;t receive letters from {SITE_NAME} again. We keep only a scrambled fingerprint of your address, which is how we recognise it.</p>
      </main>
    );
  }
  const valid = !!(token && readBlockToken(token));
  return (
    <main className="wrap simple-page">
      <Link href="/" className="wordmark">{SITE_NAME}</Link>
      <h1>Block future letters</h1>
      {valid ? (
        <>
          <p>Confirm and no one will be able to send you a letter through {SITE_NAME} again. Senders won&rsquo;t be told.</p>
          <form method="post" action={`/api/block?token=${encodeURIComponent(token!)}`}>
            <button className="btn" type="submit">Block letters to me</button>
          </form>
        </>
      ) : (
        <p>This link isn&rsquo;t valid. Use the &ldquo;Block future letters&rdquo; link at the bottom of the email you received.</p>
      )}
    </main>
  );
}
