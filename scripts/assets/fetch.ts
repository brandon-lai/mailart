/**
 * Step 1 of the asset pipeline: search the open-access museum APIs, keep only
 * hits that carry an explicit public-domain / CC0 flag and an image, download
 * each at up to 2000 px long edge, and write source.json beside it.
 *
 *   pnpm assets:fetch            # all categories
 *   pnpm assets:fetch figure     # one category
 *
 * Every API response is cached under assets/raw/cache, so re-runs are free and
 * the museums are asked each question once.
 *
 * API notes, confirmed against the live services on 2026-10-06:
 * - The Met retired /public/collection/v1/search on 2026-10-01. /v1.1/search
 *   takes the same filters plus offset/limit (max 500) and returns
 *   { total, objectIDs }. Some returned IDs 404 on /objects (stale index), so a
 *   404 is a skip, not an error. License flag: object.isPublicDomain === true
 *   (Met Open Access images are CC0).
 * - Art Institute of Chicago: /artworks/search accepts an Elasticsearch term
 *   filter as query[term][is_public_domain]=true. Its IIIF server answers 403
 *   to non-browser clients unless an AIC-User-Agent header identifies the
 *   caller, which their docs ask for anyway.
 * - Smithsonian needs an api.data.gov key. Ground rule 5 says ask first, so
 *   that fetcher is written but refuses to run without SMITHSONIAN_API_KEY.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const RAW = path.join(ROOT, "assets/raw");
const CACHE = path.join(RAW, "cache");
const AIC_UA = "mailart-asset-fetcher (brandon.lai35@gmail.com)";

export type Category = "figure" | "bust" | "animal" | "botanical" | "vignette" | "ephemera";

type Search =
  | { api: "met"; q: string; departmentId?: number; take: number; maxYear?: number }
  | { api: "aic"; q: string; take: number; maxYear?: number }
  | { api: "si"; q: string; take: number };

/** Targets from the spec, fetched at roughly 2x so rejects leave no gaps. */
const PLAN: Record<Category, Search[]> = {
  figure: [
    { api: "met", q: "cabinet card", departmentId: 19, take: 30 },
    { api: "met", q: "carte de visite", departmentId: 19, take: 30 },
    { api: "met", q: "fashion plate", departmentId: 9, take: 30 },
    { api: "met", q: "full-length portrait woman", departmentId: 19, take: 15 },
    { api: "met", q: "gentleman top hat", departmentId: 9, take: 10 },
    { api: "met", q: "back view", departmentId: 9, take: 25 },
    { api: "aic", q: "fashion plate", take: 15 },
    { api: "aic", q: "carte de visite", take: 15 },
    { api: "aic", q: "woman seen from behind", take: 12 },
    // Second pass after mask review left 57 usable figures of 60.
    { api: "met", q: "Gallery of Fashion", take: 16 },
    { api: "met", q: "Journal des Dames et des Modes", departmentId: 9, take: 16 },
  ],
  bust: [
    { api: "met", q: "engraved portrait", departmentId: 9, take: 30 },
    { api: "met", q: "portrait bust", departmentId: 9, take: 20 },
    { api: "met", q: "profile portrait", departmentId: 9, take: 20 },
    { api: "aic", q: "portrait engraving", take: 20 },
  ],
  animal: [
    { api: "met", q: "natural history bird", departmentId: 9, take: 15 },
    { api: "met", q: "monkey", departmentId: 9, take: 12 },
    { api: "met", q: "lion engraving", departmentId: 9, take: 10 },
    { api: "met", q: "dog etching", departmentId: 9, take: 10 },
    { api: "aic", q: "bird print", take: 12 },
    { api: "aic", q: "owl", take: 8 },
    { api: "aic", q: "elephant", take: 8 },
    // Second pass after review: the first queries yielded 25 usable animals of 30.
    { api: "met", q: "parrot", departmentId: 9, take: 10 },
    { api: "met", q: "cat", departmentId: 9, take: 10 },
    { api: "met", q: "Audubon", take: 10 },
    { api: "met", q: "rabbit", departmentId: 9, take: 8 },
    { api: "met", q: "swan", departmentId: 9, take: 6 },
  ],
  botanical: [
    { api: "aic", q: "butterfly", take: 15 },
    { api: "met", q: "butterfly", departmentId: 9, take: 12 },
    { api: "met", q: "botanical print", departmentId: 9, take: 15 },
    { api: "met", q: "moth", departmentId: 9, take: 8 },
    { api: "met", q: "beetle insect", departmentId: 9, take: 8 },
    { api: "aic", q: "botanical", take: 10 },
    { api: "met", q: "Temple of Flora", take: 10 },
    { api: "met", q: "rose", departmentId: 9, take: 8 },
    { api: "met", q: "Merian", take: 12 },
    { api: "met", q: "insects", departmentId: 9, take: 10 },
    { api: "met", q: "dragonfly", take: 6 },
  ],
  vignette: [
    { api: "met", q: "sailing ship", departmentId: 9, take: 15 },
    { api: "met", q: "harbor etching", departmentId: 9, take: 12 },
    { api: "met", q: "landscape etching", departmentId: 9, take: 12 },
    { api: "met", q: "monument engraving", departmentId: 9, take: 10 },
    { api: "aic", q: "lighthouse", take: 6 },
    { api: "aic", q: "hot air balloon", take: 6 },
  ],
  ephemera: [
    { api: "met", q: "map", departmentId: 9, take: 12, maxYear: 1928 },
    { api: "met", q: "sheet music", departmentId: 9, take: 10, maxYear: 1928 },
    { api: "met", q: "letter manuscript", take: 8, maxYear: 1928 },
    { api: "met", q: "trade card", departmentId: 9, take: 8, maxYear: 1928 },
    { api: "aic", q: "map", take: 6, maxYear: 1928 },
    { api: "aic", q: "calligraphy", take: 6, maxYear: 1928 },
  ],
};

