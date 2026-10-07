/**
 * Integration tests against a running server, a real database and Mailpit:
 *   pnpm --filter web dev        (with DATABASE_URL in apps/web/.env.local)
 *   pnpm test
 * Skipped when the server isn't up. Every run uses fresh addresses and IPs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.TEST_BASE_URL || "http://localhost:3335";
const MAILPIT = process.env.MAILPIT_URL || "http://localhost:8025";
const env = Object.fromEntries(
  readFileSync(path.join(import.meta.dirname, "../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const sql = postgres(env.DATABASE_URL, { max: 2, onnotice: () => {} });
const run = Math.random().toString(36).slice(2, 8);
const mail = (who: string) => `${who}.${run}@example.com`;
let ipN = 0;
const ip = () => `10.${(Math.random() * 250) | 0}.${(Math.random() * 250) | 0}.${++ipN % 250}`;

let up = false;
beforeAll(async () => {
  up = await fetch(BASE).then((r) => r.ok).catch(() => false);
});

async function draft(over: Record<string, string> = {}, from = ip()) {
  const res = await fetch(`${BASE}/api/letters`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": from },
    body: JSON.stringify({
      senderName: "Test Sender",
      senderEmail: mail(`sender${++ipN}`),
      senderCity: "Lisbon",
      recipientName: "Theo Lindqvist",
      recipientEmail: mail(`theo${ipN}`),
      body: "Dear Theo,\n\nA test letter.",
      ...over,
    }),
  });
  return { status: res.status, json: (await res.json()) as { id?: string; error?: string; field?: string } };
}

const post = (p: string, body?: unknown) =>
  fetch(`${BASE}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

async function choose(id: string, index = 0) {
  return post(`/api/letters/${id}/choose`, { index });
}

async function verifyLinkFor(to: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}" subject:"Confirm"`)}`).then((r) => r.json());
    const m = r.messages?.[0];
    if (m) {
      const full = await fetch(`${MAILPIT}/api/v1/message/${m.ID}`).then((r) => r.json());
      return full.Text.match(/https?:\S+\/verify\?token=\S+/)[0];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no verification email for ${to}`);
}

const it_ = (name: string, fn: () => Promise<void>) => it(name, async (ctx) => (up ? fn() : ctx.skip()));

describe("drafts: validation and moderation", () => {
  it_("rejects an empty letter, an over-long envelope name, and writing to yourself", async () => {
    expect((await draft({ body: "  " })).status).toBe(400);
    const long = await draft({ recipientName: "x".repeat(41) });
    expect(long.status).toBe(400);
    expect(long.json.field).toBe("recipientName");
    const self = await draft({ senderEmail: mail("same"), recipientEmail: mail("same") });
    expect(self.status).toBe(400);
  });

  it_("moderates the name drawn on the envelope and the body, with a plain message", async () => {
    const name = await draft({ recipientName: "you faggot" });
    expect(name.status).toBe(422);
    expect(name.json.field).toBe("recipientName");
    expect(name.json.error).toMatch(/envelope/);
    const body = await draft({ body: "I know where you live. kill yourself." });
    expect(body.status).toBe(422);
  });
});

describe("rate limits", () => {
  it_("5 letters per sender per day", async () => {
    const s = mail("busy");
    for (let i = 0; i < 5; i++) expect((await draft({ senderEmail: s, recipientEmail: mail(`r${i}`) })).status).toBe(200);
    const sixth = await draft({ senderEmail: s, recipientEmail: mail("r6") });
    expect(sixth.status).toBe(429);
  });

  it_("2 letters per recipient per day", async () => {
    const r = mail("popular");
    expect((await draft({ senderEmail: mail("a"), recipientEmail: r })).status).toBe(200);
    expect((await draft({ senderEmail: mail("b"), recipientEmail: r })).status).toBe(200);
    expect((await draft({ senderEmail: mail("c"), recipientEmail: r })).status).toBe(429);
  });

  it_("20 letters per IP per day", async () => {
    const from = ip();
    for (let i = 0; i < 20; i++) expect((await draft({ senderEmail: mail(`ip${i}`), recipientEmail: mail(`ipr${i}`) }, from)).status).toBe(200);
    expect((await draft({ senderEmail: mail("ip21"), recipientEmail: mail("ipr21") }, from)).status).toBe(429);
  });

  it_("stores a keyed hash of the IP, never the address", async () => {
    const from = ip();
    const { json } = await draft({}, from);
    const [row] = await sql`select ip_hash from letters where id = ${json.id!}`;
    expect(row.ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_hash).not.toContain(from);
    const cols = await sql`select column_name from information_schema.columns where table_schema = 'public' and column_name ~ '(^|_)ip($|_)'`;
    expect(cols.map((c) => c.column_name)).toEqual(["ip_hash"]);
  });
});

describe("previews and choosing", () => {
  it_("returns three deterministic specs per shuffle, none showing the recipient email", async () => {
    const { json } = await draft();
    const a = await fetch(`${BASE}/api/letters/${json.id}/previews?shuffle=0`).then((r) => r.json());
    const b = await fetch(`${BASE}/api/letters/${json.id}/previews?shuffle=0`).then((r) => r.json());
    const c = await fetch(`${BASE}/api/letters/${json.id}/previews?shuffle=1`).then((r) => r.json());
    expect(a.specs).toHaveLength(3);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(c.specs.map((s: { index: number }) => s.index)).toEqual([3, 4, 5]);
    expect(JSON.stringify(a)).not.toContain("@example.com");
  });

  it_("stores the server's own spec for the chosen seed", async () => {
    const { json } = await draft();
    const previews = await fetch(`${BASE}/api/letters/${json.id}/previews?shuffle=2`).then((r) => r.json());
    expect((await choose(json.id!, 7)).status).toBe(200);
    const [row] = await sql`select seed, envelope_spec from letters where id = ${json.id!}`;
    expect(row.seed).toBe(`${json.id}:7`);
    // jsonb reorders keys, so compare structurally.
    expect(row.envelope_spec).toEqual(previews.specs[1].spec);
  });
});

describe("verification", () => {
  it_("unverified sender gets a link; it works once, queues the render, and later letters skip it", async () => {
    const s = mail("newbie");
    const { json } = await draft({ senderEmail: s });
    await choose(json.id!);
    expect(await post(`/api/letters/${json.id}/send`).then((r) => r.json())).toEqual({ state: "verify" });
    const [l1] = await sql`select status from letters where id = ${json.id!}`;
    expect(l1.status).toBe("awaiting_verification");

    const link = await verifyLinkFor(s);
    expect(await fetch(link).then((r) => r.text())).toContain("on its way");
    const [l2] = await sql`select l.status, count(j.id)::int jobs from letters l left join render_jobs j on j.letter_id = l.id where l.id = ${json.id!} group by l.status`;
    expect(l2).toEqual({ status: "queued", jobs: 1 });
    expect(await fetch(link).then((r) => r.text())).toContain("Already confirmed");
    const [l3] = await sql`select count(*)::int jobs from render_jobs where letter_id = ${json.id!}`;
    expect(l3.jobs).toBe(1);

    const second = await draft({ senderEmail: s, recipientEmail: mail("friend2") });
    await choose(second.json.id!);
    expect(await post(`/api/letters/${second.json.id}/send`).then((r) => r.json())).toEqual({ state: "queued" });
  });

  it_("an expired link sends nothing", async () => {
    const s = mail("slow");
    const { json } = await draft({ senderEmail: s });
    await choose(json.id!);
    await post(`/api/letters/${json.id}/send`);
    const link = await verifyLinkFor(s);
    await sql`update verification_tokens set expires_at = now() - interval '1 minute' where letter_id = ${json.id!}`;
    expect(await fetch(link).then((r) => r.text())).toContain("expired");
    const [l] = await sql`select l.status, s.verified_at from letters l join senders s on s.id = l.sender_id where l.id = ${json.id!}`;
    expect(l.status).toBe("awaiting_verification");
    expect(l.verified_at).toBeNull();
  });

  it_("a made-up token does nothing", async () => {
    expect(await fetch(`${BASE}/verify?token=not-a-real-token`).then((r) => r.text())).toContain("doesn");
  });

  it_("an envelope cannot be changed once the letter has left the draft state", async () => {
    const s = mail("sealed");
    const { json } = await draft({ senderEmail: s });
    await choose(json.id!);
    await post(`/api/letters/${json.id}/send`);
    expect((await choose(json.id!, 2)).status).toBe(409);
  });
});

describe("recipient block", () => {
  async function verifiedSender() {
    const s = mail(`v${Math.random().toString(36).slice(2, 6)}`);
    const { json } = await draft({ senderEmail: s, recipientEmail: mail("warmup") });
    await choose(json.id!);
    await post(`/api/letters/${json.id}/send`);
    await fetch(await verifyLinkFor(s));
    return s;
  }

  it_("one-click POST blocks by hash; later sends look identical but go nowhere", async () => {
    const s = await verifiedSender();
    const victim = mail("blocker");
    const first = await draft({ senderEmail: s, recipientEmail: victim });
    await choose(first.json.id!);
    await post(`/api/letters/${first.json.id}/send`);

    // The token as the email's List-Unsubscribe header carries it.
    const { blockToken } = await import("@mailart/db");
    process.env.HASH_SECRET = env.HASH_SECRET;
    const token = blockToken(first.json.id!);
    const res = await fetch(`${BASE}/api/block?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(res.status).toBe(200);
    const stored = await sql`select email_hash from blocked_recipients`;
    expect(stored.every((r) => /^[0-9a-f]{64}$/.test(r.email_hash))).toBe(true);
    expect(JSON.stringify(stored)).not.toContain("@");

    const s2 = await verifiedSender();
    const again = await draft({ senderEmail: s2, recipientEmail: victim });
    await choose(again.json.id!);
    expect(await post(`/api/letters/${again.json.id}/send`).then((r) => r.json())).toEqual({ state: "queued" });
    const [row] = await sql`select l.status, count(j.id)::int jobs from letters l left join render_jobs j on j.letter_id = l.id where l.id = ${again.json.id!} group by l.status`;
    expect(row).toEqual({ status: "failed", jobs: 0 });
  });

  it_("GET never blocks (link scanners), and a tampered token is refused", async () => {
    const before = await sql`select count(*)::int n from blocked_recipients`;
    const g = await fetch(`${BASE}/api/block?token=abc.def`, { redirect: "manual" });
    expect([302, 307]).toContain(g.status);
    const bad = await fetch(`${BASE}/api/block?token=${encodeURIComponent("YWJj.0000000000000000000000000000000")}`, { method: "POST" });
    expect(bad.status).toBe(400);
    const after = await sql`select count(*)::int n from blocked_recipients`;
    expect(after[0].n).toBe(before[0].n);
  });
});

describe("internal and public pages", () => {
  it_("/render/:id needs the worker secret", async () => {
    expect((await fetch(`${BASE}/render/seed:abc`)).status).toBe(404);
    expect((await fetch(`${BASE}/render/seed:abc`, { headers: { "x-worker-secret": "wrong" } })).status).toBe(404);
    expect((await fetch(`${BASE}/render/seed:abc`, { headers: { "x-worker-secret": env.WORKER_SECRET } })).status).toBe(200);
  });

  it_("an unsent letter has no public page; sample pages are noindex and never show an email", async () => {
    const { json } = await draft();
    const [row] = await sql`select public_slug from letters where id = ${json.id!}`;
    expect(row.public_slug).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await fetch(`${BASE}/l/${row.public_slug}`)).status).toBe(404);
    const html = await fetch(`${BASE}/l/SampleLetterLisbon0001`).then((r) => r.text());
    expect(html).toContain("noindex");
    // Letters-only domain: dev chunk paths like next@16.4 are not addresses.
    expect(html).not.toMatch(/[\w.+-]+@[a-z-]+\.[a-z]{2,}\b/i);
  });
});
