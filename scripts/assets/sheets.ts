/**
 * Contact sheets of 48 numbered thumbnails, saved to assets/review/.
 *
 *   pnpm assets:sheets raw        # every downloaded candidate, per category
 *   pnpm assets:sheets cutouts    # processed cut-outs over mid-gray (mask review)
 *   pnpm assets:sheets heads      # figures with their head boxes drawn
 *
 * The numbers on a sheet are what review.json refers to: sheets are reviewed
 * by eye and rejects recorded by id.
 */
import sharp from "sharp";
import { readdir, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "assets/review");
const T = 190; // thumbnail cell
const COLS = 8;
const ROWS = 6;

type Item = { id: string; file: string; caption: string; box?: { x: number; y: number; w: number; h: number }; natW?: number; natH?: number };

async function sheet(items: Item[], name: string, bg: { r: number; g: number; b: number }) {
  for (let s = 0; s * COLS * ROWS < items.length; s++) {
    const page = items.slice(s * COLS * ROWS, (s + 1) * COLS * ROWS);
    const composites: sharp.OverlayOptions[] = [];
    for (let i = 0; i < page.length; i++) {
      const it = page[i];
      const x = (i % COLS) * T;
      const y = Math.floor(i / COLS) * (T + 18);
      const img = sharp(it.file).resize(T - 8, T - 8, { fit: "inside" });
      const buf = await img.png().toBuffer();
      const meta = await sharp(buf).metadata();
      const ox = x + 4 + Math.round((T - 8 - meta.width!) / 2);
      const oy = y + 4 + Math.round((T - 8 - meta.height!) / 2);
      composites.push({ input: buf, left: ox, top: oy });
      if (it.box && it.natW) {
        const k = meta.width! / it.natW;
        const b = it.box;
        const svg = `<svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg"><rect x="${b.x * k}" y="${b.y * k}" width="${b.w * k}" height="${b.h * k}" fill="none" stroke="#ff2a6a" stroke-width="2"/></svg>`;
        composites.push({ input: Buffer.from(svg), left: ox, top: oy });
      }
      const label = `<svg width="${T}" height="18" xmlns="http://www.w3.org/2000/svg"><rect width="${T}" height="18" fill="#111"/><text x="4" y="13" font-family="Menlo, monospace" font-size="11" fill="#fff">${it.caption.replace(/&/g, "&amp;").replace(/</g, "&lt;").slice(0, 30)}</text></svg>`;
      composites.push({ input: Buffer.from(label), left: x, top: y + T });
    }
    const height = Math.ceil(page.length / COLS) * (T + 18);
    const file = path.join(OUT, `${name}-${String(s + 1).padStart(2, "0")}.jpg`);
    await sharp({ create: { width: COLS * T, height, channels: 3, background: bg } })
      .composite(composites)
      .jpeg({ quality: 78 })
      .toFile(file);
    console.log(file);
  }
}

async function main() {
  const mode = process.argv[2] ?? "raw";
  await mkdir(OUT, { recursive: true });
  if (mode === "raw") {
    const only = process.argv[3];
    for (const cat of ["figure", "bust", "animal", "botanical", "vignette", "ephemera"]) {
      if (only && cat !== only) continue;
      const dir = path.join(ROOT, "assets/raw", cat);
      // SINCE_MIN=30 limits the sheet to files downloaded in the last 30 minutes (a second fetch pass).
      const since = process.env.SINCE_MIN ? Date.now() - Number(process.env.SINCE_MIN) * 60000 : 0;
      const { statSync } = await import("node:fs");
      const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg") && statSync(path.join(dir, f)).mtimeMs >= since).sort();
      const items = files.map((f, i) => ({ id: f.replace(".jpg", ""), file: path.join(dir, f), caption: `${i} ${f.replace(".jpg", "")}` }));
      await sheet(items, since ? `raw2-${cat}` : `raw-${cat}`, { r: 240, g: 240, b: 240 });
    }
  } else {
    const manifest = JSON.parse(await readFile(path.join(ROOT, "assets/library/manifest.json"), "utf8"));
    const pick = (pred: (a: any) => boolean) => manifest.filter(pred);
    if (mode === "cutouts") {
      // ONLY_IDS=/path/to/ids.json limits the sheet to a list (e.g. a second pass).
      const only = process.env.ONLY_IDS ? new Set(JSON.parse(await readFile(process.env.ONLY_IDS, "utf8"))) : null;
      const items = pick((a: any) => a.cutout && (!only || only.has(a.id))).map((a: any) => ({ id: a.id, file: path.join(ROOT, "assets/library/masters", a.file), caption: `${a.id} ${a.pose ?? ""} ${a.tone}` }));
      await sheet(items, only ? "cutouts2" : "cutouts", { r: 128, g: 128, b: 128 });
    } else if (mode === "heads") {
      const items = pick((a: any) => a.headBox).map((a: any) => ({
        id: a.id,
        file: path.join(ROOT, "assets/library/masters", a.file),
        caption: `${a.id} ${a.pose ?? ""}`,
        box: a.headBox,
        natW: a.w,
        natH: a.h,
      }));
      await sheet(items, "heads", { r: 128, g: 128, b: 128 });
    } else if (mode === "library") {
      const items = pick((a: any) => !a.cutout).map((a: any) => ({ id: a.id, file: path.join(ROOT, "assets/library/masters", a.file), caption: `${a.id} ${a.tone}` }));
      await sheet(items, "rects", { r: 240, g: 240, b: 240 });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
