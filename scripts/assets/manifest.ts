/**
 * Step 6: write assets/library/manifest.json, assets/library/CREDITS.md, and
 * the compact library the envelope package ships to browsers.
 *
 * Refuses to write an entry without an explicit CC0/public-domain licence and
 * a source URL: that is the Phase 1 acceptance criterion, enforced here.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const processed = JSON.parse(readFileSync(path.join(ROOT, "assets/library/processed.json"), "utf8"));
const review = JSON.parse(readFileSync(path.join(ROOT, "scripts/assets/review.json"), "utf8"));
const maskReject = new Set<string>(review.maskReject ?? []);
const poseFix: Record<string, string> = review.poseFix ?? {};
const flags: Record<string, string[]> = review.flags ?? {};

const INSTITUTION: Record<string, string> = { met: "The Metropolitan Museum of Art", aic: "Art Institute of Chicago", si: "Smithsonian Institution" };

const manifest = [];
for (const e of processed) {
  if (maskReject.has(e.id) || maskReject.has(e.sourceId)) continue;
  const s = e.source;
  if (!(s.license === "CC0" || s.license === "Public Domain") || !s.url) {
    throw new Error(`${e.id}: missing licence or source URL`);
  }
  const ext = e.cutout ? "png" : "jpg";
  manifest.push({
    id: e.id,
    kind: e.kind,
    file: `${e.kind}s/${e.id}.${ext}`,
    web: e.file,
    w: e.w,
    h: e.h,
    cutout: e.cutout,
    ...(poseFix[e.id] || e.pose ? { pose: poseFix[e.id] ?? e.pose } : {}),
    tone: e.tone,
    ...(e.headBox ? { headBox: e.headBox } : {}),
    ...(flags[e.sourceId]?.includes("group") ? { group: true } : {}),
    ...(flags[e.sourceId]?.includes("silhouette") ? { silhouette: true } : {}),
    ...(flags[e.sourceId]?.includes("mounted") ? { mounted: true } : {}),
    source: { api: s.api, objectId: s.objectId, title: s.title, artist: s.artist, date: s.date, url: s.url, license: s.license },
  });
}

writeFileSync(path.join(ROOT, "assets/library/manifest.json"), JSON.stringify(manifest, null, 1));

const lines = [
  "# Credits",
  "",
  "Every image in the envelope library comes from a museum open-access programme and is",
  "public domain or CC0. Cut-outs and crops were made by `scripts/assets/process.py`.",
  "",
  ...manifest.map(
    (a) =>
      `- \`${a.id}\` — *${a.source.title.replace(/\s+/g, " ").trim()}*${a.source.artist ? `, ${a.source.artist}` : ""}${a.source.date ? ` (${a.source.date})` : ""}. ${INSTITUTION[a.source.api]}, ${a.source.license}. ${a.source.url}`,
  ),
  "",
  "## Fonts",
  "",
  "Self-hosted from github.com/google/fonts; licence files sit beside each font in `apps/web/public/fonts/`.",
  "",
  "- Homemade Apple, Special Elite — Apache License 2.0",
  "- Nothing You Could Do, La Belle Aurore, Reenie Beanie, IM FELL English SC, IM FELL Double Pica — SIL Open Font License 1.1",
  "",
  "## Sound",
  "",
  "The paper sound on the letter page is synthesized in the browser with Web Audio filtered noise; no audio file is used.",
  "",
];
writeFileSync(path.join(ROOT, "assets/library/CREDITS.md"), lines.join("\n"));

// What the compositor needs, nothing more: this ships to browsers.
const compact = manifest.map((a) => ({
  id: a.id,
  kind: a.kind,
  file: a.web,
  w: a.w,
  h: a.h,
  cutout: a.cutout,
  ...(a.pose ? { pose: a.pose } : {}),
  tone: a.tone,
  ...(a.headBox ? { headBox: a.headBox } : {}),
  ...(a.group ? { group: true } : {}),
  ...(a.silhouette ? { silhouette: true } : {}),
  ...(a.mounted ? { mounted: true } : {}),
}));
writeFileSync(path.join(ROOT, "packages/envelope/src/data/library.json"), JSON.stringify(compact));

const by: Record<string, number> = {};
for (const a of manifest) by[a.kind + (a.pose === "back" ? "(back)" : "")] = (by[a.kind + (a.pose === "back" ? "(back)" : "")] ?? 0) + 1;
console.log(manifest.length, "assets", by);
