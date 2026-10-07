import nodemailer from "nodemailer";

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
};

type Provider = "mailpit" | "resend" | "postmark";

export function emailConfigured(): { ok: true; provider: Provider } | { ok: false; reason: string } {
  const p = (process.env.EMAIL_PROVIDER || "mailpit") as Provider;
  if (!["mailpit", "resend", "postmark"].includes(p)) return { ok: false, reason: `unknown EMAIL_PROVIDER ${p}` };
  if (p !== "mailpit" && !process.env.EMAIL_API_KEY) return { ok: false, reason: `EMAIL_PROVIDER=${p} needs EMAIL_API_KEY` };
  // Mailpit catches everything locally. It is never a real delivery path, so a
  // deployed site with no provider must refuse rather than pretend to send.
  if (p === "mailpit" && process.env.VERCEL) return { ok: false, reason: "no email provider configured for this deployment" };
  return { ok: true, provider: p };
}

/** Send through whichever provider is configured. Returns the provider's message id. */
export async function sendEmail(m: OutgoingEmail): Promise<string> {
  const cfg = emailConfigured();
  if (!cfg.ok) throw new Error(cfg.reason);
  if (cfg.provider === "mailpit") {
    const t = nodemailer.createTransport({ host: process.env.MAILPIT_HOST || "localhost", port: Number(process.env.MAILPIT_PORT || 1025), secure: false });
    const info = await t.sendMail({ from: m.from, to: m.to, replyTo: m.replyTo, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
    return info.messageId;
  }
  if (cfg.provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.EMAIL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], reply_to: m.replyTo, subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return ((await res.json()) as { id: string }).id;
  }
  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: { "X-Postmark-Server-Token": process.env.EMAIL_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      From: m.from,
      To: m.to,
      ReplyTo: m.replyTo,
      Subject: m.subject,
      HtmlBody: m.html,
      TextBody: m.text,
      Headers: Object.entries(m.headers).map(([Name, Value]) => ({ Name, Value })),
      MessageStream: "outbound",
      TrackOpens: false, // no open-tracking pixels
    }),
  });
  if (!res.ok) throw new Error(`postmark ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { MessageID: string }).MessageID;
}
