import { AwsClient } from "aws4fetch";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/**
 * S3-compatible storage (MinIO locally, R2/S3/Supabase Storage later) when
 * S3_ENDPOINT is set; otherwise files go to ./storage and the web app serves
 * them at /files/... — enough for local end-to-end runs.
 */
export async function putFile(key: string, file: string, contentType: string): Promise<string> {
  const body = await readFile(file);
  if (process.env.S3_ENDPOINT) {
    const aws = new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY!, service: "s3", region: process.env.S3_REGION || "auto" });
    const url = `${process.env.S3_ENDPOINT.replace(/\/$/, "")}/${process.env.S3_BUCKET}/${key}`;
    const res = await aws.fetch(url, { method: "PUT", body, headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" } });
    if (!res.ok) throw new Error(`S3 PUT ${res.status}: ${await res.text()}`);
    const base = process.env.PUBLIC_FILES_BASE_URL || `${process.env.S3_ENDPOINT.replace(/\/$/, "")}/${process.env.S3_BUCKET}`;
    return `${base.replace(/\/$/, "")}/${key}`;
  }
  const dir = process.env.STORAGE_DIR || path.join(ROOT, "storage");
  const dest = path.join(dir, key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, body);
  const site = (process.env.SITE_URL || "http://localhost:3335").replace(/\/$/, "");
  return `${site}/files/${key}`;
}
