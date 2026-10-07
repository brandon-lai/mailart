/**
 * Render worker. Polls render_jobs, screenshots /render/:id frame by frame,
 * encodes the GIF under 1 MB, uploads, emails the recipient.
 *
 *   pnpm worker                 poll forever
 *   pnpm worker --once          process at most one job, then exit
 *   pnpm worker --check 20      acceptance run on 20 random envelopes (no database)
 *   pnpm worker --samples       render the demo letters into apps/web/public/samples
 */
import { existsSync } from "node:fs";
import { mkdtemp, rm, copyFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import {
  blockToken,
  claimJob,
  failJob,
  finishJob,
  getLetterWithSender,
  hasDatabase,
  isBlocked,
  setStatus,
  type ClaimedJob,
} from "@mailart/db";
import { buildFailedEmail, buildLetterEmail, sendEmail } from "@mailart/emails";
import { capture, closeBrowser } from "./capture";
import { encodeGif } from "./encode";
import { putFile } from "./storage";

const ROOT = path.resolve(import.meta.dirname, "../../..");
// Static imports above evaluate first, but every one of them reads env lazily, so this is in time.
if (existsSync(path.join(ROOT, ".env"))) process.loadEnvFile(path.join(ROOT, ".env"));
const SITE_URL = (process.env.SITE_URL || "http://localhost:3335").replace(/\/$/, "");
const RENDER_BASE = (process.env.RENDER_BASE_URL || SITE_URL).replace(/\/$/, "");
const SITE_NAME = process.env.SITE_NAME || "Mailart";
const SECRET = process.env.WORKER_SECRET || "dev-worker-secret";
const SENDING_DOMAIN = process.env.SENDING_DOMAIN || "mailart.localhost";

type Rendered = Awaited<ReturnType<typeof render>>;

/** Capture + encode one envelope, then run the per-job acceptance checks. */
async function render(id: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "mailart-"));
  const t0 = Date.now();
  const cap = await capture(`${RENDER_BASE}/render/${encodeURIComponent(id)}`, SECRET, dir);
  const tCap = Date.now() - t0;
  const gif = await encodeGif(dir, cap.fps, path.join(dir, "envelope.gif"));
  const ms = Date.now() - t0;
  const checks = await acceptance(cap.frames, cap.box.height, gif.bytes, cap.pngIdentical);
  return { dir, gif, png: cap.png, ms, tCap, checks, frames: cap.frames.length };
}

/**
 * The spec's checks, run on every job: under 1 MB, first frame closed, last
 * frame shows the letter, PNG byte-identical across two renders. "Closed" and
 * "letter out" are read from pixels: a strip above the envelope is plain
 * backdrop in the first frame and white letter paper in the last.
 */
async function acceptance(frames: string[], height: number, bytes: number, pngIdentical: boolean) {
  const strip = async (f: string) => {
    // Centre column, from 12% to 30% of the frame height: above the envelope, where the letter rises.
    const { data } = await sharp(f).extract({ left: 560, top: Math.round(height * 0.14), width: 80, height: Math.round(height * 0.12) }).raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += 3) sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    return sum / (data.length / 3);
  };
  const first = await strip(frames[0]);
  const hold = await strip(frames[Math.min(frames.length - 1, 6)]); // 0.4 s: still closed
  const last = await strip(frames[frames.length - 1]);
  const BACKDROP = (0xef + 0xe8 + 0xdc) / 3; // 232
  const result = {
    underOneMB: bytes <= 1024 * 1024,
    firstFrameClosed: Math.abs(first - BACKDROP) < 3 && Math.abs(hold - first) < 1,
    lastFrameLetter: last > BACKDROP + 6, // letter paper is #fbf8f1 (248)
    pngIdentical,
  };
  return { ...result, pass: Object.values(result).every(Boolean), first: Math.round(first), last: Math.round(last) };
}

async function processJob(job: ClaimedJob) {
  const row = await getLetterWithSender(job.letter_id);
  if (!row) throw new Error(`letter ${job.letter_id} vanished`);
  const { letter, sender } = row;
  await setStatus(letter.id, "rendering");
  let r: Rendered | undefined;
  try {
    r = await render(letter.id);
    console.log(`  ${letter.id}: ${r.frames} frames, ${(r.gif.bytes / 1024).toFixed(0)} KB at ${r.gif.rung.width}px lossy=${r.gif.rung.lossy}, ${r.ms} ms`, r.checks.pass ? "checks ok" : r.checks);
    if (!r.checks.underOneMB || !r.checks.firstFrameClosed || !r.checks.lastFrameLetter) throw new Error(`acceptance failed: ${JSON.stringify(r.checks)}`);
    if (!r.checks.pngIdentical) console.warn("  warning: closed PNG differed between two renders");
    const gifUrl = await putFile(`letters/${letter.publicSlug}/envelope.gif`, r.gif.file, "image/gif");
    const pngUrl = await putFile(`letters/${letter.publicSlug}/envelope.png`, r.png, "image/png");
    await setStatus(letter.id, "sending", { gifUrl, pngUrl });
    // A recipient may have blocked between queueing and now: drop silently.
    if (await isBlocked(letter.recipientEmail)) {
      await setStatus(letter.id, "failed");
      await finishJob(job.id);
      return;
    }
    const token = blockToken(letter.id);
    const msg = await buildLetterEmail({
      siteName: SITE_NAME,
      senderName: sender.name,
      senderEmail: sender.email,
      recipientEmail: letter.recipientEmail,
      gifUrl,
      letterUrl: `${SITE_URL}/l/${letter.publicSlug}`,
      blockUrl: `${SITE_URL}/block?token=${encodeURIComponent(token)}`,
      oneClickUrl: `${SITE_URL}/api/block?token=${encodeURIComponent(token)}`,
      body: letter.body,
      sendingDomain: SENDING_DOMAIN,
    });
    await sendEmail(msg);
    await setStatus(letter.id, "sent", { sentAt: new Date() });
    await finishJob(job.id);
  } finally {
    if (r) await rm(r.dir, { recursive: true, force: true });
  }
}

