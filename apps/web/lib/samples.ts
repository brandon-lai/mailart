import { composeEnvelope, defaultLibrary, type EnvelopeSpec, type RecipeId } from "@mailart/envelope";

/**
 * Demo letters. They are what the letter page serves when there is no
 * database, and what the landing page shows. Their GIF/PNG renders are
 * produced by the real worker (`pnpm worker --samples`) and committed under
 * public/samples/, so production shows real pipeline output, not mock-ups.
 */
export type Sample = {
  slug: string;
  senderName: string;
  recipientName: string;
  addressLine?: string;
  senderCity: string;
  sentAt: string;
  recipe: RecipeId;
  seed: string;
  body: string;
};

export const SAMPLES: Sample[] = [
  {
    slug: "SampleLetterLisbon0001",
    senderName: "Inês",
    recipientName: "Theo Lindqvist",
    addressLine: "c/o the 4th floor",
    senderCity: "Lisbon",
    sentAt: "2026-10-07T09:00:00Z",
    recipe: "stamp-heads",
    seed: "sample-lisbon-3",
    body: "Dear Theo,\n\nThe trams here still sound like someone dragging a chair across the ceiling, and I think of you every time one goes past the window.\n\nI found the bakery you told me about. You were right about the custard tarts and wrong about the queue, which was forty minutes and worth all of them.\n\nWrite back when the semester lets you breathe.\n\nWith love,",
  },
  {
    slug: "SampleLetterKyoto00002",
    senderName: "Ama",
    recipientName: "Margaret Okafor",
    senderCity: "Kyoto",
    sentAt: "2026-10-05T09:00:00Z",
    recipe: "specimen",
    seed: "sample-kyoto-1",
    body: "Margaret,\n\nI kept a list of every insect I saw this month, because you once told me that paying attention is a kind of prayer. There were eleven. One of them landed on my sleeve on the train and rode with me for three stops.\n\nI am bad at keeping in touch and good at thinking about you. Consider this letter an attempt to fix the first thing.\n\nYours, always,",
  },
  {
    slug: "SampleLetterOaxaca0003",
    senderName: "Rafa",
    recipientName: "Dear Old Felix",
    addressLine: "wherever you are now",
    senderCity: "Oaxaca",
    sentAt: "2026-10-01T09:00:00Z",
    recipe: "gallery",
    seed: "sample-oaxaca-2",
    body: "Felix —\n\nHappy birthday from a rooftop that smells of chocolate and woodsmoke. I bought you a terrible souvenir and I will not be describing it here.\n\nThirty-five is a good number. It has a five in it, which means you are allowed to start again on anything you like.\n\nUntil the next one,",
  },
];

export const sampleBySlug = (slug: string) => SAMPLES.find((s) => s.slug === slug);

export function sampleSpec(s: Sample): EnvelopeSpec {
  return composeEnvelope(
    { seed: s.seed, recipientName: s.recipientName, addressLine: s.addressLine, senderCity: s.senderCity, sentAt: s.sentAt, recipe: s.recipe },
    defaultLibrary,
  );
}
