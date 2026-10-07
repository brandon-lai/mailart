import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "./client";
import { blockedRecipients, letters, renderJobs, senders, verificationTokens, type Letter, type LetterStatus } from "./schema";
import { emailHash, newToken, normalizeEmail, randomSlug, sha256 } from "./crypto";

export { blockToken, readBlockToken, emailHash, ipHash, randomSlug, sha256, hmac } from "./crypto";

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 3;

export async function upsertSender(email: string, name: string) {
  const { sql: q } = getDb();
  const e = normalizeEmail(email);
  // The unique index is on lower(email), which Drizzle's conflict target cannot name.
  const [row] = await q<{ id: string; email: string; name: string; verified_at: Date | null }[]>`
    insert into senders (email, name) values (${e}, ${name})
    on conflict (lower(email)) do update set name = excluded.name
    returning id, email, name, verified_at`;
  return { id: row.id, email: row.email, name: row.name, verifiedAt: row.verified_at };
}

export type NewLetter = {
  senderId: string;
  recipientName: string;
  recipientEmail: string;
  addressLine?: string | null;
  senderCity: string;
  body: string;
  ipHash?: string | null;
};

export async function createLetter(l: NewLetter): Promise<Letter> {
  const { db } = getDb();
  const [row] = await db
    .insert(letters)
    .values({ ...l, recipientEmail: normalizeEmail(l.recipientEmail), publicSlug: randomSlug(22) })
    .returning();
  return row;
}

/** Letters created in the last 24 hours, for the rate limits. */
export async function recentCounts(senderEmail: string, recipientEmail: string, ip: string | null) {
  const { sql: q } = getDb();
  const [r] = await q<{ by_sender: number; by_recipient: number; by_ip: number }[]>`
    select
      (select count(*)::int from letters l join senders s on s.id = l.sender_id
        where lower(s.email) = ${normalizeEmail(senderEmail)} and l.created_at > now() - interval '1 day') as by_sender,
      (select count(*)::int from letters where lower(recipient_email) = ${normalizeEmail(recipientEmail)}
        and created_at > now() - interval '1 day') as by_recipient,
      (select count(*)::int from letters where ip_hash = ${ip} and created_at > now() - interval '1 day') as by_ip`;
  return { bySender: r.by_sender, byRecipient: r.by_recipient, byIp: ip ? r.by_ip : 0 };
}

export async function getLetter(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const { db } = getDb();
  const [row] = await db.select().from(letters).where(eq(letters.id, id));
  return row;
}

export async function getLetterWithSender(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const { db } = getDb();
  const [row] = await db.select({ letter: letters, sender: senders }).from(letters).innerJoin(senders, eq(senders.id, letters.senderId)).where(eq(letters.id, id));
  return row;
}

export async function getLetterBySlug(slug: string) {
  if (!/^[A-Za-z0-9]{22}$/.test(slug)) return undefined;
  const { db } = getDb();
  const [row] = await db
    .select({ letter: letters, senderName: senders.name })
    .from(letters)
    .innerJoin(senders, eq(senders.id, letters.senderId))
    .where(eq(letters.publicSlug, slug));
  return row;
}

export async function saveChoice(id: string, seed: string, recipe: string, spec: unknown) {
  const { db } = getDb();
  // Only drafts can change envelope: once sent, the spec is what the recipient saw.
  const rows = await db
    .update(letters)
    .set({ seed, recipe, envelopeSpec: spec })
    .where(and(eq(letters.id, id), eq(letters.status, "draft")))
    .returning({ id: letters.id });
  return rows.length === 1;
}

export async function isBlocked(email: string) {
  const { db } = getDb();
  const rows = await db.select().from(blockedRecipients).where(eq(blockedRecipients.emailHash, emailHash(email)));
  return rows.length > 0;
}

export async function blockEmail(email: string) {
  const { db } = getDb();
  await db.insert(blockedRecipients).values({ emailHash: emailHash(email) }).onConflictDoNothing();
}

export async function setStatus(id: string, status: LetterStatus, extra: Partial<Pick<Letter, "gifUrl" | "pngUrl" | "sentAt">> = {}) {
  const { db } = getDb();
  await db.update(letters).set({ status, ...extra }).where(eq(letters.id, id));
}

