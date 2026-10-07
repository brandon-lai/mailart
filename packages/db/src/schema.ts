import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const LETTER_STATUSES = ["draft", "awaiting_verification", "queued", "rendering", "sending", "sent", "failed"] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const senders = pgTable(
  "senders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("senders_email_key").on(sql`lower(${t.email})`)],
);

export const letters = pgTable(
  "letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicSlug: text("public_slug").notNull().unique(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => senders.id),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    addressLine: text("address_line"),
    senderCity: text("sender_city").notNull(),
    body: text("body").notNull(),
    seed: text("seed"),
    recipe: text("recipe"),
    envelopeSpec: jsonb("envelope_spec"),
    status: text("status", { enum: LETTER_STATUSES }).notNull().default("draft"),
    gifUrl: text("gif_url"),
    pngUrl: text("png_url"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Not in the spec's column list: the per-IP rate limit needs something to
    // count. It is an HMAC of the address, never the address itself.
    ipHash: text("ip_hash"),
  },
  (t) => [
    index("letters_sender_created").on(t.senderId, t.createdAt),
    index("letters_recipient_created").on(sql`lower(${t.recipientEmail})`, t.createdAt),
    index("letters_ip_created").on(t.ipHash, t.createdAt),
  ],
);

export const renderJobs = pgTable(
  "render_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    letterId: uuid("letter_id")
      .notNull()
      .references(() => letters.id),
    status: text("status", { enum: ["pending", "running", "done", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("render_jobs_claim").on(t.status, t.createdAt)],
);

export const verificationTokens = pgTable("verification_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => senders.id),
  letterId: uuid("letter_id")
    .notNull()
    .references(() => letters.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const blockedRecipients = pgTable("blocked_recipients", {
  emailHash: text("email_hash").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Letter = typeof letters.$inferSelect;
export type Sender = typeof senders.$inferSelect;
