import "server-only";
import { composeEnvelope, defaultLibrary, envelopeSeed, NAME_MAX, type EnvelopeSpec } from "@mailart/envelope";
import {
  blockToken,
  createLetter,
  createVerificationToken,
  getLetterWithSender,
  hasDatabase,
  ipHash,
  isBlocked,
  markAwaitingVerification,
  saveChoice,
  queueLetter,
  recentCounts,
  upsertSender,
  type Letter,
} from "@mailart/db";
import { buildVerifyEmail, emailConfigured, sendEmail } from "@mailart/emails";
import { moderate } from "./moderation";
import { SITE_NAME, SITE_URL } from "./config";

export const LIMITS = { perSender: 5, perRecipient: 2, perIp: 20 } as const;
export const BODY_MAX = 6000;

export class HttpError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

/** Refuse loudly when there is nowhere to write. */
export function requireDatabase() {
  if (!hasDatabase()) throw new HttpError(503, "This deployment has no database, so letters can't be saved or sent here. Everything else on the page still works.");
}

export type DraftInput = {
  senderName: string;
  senderEmail: string;
  senderCity: string;
  recipientName: string;
  recipientEmail: string;
  addressLine?: string;
  body: string;
};

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function validateDraft(raw: unknown): DraftInput {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d: DraftInput = {
    senderName: str(r.senderName),
    senderEmail: str(r.senderEmail).toLowerCase(),
    senderCity: str(r.senderCity),
    recipientName: str(r.recipientName),
    recipientEmail: str(r.recipientEmail).toLowerCase(),
    addressLine: str(r.addressLine) || undefined,
    body: typeof r.body === "string" ? r.body.replace(/\r\n/g, "\n").trim() : "",
  };
  if (!d.body) throw new HttpError(400, "Write something first.", "body");
  if (d.body.length > BODY_MAX) throw new HttpError(400, `Letters are capped at ${BODY_MAX} characters.`, "body");
  if (!d.recipientName) throw new HttpError(400, "Who is it for?", "recipientName");
  // Drawn on the image: capped at 40 characters.
  if (d.recipientName.length > NAME_MAX) throw new HttpError(400, `Keep the name to ${NAME_MAX} characters; it's written on the envelope.`, "recipientName");
  if (d.addressLine && d.addressLine.length > NAME_MAX) throw new HttpError(400, `Keep the extra line to ${NAME_MAX} characters.`, "addressLine");
  if (!EMAIL.test(d.recipientEmail)) throw new HttpError(400, "That recipient email doesn't look right.", "recipientEmail");
  if (!d.senderName || d.senderName.length > 60) throw new HttpError(400, "Sign it with your name (up to 60 characters).", "senderName");
  if (!EMAIL.test(d.senderEmail)) throw new HttpError(400, "We need your email to confirm it's you.", "senderEmail");
  if (!d.senderCity || d.senderCity.length > 30) throw new HttpError(400, "Your city goes on the postmark (up to 30 characters).", "senderCity");
  if (d.senderEmail === d.recipientEmail) throw new HttpError(400, "Write to someone else: the recipient can't be you.", "recipientEmail");
  return d;
}

