export * from "./types";
export { Rng, hash32, envelopeSeed } from "./prng";
export { composeEnvelope, eligibleRecipes, addressViolations, inPostage, NAME_MAX } from "./compose";
export { renderEnvelope, envelopeUid, type RenderedEnvelope, type RenderOptions } from "./render";
export { bounds, overlap, LAYER_ORDER, MIN_ELEMENTS, MAX_ELEMENTS, MAX_ADDRESS_COVER } from "./builder";
export { SIZES, CANVAS_W } from "./generators/paper";
export { FONT_FAMILY } from "./generators/address";
import libraryData from "./data/library.json";
import type { Library } from "./types";
/** The processed asset library (compact manifest). Written by scripts/assets/manifest.ts. */
export const defaultLibrary = libraryData as Library;