/** Returns the raw token for the email; only its hash is stored. */
export async function createVerificationToken(senderId: string, letterId: string): Promise<string> {
  const { db } = getDb();
  const token = newToken();
  await db.insert(verificationTokens).values({ tokenHash: sha256(token), senderId, letterId, expiresAt: new Date(Date.now() + VERIFY_TTL_MS) });
  return token;
}

export type VerifyResult = { ok: true; letterId: string; senderId: string } | { ok: false; reason: "invalid" | "expired" | "used" };

export async function consumeVerificationToken(token: string): Promise<VerifyResult> {
  const { db } = getDb();
  const hash = sha256(token);
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(verificationTokens).where(eq(verificationTokens.tokenHash, hash)).for("update");
    if (!t) return { ok: false, reason: "invalid" } as const;
    if (t.usedAt) return { ok: false, reason: "used" } as const;
    if (t.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" } as const;
    await tx.update(verificationTokens).set({ usedAt: new Date() }).where(and(eq(verificationTokens.tokenHash, hash), isNull(verificationTokens.usedAt)));
    await tx.update(senders).set({ verifiedAt: new Date() }).where(and(eq(senders.id, t.senderId), isNull(senders.verifiedAt)));
    return { ok: true, letterId: t.letterId, senderId: t.senderId } as const;
  });
}

/**
 * Queue the render, unless the recipient has blocked letters. A blocked send
 * is dropped silently: the sender sees the same "on its way" as anyone else,
 * so blocking cannot be probed. Returns what actually happened, for logs/tests.
 */
export async function queueLetter(id: string): Promise<"queued" | "blocked" | "not-ready"> {
  const { db } = getDb();
  return db.transaction(async (tx) => {
    const [l] = await tx.select().from(letters).where(eq(letters.id, id)).for("update");
    if (!l || !l.envelopeSpec || !(l.status === "draft" || l.status === "awaiting_verification")) return "not-ready" as const;
    const [b] = await tx.select().from(blockedRecipients).where(eq(blockedRecipients.emailHash, emailHash(l.recipientEmail)));
    if (b) {
      await tx.update(letters).set({ status: "failed" }).where(eq(letters.id, id));
      return "blocked" as const;
    }
    await tx.update(letters).set({ status: "queued" }).where(eq(letters.id, id));
    await tx.insert(renderJobs).values({ letterId: id });
    return "queued" as const;
  });
}

export async function markAwaitingVerification(id: string) {
  const { db } = getDb();
  await db.update(letters).set({ status: "awaiting_verification" }).where(and(eq(letters.id, id), eq(letters.status, "draft")));
}

export type ClaimedJob = { id: string; letter_id: string; attempts: number };

/** Claim one job. A job left 'running' for 10 minutes is assumed dead and reclaimed. */
export async function claimJob(): Promise<ClaimedJob | undefined> {
  const { sql: q } = getDb();
  const rows = await q<ClaimedJob[]>`
    update render_jobs set status = 'running', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from render_jobs
      where (status = 'pending' or (status = 'running' and locked_at < now() - interval '10 minutes'))
        and attempts < ${MAX_ATTEMPTS}
      order by created_at
      for update skip locked
      limit 1
    )
    returning id, letter_id, attempts`;
  return rows[0];
}

export async function finishJob(id: string) {
  const { db } = getDb();
  await db.update(renderJobs).set({ status: "done", finishedAt: new Date(), error: null }).where(eq(renderJobs.id, id));
}

/** Back to pending for a retry, or failed for good after MAX_ATTEMPTS. Returns true when final. */
export async function failJob(job: ClaimedJob, error: string): Promise<boolean> {
  const { db } = getDb();
  const final = job.attempts >= MAX_ATTEMPTS;
  await db
    .update(renderJobs)
    .set({ status: final ? "failed" : "pending", error: error.slice(0, 2000), finishedAt: final ? new Date() : null })
    .where(eq(renderJobs.id, job.id));
  if (final) await setStatus(job.letter_id, "failed");
  return final;
}