export type SourceRecord = {
  id: string;
  category: Category;
  api: "met" | "aic" | "si";
  objectId: string;
  title: string;
  artist: string;
  date: string;
  url: string;
  imageUrl: string;
  license: "CC0" | "Public Domain";
  query: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cachedJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  const key = createHash("sha1").update(url).digest("hex");
  const file = path.join(CACHE, `${key}.json`);
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {}
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers }).catch(() => null);
    if (!res) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (res.status === 404) {
      await writeFile(file, "null");
      return null;
    }
    if (res.ok) {
      const json = await res.json();
      await writeFile(file, JSON.stringify(json));
      await sleep(120); // well under both APIs' published rate limits
      return json;
    }
    // The Met's CDN (Imperva) throttles bursts with non-JSON responses; back off.
    await sleep(3000 * (attempt + 1));
  }
  // Not cached, so a later run retries it.
  console.warn(`  skip: GET ${url} kept failing`);
  return null;
}

async function exists(p: string) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function searchMet(s: Extract<Search, { api: "met" }>, category: Category): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  const params = new URLSearchParams({ q: s.q, hasImages: "true", limit: "200" });
  if (s.departmentId) params.set("departmentId", String(s.departmentId));
  const res = await cachedJson(`https://collectionapi.metmuseum.org/public/collection/v1.1/search?${params}`);
  for (const id of (res?.objectIDs ?? []) as number[]) {
    if (out.length >= s.take) break;
    const o = await cachedJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
    // The license flag must be explicit. No flag, no file.
    if (!o || o.isPublicDomain !== true || !o.primaryImage) continue;
    if (s.maxYear && !(o.objectEndDate && o.objectEndDate <= s.maxYear)) continue;
    out.push({
      id: `met_${id}`,
      category,
      api: "met",
      objectId: String(id),
      title: o.title || o.objectName || "Untitled",
      artist: o.artistDisplayName || "",
      date: o.objectDate || "",
      url: o.objectURL || `https://www.metmuseum.org/art/collection/search/${id}`,
      imageUrl: o.primaryImage,
      license: "CC0",
      query: s.q,
    });
  }
  return out;
}

