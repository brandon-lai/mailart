import { sendLetter } from "@/lib/letters";
import { handle } from "@/lib/http";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => sendLetter((await ctx.params).id));
}
