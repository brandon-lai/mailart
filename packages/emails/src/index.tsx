import React from "react";
import { render } from "@react-email/render";
import LetterEmail, { paragraphs, type LetterEmailProps } from "./Letter";
import SimpleEmail from "./Simple";

export { sendEmail, emailConfigured, type OutgoingEmail } from "./send";
export { paragraphs };

/** Display names go in a quoted header; strip what could break out of the quotes. */
const headerSafe = (s: string) => s.replace(/["\\\r\n<>]/g, "").trim().slice(0, 60);

export async function buildLetterEmail(p: LetterEmailProps & { senderEmail: string; recipientEmail: string; sendingDomain: string; oneClickUrl: string }) {
  const name = headerSafe(p.senderName);
  const html = await render(<LetterEmail {...p} />);
  const text = [
    `${p.senderName} sent you a letter.`,
    "",
    p.body.trim(),
    "",
    p.senderName,
    "",
    `Open in full: ${p.letterUrl}`,
    "",
    `Sent with ${p.siteName}. Don't want letters from ${p.siteName}? Block future letters: ${p.blockUrl}`,
  ].join("\n");
  return {
    from: `"${name} via ${headerSafe(p.siteName)}" <letters@${p.sendingDomain}>`,
    to: p.recipientEmail,
    replyTo: p.senderEmail,
    subject: `${name} sent you a letter`,
    html,
    text,
    headers: {
      // RFC 8058 one-click: a POST to this URL blocks; a GET only shows the page.
      "List-Unsubscribe": `<${p.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}

export async function buildVerifyEmail(p: { siteName: string; senderName: string; recipientName: string; verifyUrl: string; to: string; sendingDomain: string }) {
  const lines = [
    `Hello ${p.senderName},`,
    `Before your first letter goes out, we need to know this address is yours. Confirm it and your letter to ${p.recipientName} will be sealed, stamped and sent.`,
    "This link works once and expires in 24 hours. If you didn't write a letter, ignore this email and nothing will be sent.",
  ];
  return {
    from: `"${headerSafe(p.siteName)}" <letters@${p.sendingDomain}>`,
    to: p.to,
    subject: `Confirm your email to send your letter`,
    html: await render(<SimpleEmail preview="One click and your letter is on its way." lines={lines} cta={{ href: p.verifyUrl, label: "Confirm and send" }} />),
    text: [...lines, "", p.verifyUrl].join("\n\n"),
    headers: {},
  };
}

export async function buildFailedEmail(p: { siteName: string; senderName: string; recipientName: string; to: string; sendingDomain: string; siteUrl: string }) {
  const lines = [
    `Hello ${p.senderName},`,
    `We're sorry: your letter to ${p.recipientName} could not be prepared. We tried three times and something went wrong each time, so nothing was sent.`,
    "You can write it again, and we'll try with a fresh envelope.",
  ];
  return {
    from: `"${headerSafe(p.siteName)}" <letters@${p.sendingDomain}>`,
    to: p.to,
    subject: `Your letter to ${headerSafe(p.recipientName)} wasn't sent`,
    html: await render(<SimpleEmail preview="Your letter could not be sent." lines={lines} cta={{ href: p.siteUrl, label: "Write it again" }} />),
    text: [...lines, "", p.siteUrl].join("\n\n"),
    headers: {},
  };
}

/** PRD sender flow, last step: a confirmation with a link to the sent letter. */
export async function buildSentEmail(p: { siteName: string; senderName: string; recipientName: string; letterUrl: string; to: string; sendingDomain: string }) {
  const lines = [`Hello ${p.senderName},`, `Your letter to ${p.recipientName} has been delivered. Here it is, exactly as they see it.`];
  return {
    from: `"${headerSafe(p.siteName)}" <letters@${p.sendingDomain}>`,
    to: p.to,
    subject: `Your letter to ${headerSafe(p.recipientName)} was delivered`,
    html: await render(<SimpleEmail preview="Sealed, stamped and delivered." lines={lines} cta={{ href: p.letterUrl, label: "See your letter" }} />),
    text: [...lines, "", p.letterUrl].join("\n\n"),
    headers: {},
  };
}
