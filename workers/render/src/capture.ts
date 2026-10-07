import { chromium, type Browser } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const FPS = 15;

let browser: Browser | null = null;
export async function getBrowser() {
  // CHROME_PATH lets a laptop use its installed Chrome; the worker image uses Playwright's.
  browser ??= await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ["--font-render-hinting=none", "--disable-lcd-text"] });
  return browser;
}
export async function closeBrowser() {
  await browser?.close();
  browser = null;
}

type Ma = { duration: number; box: { width: number; height: number } };

/**
 * Load /render/:id, wait for fonts and images, then step the paused timeline
 * frame by frame at 15 fps, screenshotting each. Also saves the closed
 * envelope as a 1200 px PNG (twice, to prove the render is byte-identical).
 */
export async function capture(url: string, secret: string, outDir: string) {
  const b = await getBrowser();
  await mkdir(outDir, { recursive: true });

  // Frames: CSS pixels 1:1 with the stage (1200 wide).
  const ctx = await b.newContext({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1, extraHTTPHeaders: { "x-worker-secret": secret } });
  const page = await ctx.newPage();
  const res = await page.goto(url, { waitUntil: "networkidle" });
  if (!res || !res.ok()) throw new Error(`render page ${res?.status()} for ${url}`);
  await page.waitForFunction(() => !!(window as any).__ma, null, { timeout: 15_000 });
  await page.evaluate(() => (window as any).__ma.ready);
  const ma = (await page.evaluate(() => ({ duration: (window as any).__ma.duration, box: (window as any).__ma.box }))) as Ma;
  await page.setViewportSize({ width: ma.box.width, height: ma.box.height });

  const frames: string[] = [];
  const total = Math.round((ma.duration / 1000) * FPS);
  for (let i = 0; i <= total; i++) {
    const t = Math.min(ma.duration, (i * 1000) / FPS);
    await page.evaluate((ms) => (window as any).__ma.seek(ms), t);
    // Let the compositor apply the new currentTime before reading pixels.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = path.join(outDir, `f${String(i).padStart(3, "0")}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: ma.box.width, height: ma.box.height }, animations: "allow" });
    frames.push(file);
  }
  await ctx.close();

  // Closed envelope, front only, 1200 px wide: the envelope is drawn 1000 px wide, so scale 1.2.
  const pngs: Buffer[] = [];
  for (let k = 0; k < 2; k++) {
    const c2 = await b.newContext({ viewport: { width: 1200, height: 1200 }, deviceScaleFactor: 1.2, extraHTTPHeaders: { "x-worker-secret": secret } });
    const p2 = await c2.newPage();
    await p2.goto(url, { waitUntil: "networkidle" });
    await p2.waitForFunction(() => !!(window as any).__ma);
    await p2.evaluate(() => (window as any).__ma.ready);
    await p2.evaluate(() => (window as any).__ma.seek(0));
    const front = p2.locator(".ma-front");
    pngs.push(await front.screenshot({ animations: "allow", omitBackground: true }));
    await c2.close();
  }
  const sha = pngs.map((p) => createHash("sha256").update(p).digest("hex"));
  const png = path.join(outDir, "closed.png");
  await writeFile(png, pngs[0]);
  return { frames, png, pngIdentical: sha[0] === sha[1], fps: FPS, box: ma.box };
}
