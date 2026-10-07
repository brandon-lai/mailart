import { readFile } from "node:fs/promises";
import path from "node:path";

/** Serves rendered GIF/PNGs from local storage when no S3 bucket is configured (local runs). */
const ROOT = process.env.STORAGE_DIR || path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../../storage");
const TYPES: Record<string, string> = { ".gif": "image/gif", ".png": "image/png" };

export async function GET(_req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const rel = key.join("/");
  if (rel.includes("..") || !/^letters\/[A-Za-z0-9]{22}\/envelope\.(gif|png)$/.test(rel)) return new Response("not found", { status: 404 });
  try {
    const body = await readFile(path.join(ROOT, rel));
    return new Response(body, { headers: { "Content-Type": TYPES[path.extname(rel)], "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
