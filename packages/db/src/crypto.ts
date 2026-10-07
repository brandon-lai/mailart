import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function secret(): string {
  const s = process.env.HASH_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("HASH_SECRET is not set");
  return "dev-only-hash-secret";
}

/** 22 characters of base62 (~131 bits), with rejection sampling so every character is uniform. */
export function randomSlug(len = 22): string {
  let out = "";
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248 && out.length < len) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmac = (s: string) => createHmac("sha256", secret()).update(s).digest("hex");

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
/** Recipient emails are blocked by keyed hash: the block list never holds an address. */
export const emailHash = (e: string) => hmac(`email:${normalizeEmail(e)}`);
export const ipHash = (ip: string) => hmac(`ip:${ip}`);

/** Opt-out tokens name a letter and are signed, so the link alone proves nothing else. */
export function blockToken(letterId: string): string {
  return `${Buffer.from(letterId).toString("base64url")}.${hmac(`block:${letterId}`).slice(0, 32)}`;
}

export function readBlockToken(token: string): string | null {
  const [a, sig] = token.split(".");
  if (!a || !sig) return null;
  const id = Buffer.from(a, "base64url").toString();
  const want = Buffer.from(hmac(`block:${id}`).slice(0, 32));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export const newToken = () => randomBytes(32).toString("base64url");