async function loop(once: boolean) {
  if (!hasDatabase()) throw new Error("DATABASE_URL is not set; the worker needs the jobs table. (--check and --samples run without it.)");
  console.log(`render worker polling; render pages from ${RENDER_BASE}`);
  for (;;) {
    const job = await claimJob();
    if (!job) {
      if (once) break;
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    console.log(`job ${job.id} (attempt ${job.attempts}) for letter ${job.letter_id}`);
    try {
      await processJob(job);
    } catch (e) {
      const final = await failJob(job, e instanceof Error ? e.stack || e.message : String(e));
      console.error(`  failed${final ? " for good" : ", will retry"}:`, e instanceof Error ? e.message : e);
      if (final) {
        const row = await getLetterWithSender(job.letter_id);
        if (row) {
          await sendEmail(
            await buildFailedEmail({ siteName: SITE_NAME, senderName: row.sender.name, recipientName: row.letter.recipientName, to: row.sender.email, sendingDomain: SENDING_DOMAIN, siteUrl: SITE_URL }),
          ).catch((err) => console.error("  could not email the sender:", err));
        }
      }
    }
    if (once) break;
  }
  await closeBrowser();
}

/** Phase 3 acceptance: N random envelopes, every one under 1 MB with a closed first frame and letter-out last frame. */
async function check(n: number) {
  const rows: string[] = [];
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const seed = `check-${Date.now().toString(36)}-${i}`;
    const r = await render(`seed:${seed}`);
    if (!r.checks.pass) failed++;
    rows.push(`${seed.padEnd(24)} ${(r.gif.bytes / 1024).toFixed(0).padStart(5)} KB  ${String(r.gif.rung.width).padStart(4)}px lossy=${String(r.gif.rung.lossy).padEnd(3)}  ${String(r.ms).padStart(6)} ms (capture ${r.tCap})  ${r.checks.pass ? "ok" : "FAIL " + JSON.stringify(r.checks)}`);
    console.log(rows[rows.length - 1]);
    if (i === 0 || !r.checks.pass) {
      const keep = path.join(ROOT, "storage/check", seed);
      await mkdir(keep, { recursive: true });
      await copyFile(r.gif.file, path.join(keep, "envelope.gif"));
      await copyFile(r.png, path.join(keep, "closed.png"));
      for (const f of [r.frames - 1, 0, 9, 18, 27].map((k) => path.join(r.dir, `f${String(Math.max(0, k)).padStart(3, "0")}.png`))) await copyFile(f, path.join(keep, path.basename(f))).catch(() => {});
    }
    await rm(r.dir, { recursive: true, force: true });
  }
  await closeBrowser();
  console.log(`\n${n - failed}/${n} passed`);
  if (failed) process.exit(1);
}

async function samples() {
  const { SAMPLES } = await import("../../../apps/web/lib/samples");
  const out = path.join(ROOT, "apps/web/public/samples");
  await mkdir(out, { recursive: true });
  for (const s of SAMPLES) {
    const r = await render(`sample:${s.slug}`);
    await copyFile(r.gif.file, path.join(out, `${s.slug}.gif`));
    await sharp(r.png).png({ compressionLevel: 9, palette: false }).toFile(path.join(out, `${s.slug}.png`));
    console.log(`${s.slug}: ${(r.gif.bytes / 1024).toFixed(0)} KB gif (${r.gif.rung.width}px lossy=${r.gif.rung.lossy}), png ${((await stat(path.join(out, `${s.slug}.png`))).size / 1024).toFixed(0)} KB, ${r.ms} ms`, r.checks.pass ? "ok" : r.checks);
    await rm(r.dir, { recursive: true, force: true });
  }
  await closeBrowser();
}

const args = process.argv.slice(2);
const main = async () => {
  if (args.includes("--check")) return check(Number(args[args.indexOf("--check") + 1] || 20));
  if (args.includes("--samples")) return samples();
  return loop(args.includes("--once"));
};
main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    console.error(e);
    await closeBrowser();
    process.exit(1);
  });
