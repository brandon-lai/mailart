import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
export const MAX_BYTES = 1024 * 1024;

/** The size ladder from the spec: raise --lossy, then reduce width. First rung under 1 MB wins. */
export const LADDER: { width: number; lossy: number }[] = [
  { width: 1200, lossy: 20 },
  { width: 1200, lossy: 40 },
  { width: 1200, lossy: 80 },
  { width: 1200, lossy: 120 },
  { width: 900, lossy: 40 },
  { width: 900, lossy: 80 },
  { width: 900, lossy: 120 },
  { width: 600, lossy: 40 },
  { width: 600, lossy: 80 },
  { width: 600, lossy: 120 },
];

/**
 * ffmpeg: palette from the frames (stats_mode=diff favours what moves), then
 * paletteuse with ordered (bayer) dithering, which compresses far better than
 * error diffusion. -loop -1: play once and stay on the last frame.
 * gifsicle -O3 --lossy then shrinks it further.
 */
export async function encodeGif(frameDir: string, fps: number, out: string) {
  const pattern = path.join(frameDir, "f%03d.png");
  const log: string[] = [];
  let lastWidth = 0;
  let base = "";
  for (const rung of LADDER) {
    if (rung.width !== lastWidth) {
      base = path.join(frameDir, `base-${rung.width}.gif`);
      const scale = rung.width === 1200 ? "" : `scale=${rung.width}:-1:flags=lanczos,`;
      await run("ffmpeg", [
        "-y", "-v", "error",
        "-framerate", String(fps), "-i", pattern,
        "-filter_complex", `[0:v]${scale}split[a][b];[a]palettegen=stats_mode=diff:max_colors=256[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
        "-loop", "-1",
        base,
      ]);
      lastWidth = rung.width;
    }
    await run("gifsicle", ["-O3", `--lossy=${rung.lossy}`, "--no-loopcount", base, "-o", out]);
    const size = (await stat(out)).size;
    log.push(`${rung.width}px lossy=${rung.lossy}: ${(size / 1024).toFixed(0)} KB`);
    if (size <= MAX_BYTES) return { file: out, bytes: size, rung, log };
  }
  throw new Error(`GIF stayed over 1 MB at every rung: ${log.join("; ")}`);
}
