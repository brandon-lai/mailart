import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Moderation for everything a letter puts in front of someone else: the body,
 * both names, and the address line (which is drawn on the envelope).
 *
 * Two passes. A local word list always runs and needs no configuration. When
 * MODERATION_API_KEY is set (an Anthropic API key), Claude classifies the text
 * too. A refusal from the classifier is treated as a reject: it means the text
 * itself tripped safety classifiers, which is the answer we were asking for.
 */

export type ModerationInput = { body: string; senderName: string; recipientName: string; addressLine?: string };
export type ModerationResult = { ok: true } | { ok: false; field: keyof ModerationInput | "letter"; message: string };

// Deliberately short: slurs and the most common harassment/sexual terms. The
// model pass handles context; this catches the obvious without a network call.
const BLOCKLIST = [
  "nigger", "nigga", "faggot", "fag", "retard", "kike", "spic", "chink", "tranny", "cunt",
  "kill yourself", "kys", "rape you", "i will kill you", "child porn",
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[0@]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/3/g, "e")
    .replace(/\$/g, "s");

export function localCheck(input: ModerationInput): ModerationResult {
  for (const field of ["recipientName", "addressLine", "senderName", "body"] as const) {
    const v = input[field];
    if (!v) continue;
    const t = ` ${norm(v).replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ")} `;
    if (BLOCKLIST.some((w) => t.includes(` ${w} `))) {
      return { ok: false, field, message: plainMessage(field) };
    }
  }
  return { ok: true };
}

function plainMessage(field: keyof ModerationInput | "letter") {
  if (field === "recipientName" || field === "addressLine")
    return "That can't go on an envelope. Names and the address line are drawn on the image, so they have to be something you'd write on real mail.";
  if (field === "senderName") return "Please use a name you'd sign a letter with.";
  return "We can't send this letter. It reads as abusive or harassing, which this service doesn't carry.";
}

const Verdict = z.object({
  allowed: z.boolean(),
  field: z.enum(["body", "senderName", "recipientName", "addressLine", "none"]),
  category: z.enum(["none", "harassment", "hate", "threat", "sexual", "self_harm_encouragement", "spam_or_scam", "other"]),
});

const SYSTEM = `You moderate a service that delivers personal letters by email inside decorated envelopes. Decide whether a letter may be sent.

Allow ordinary personal correspondence of every kind: love letters, grief, apologies, arguments, complaints, frank or emotional language, mild profanity, jokes between friends.

Block only when the letter is clearly: harassment or intimidation of the recipient; hate directed at a protected group; a threat of violence; sexual content aimed at someone who did not ask for it; encouragement of self-harm; or spam, phishing, or a scam (links asking for money, credentials, or crypto).

The recipient name and address line are printed on the envelope image, so they must also be something a person would write on real mail.

Return the first field that fails, or "none" when allowed.`;

let client: Anthropic | null = null;

export async function moderate(input: ModerationInput): Promise<ModerationResult> {
  const local = localCheck(input);
  if (!local.ok) return local;
  const key = process.env.MODERATION_API_KEY;
  if (!key) return { ok: true };
  client ??= new Anthropic({ apiKey: key, timeout: 20_000, maxRetries: 1 });
  try {
    const res = await client.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(Verdict) },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: `<recipient_name>${input.recipientName}</recipient_name>\n<address_line>${input.addressLine ?? ""}</address_line>\n<sender_name>${input.senderName}</sender_name>\n<letter>\n${input.body}\n</letter>`,
        },
      ],
    });
    if (res.stop_reason === "refusal") return { ok: false, field: "letter", message: plainMessage("letter") };
    const v = res.parsed_output;
    if (!v) throw new Error("moderation returned no verdict");
    if (v.allowed) return { ok: true };
    const field = v.field === "none" ? "letter" : v.field;
    return { ok: false, field, message: plainMessage(field) };
  } catch (e) {
    // Fail closed: an unmoderated letter must not reach an inbox.
    if (e instanceof Anthropic.RateLimitError) throw new ModerationUnavailable("rate limited");
    if (e instanceof Anthropic.APIError) throw new ModerationUnavailable(`API ${e.status}`);
    throw new ModerationUnavailable(String(e));
  }
}

export class ModerationUnavailable extends Error {}
