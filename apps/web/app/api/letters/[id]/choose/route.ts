import { chooseEnvelope } from "@/lib/letters";
import { handle } from "@/lib/http";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { index } = (await req.json().catch(() => ({}))) as { index?: number };
    const spec = await chooseEnvelope(id, Number(index));
    return { ok: true, recipe: spec.recipe };
  });
}
