import { createDraft, HttpError } from "@/lib/letters";
import { handle } from "@/lib/http";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Expected JSON.");
    });
    return createDraft(body, req.headers);
  });
}
