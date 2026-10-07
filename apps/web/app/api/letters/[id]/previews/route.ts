import { getLetter } from "@mailart/db";
import { HttpError, previewSpecs, requireDatabase } from "@/lib/letters";
import { handle } from "@/lib/http";

/** Three EnvelopeSpecs for seeds n*3 .. n*3+2. Drawn in the browser; only the chosen one is rendered to GIF. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireDatabase();
    const { id } = await ctx.params;
    const shuffle = Number(new URL(req.url).searchParams.get("shuffle") ?? 0) || 0;
    const letter = await getLetter(id);
    if (!letter) throw new HttpError(404, "No such letter.");
    const specs = previewSpecs(letter, shuffle);
    return { shuffle, specs: specs.map((spec, k) => ({ index: Math.max(0, Math.floor(shuffle)) * 3 + k, spec })) };
  });
}
