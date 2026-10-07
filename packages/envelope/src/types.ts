export type RecipeId = "stamp-heads" | "gallery" | "dense-collage" | "specimen";
export const RECIPES: RecipeId[] = ["stamp-heads", "gallery", "dense-collage", "specimen"];

export type EnvelopeInput = {
  seed: string; // hash(letterId + shuffleIndex)
  recipientName: string;
  addressLine?: string;
  senderCity: string;
  sentAt: string; // ISO date for the postmark
  recipe?: RecipeId; // forced in dev, picked by seed otherwise
};

export type Stock = "cream" | "kraft" | "manila" | "airmail";
export type SizeId = "business" | "square";

export type PaperSpec = {
  seed: number;
  stock: Stock;
  sizeId: SizeId;
  color: string;
  grain: number; // 0..1, strength of the feTurbulence grain
  foxing: { x: number; y: number; r: number; o: number }[];
  creases: { x1: number; y1: number; x2: number; y2: number; o: number }[];
  coffeeRing?: { x: number; y: number; r: number; o: number };
  edgeDarkness: number; // 0..1
};

export type FlapSpec = {
  seed: number;
  shape: "pointed" | "wallet" | "round";
  depth: number; // px, measured down from the hinge
  outside: string;
  inside: string;
  liner?: "tint" | "marble" | "none";
  linerColor: string;
};

export type LayerKind = "scrap" | "address" | "cutout" | "stamp" | "label" | "postmark" | "tape";

export type Layer = {
  id: string;
  kind: LayerKind;
  assetId?: string; // manifest id when it uses a library image
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number; // degrees
  props: Record<string, unknown>;
};

export type EnvelopeSpec = {
  version: 1;
  recipe: RecipeId;
  seed: string;
  size: { w: number; h: number };
  paper: PaperSpec;
  flap: FlapSpec;
  layers: Layer[]; // ordered bottom to top
};

export type AssetKind = "figure" | "bust" | "animal" | "botanical" | "insect" | "vignette" | "ephemera";
export type Pose = "front" | "side" | "back";
export type Tone = "bw" | "sepia" | "color";
export type Box = { x: number; y: number; w: number; h: number };

/** One manifest entry, as the compositor needs it (sources live in the full manifest). */
export type Asset = {
  id: string;
  kind: AssetKind;
  file: string; // path under the web library base, e.g. "figures/fig_0042.webp"
  w: number;
  h: number;
  cutout: boolean;
  pose?: Pose;
  tone: Tone;
  headBox?: Box;
  /** several people in one cut-out: a stamp can only replace one head */
  group?: boolean;
  /** solid black profile: prints as a blob at stamp size */
  silhouette?: boolean;
  /** small print on a large blank sheet: only ever used cropped (as a stamp) */
  mounted?: boolean;
};

export type Library = Asset[];

export type InkFamily = "cool" | "warm";