async function searchAic(s: Extract<Search, { api: "aic" }>, category: Category): Promise<SourceRecord[]> {
  const params = new URLSearchParams({
    q: s.q,
    limit: "100",
    fields: "id,title,artist_display,date_display,date_end,image_id,is_public_domain",
    "query[term][is_public_domain]": "true",
  });
  const res = await cachedJson(`https://api.artic.edu/api/v1/artworks/search?${params}`, { "AIC-User-Agent": AIC_UA });
  const out: SourceRecord[] = [];
  for (const o of res?.data ?? []) {
    if (out.length >= s.take) break;
    if (o.is_public_domain !== true || !o.image_id) continue;
    if (s.maxYear && !(o.date_end && o.date_end <= s.maxYear)) continue;
    out.push({
      id: `aic_${o.id}`,
      category,
      api: "aic",
      objectId: String(o.id),
      title: o.title || "Untitled",
      artist: (o.artist_display || "").split("\n")[0],
      date: o.date_display || "",
      url: `https://www.artic.edu/artworks/${o.id}`,
      imageUrl: `https://www.artic.edu/iiif/2/${o.image_id}/full/!2000,2000/0/default.jpg`,
      license: "CC0",
      query: s.q,
    });
  }
  return out;
}

async function searchSi(): Promise<SourceRecord[]> {
  if (!process.env.SMITHSONIAN_API_KEY) {
    console.warn("  smithsonian: skipped (no SMITHSONIAN_API_KEY; the spec says ask Brandon before requesting one)");
    return [];
  }
  throw new Error("Smithsonian fetcher: key present but not yet wired. See README.");
}

async function download(rec: SourceRecord, dir: string) {
  const file = path.join(dir, `${rec.id}.jpg`);
  if (await exists(file)) return true;
  const headers: Record<string, string> = rec.api === "aic" ? { "AIC-User-Agent": AIC_UA } : {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(rec.imageUrl, { headers });
    if (res.ok) {
      const tmp = `${file}.part`;
      await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      // Cap at 2000 px long edge. sips ships with macOS; the Python step uses Pillow.
      try {
        execFileSync("sips", ["-Z", "2000", "-s", "format", "jpeg", tmp, "--out", file], { stdio: "ignore" });
      } catch {
        execFileSync("mv", [tmp, file]);
      }
      execFileSync("rm", ["-f", tmp]);
      await writeFile(path.join(dir, `${rec.id}.source.json`), JSON.stringify(rec, null, 2));
      return true;
    }
    if (res.status === 404 || res.status === 403) return false;
    await sleep(1500 * (attempt + 1));
  }
  return false;
}

async function main() {
  const only = process.argv[2] as Category | undefined;
  await mkdir(CACHE, { recursive: true });
  const seen = new Set<string>();
  for (const [category, searches] of Object.entries(PLAN) as [Category, Search[]][]) {
    if (only && only !== category) continue;
    const dir = path.join(RAW, category);
    await mkdir(dir, { recursive: true });
    let kept = 0;
    for (const s of searches) {
      const hits =
        s.api === "met" ? await searchMet(s, category) : s.api === "aic" ? await searchAic(s, category) : await searchSi();
      let got = 0;
      // Download a few at a time: polite, and still fast.
      const queue = hits.filter((h) => !seen.has(h.id));
      queue.forEach((h) => seen.add(h.id));
      for (let i = 0; i < queue.length; i += 4) {
        const ok = await Promise.all(queue.slice(i, i + 4).map((h) => download(h, dir)));
        got += ok.filter(Boolean).length;
      }
      kept += got;
      console.log(`  ${category.padEnd(9)} ${s.api} "${s.q}": ${got}/${hits.length}`);
    }
    console.log(`${category}: ${kept} downloaded`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
