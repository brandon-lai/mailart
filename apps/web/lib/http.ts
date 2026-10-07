import { NextResponse } from "next/server";
import { HttpError } from "./letters";
import { ModerationUnavailable } from "./moderation";

/** Route wrapper: HttpErrors become their status, everything else a logged 500. */
export async function handle(fn: () => Promise<unknown>) {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message, field: e.field }, { status: e.status });
    if (e instanceof ModerationUnavailable) {
      console.error("moderation unavailable:", e.message);
      return NextResponse.json({ error: "We couldn't check this letter just now, so it wasn't saved. Try again in a minute." }, { status: 503 });
    }
    console.error(e);
    return NextResponse.json({ error: "Something went wrong on our side." }, { status: 500 });
  }
}