export function clientIp(h: Headers): string | null {
  const xf = h.get("x-forwarded-for");
  return (xf ? xf.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

/** POST /api/letters: validate, moderate, rate-limit, then create the draft. */
export async function createDraft(raw: unknown, headers: Headers) {
  requireDatabase();
  const d = validateDraft(raw);
  const m = await moderate({ body: d.body, senderName: d.senderName, recipientName: d.recipientName, addressLine: d.addressLine });
  if (!m.ok) throw new HttpError(422, m.message, m.field);
  const ip = clientIp(headers);
  const ipH = ip ? ipHash(ip) : null;
  const c = await recentCounts(d.senderEmail, d.recipientEmail, ipH);
  if (c.bySender >= LIMITS.perSender) throw new HttpError(429, `You've written ${LIMITS.perSender} letters today. That's the daily limit; try again tomorrow.`);
  if (c.byRecipient >= LIMITS.perRecipient) throw new HttpError(429, "This person has already been sent letters today. Try again tomorrow.");
  if (c.byIp >= LIMITS.perIp) throw new HttpError(429, "Too many letters from this connection today. Try again tomorrow.");
  const sender = await upsertSender(d.senderEmail, d.senderName);
  const letter = await createLetter({
    senderId: sender.id,
    recipientName: d.recipientName,
    recipientEmail: d.recipientEmail,
    addressLine: d.addressLine ?? null,
    senderCity: d.senderCity,
    body: d.body,
    ipHash: ipH,
  });
  return { id: letter.id };
}

/** The postmark date is the day the envelope is composed; previews and the stored spec agree. */
function inputFor(l: Pick<Letter, "id" | "recipientName" | "addressLine" | "senderCity" | "createdAt">, index: number) {
  return {
    seed: envelopeSeed(l.id, index),
    recipientName: l.recipientName,
    addressLine: l.addressLine ?? undefined,
    senderCity: l.senderCity,
    sentAt: l.createdAt.toISOString(),
  };
}

export function previewSpecs(l: Pick<Letter, "id" | "recipientName" | "addressLine" | "senderCity" | "createdAt">, shuffle: number): EnvelopeSpec[] {
  const n = Math.max(0, Math.min(10_000, Math.floor(shuffle)));
  return [0, 1, 2].map((k) => composeEnvelope(inputFor(l, n * 3 + k), defaultLibrary));
}

export async function chooseEnvelope(id: string, index: number) {
  requireDatabase();
  const row = await getLetterWithSender(id);
  if (!row) throw new HttpError(404, "No such letter.");
  if (!Number.isInteger(index) || index < 0 || index > 30_002) throw new HttpError(400, "Pick one of the envelopes shown.");
  // Recompute server-side: the client's copy of the spec is never trusted.
  const spec = composeEnvelope(inputFor(row.letter, index), defaultLibrary);
  const ok = await saveChoice(id, spec.seed, spec.recipe, spec);
  if (!ok) throw new HttpError(409, "This letter has already been sent; its envelope is sealed.");
  return spec;
}

/**
 * POST /api/letters/:id/send. Unverified senders get a verification email;
 * verified ones go straight to the render queue. Blocked recipients are
 * dropped silently: the response is the same either way.
 */
export async function sendLetter(id: string): Promise<{ state: "verify" | "queued" }> {
  requireDatabase();
  const row = await getLetterWithSender(id);
  if (!row) throw new HttpError(404, "No such letter.");
  const { letter, sender } = row;
  if (!letter.envelopeSpec) throw new HttpError(400, "Choose an envelope first.");
  if (letter.status !== "draft" && letter.status !== "awaiting_verification") return { state: sender.verifiedAt ? "queued" : "verify" };
  if (sender.verifiedAt) {
    await queueLetter(id);
    return { state: "queued" };
  }
  const cfg = emailConfigured();
  if (!cfg.ok) throw new HttpError(503, `Can't send the confirmation email: ${cfg.reason}.`);
  const token = await createVerificationToken(sender.id, letter.id);
  const msg = await buildVerifyEmail({
    siteName: SITE_NAME,
    senderName: sender.name,
    recipientName: letter.recipientName,
    verifyUrl: `${SITE_URL}/verify?token=${encodeURIComponent(token)}`,
    to: sender.email,
    sendingDomain: sendingDomain(),
  });
  await sendEmail(msg);
  await markAwaitingVerification(id);
  return { state: "verify" };
}

export function sendingDomain() {
  return process.env.SENDING_DOMAIN || "mailart.localhost";
}

export const blockUrlFor = (letterId: string) => `${SITE_URL}/block?token=${encodeURIComponent(blockToken(letterId))}`;
export { isBlocked };
