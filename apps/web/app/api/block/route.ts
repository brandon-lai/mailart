import { NextResponse } from "next/server";
import { blockEmail, getLetter, hasDatabase, readBlockToken } from "@mailart/db";
import { SITE_URL } from "@/lib/config";

/**
 * POST: block. Serves both the confirm button on /block and RFC 8058 one-click
 * unsubscribe (mail clients POST "List-Unsubscribe=One-Click" to this URL).
 * GET never changes anything: link scanners fetch URLs, so it only redirects
 * to the confirmation page.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  if (!token) {
    const form = await req.formData().catch(() => null);
    token = String(form?.get("token") ?? "");
  }
  const id = readBlockToken(token);
  if (!id || !hasDatabase()) return NextResponse.json({ error: "invalid link" }, { status: 400 });
  const letter = await getLetter(id);
  if (!letter) return NextResponse.json({ error: "invalid link" }, { status: 400 });
  await blockEmail(letter.recipientEmail);
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("text/html")) return NextResponse.redirect(`${SITE_URL}/block?done=1`, 303);
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return NextResponse.redirect(`${SITE_URL}/block?token=${encodeURIComponent(token)}`, 302);
}
