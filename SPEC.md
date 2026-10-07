# Mail Art Email Tech Spec

Oct 7, 2026 · @Brandon

## Summary

Build a web app where someone writes a letter and the recipient gets an email with a one-of-a-kind collage envelope that opens as an animated GIF, with the letter text below it. This spec covers v1 (Collage style only), from the [Mail Art Email PRD](https://claude.ai/code/artifact/cdf84d8e-b5a1-41fe-bd63-c500984ef7ce).

**Ground rules for Claude Code**

1. **No AI image generation in v1.** Every envelope is produced by code: real public-domain images plus procedural generators. AI image models are a later phase.
2. **You source the assets yourself.** Use the open-access APIs listed in the asset pipeline. Only keep items whose license is public domain or CC0, and record the source for every file.
3. **Determinism.** The same seed and letter data always produce the same envelope, pixel for pixel. All randomness goes through one seeded PRNG.
4. **Look at your own output.** After each phase, render a contact sheet of envelopes and view it before moving on. Fix anything that looks templated, broken, or ugly.
5. **Ask before spending money or creating accounts.** Free API keys and paid services both need Brandon's go-ahead.

## Stack and repo layout

A pnpm monorepo, TypeScript everywhere except one Python script for background removal. Everything runs locally with Docker first; hosting is decided after Phase 3.

| Piece | Choice | Notes |
| --- | --- | --- |
| Web app | Next.js (App Router) | Compose page, letter page, API routes |
| Envelope engine | Plain TypeScript package | Pure functions: seed + letter data in, envelope SVG/HTML out |
| Render worker | Node + Playwright (Chromium) | Polls a jobs table, renders PNG and GIF |
| GIF tools | ffmpeg (palette) + gifsicle `-O3 --lossy` | Both installed in the worker image |
| Database | Postgres with Drizzle ORM | Letters, jobs, senders, blocks |
| Files | S3-compatible storage (MinIO locally) | Assets and rendered images |
| Email | React Email templates; Mailpit locally, Resend or Postmark later | Mailpit catches all mail in dev |
| Asset scripts | TypeScript fetchers + Python `rembg` for cut-outs | Run once to build the library |

```
mail-art/
  apps/web/                 Next.js app
  packages/envelope/        generators, compositor, recipes, types
  packages/db/              Drizzle schema and queries
  packages/emails/          React Email templates
  workers/render/           Playwright render + GIF pipeline
  scripts/assets/           fetch, cut out, tag, build manifest
  assets/library/           processed assets + manifest.json (git-lfs or storage)
  assets/raw/               downloads, gitignored
  docker-compose.yml        postgres, minio, mailpit
  SPEC.md                   this document
```

## Asset pipeline

Claude Code builds a library of about 250 processed images from open-access museum APIs, then cuts out and tags them. Only paper textures, stamps, postmarks, and ephemera are generated in code; the figures and vignettes are real public-domain images.

**Sources (confirm field names against each API's docs before writing fetchers)**

| Source | Access | License filter | Use for |
| --- | --- | --- | --- |
| [The Met Collection API](https://www.metmuseum.org/perspectives/met-collection-api-2) | No key | Open Access images are CC0; keep only public-domain objects | Prints, engravings, fashion plates, photographs |
| [Art Institute of Chicago API](https://api.artic.edu/docs) | No key; images via IIIF | `is_public_domain = true` | Engravings, botanical and natural history prints |
| [Smithsonian Open Access](https://www.si.edu/openaccess/devtools) | Free api.data.gov key (ask first) | CC0 media only; restricted objects have no media | Portrait photographs, specimens, postal-era ephemera |

Rules: skip any item without an explicit public-domain or CC0 flag. Do not download real postage stamp images; stamps are generated (see generators). Respect rate limits and cache all API responses in `assets/raw/`.

**Target library**

| Category | Count | Example search terms |
| --- | --- | --- |
| Figures, full body | 60 | cabinet card, carte de visite, fashion plate, Victorian woman, gentleman top hat |
| Portrait busts | 40 | engraved portrait, bust, profile portrait |
| Animals | 30 | natural history plate, monkey engraving, bird print |
| Botanical and insects | 30 | butterfly plate, botanical print, moth |
| Vignettes | 30 | sailing ship, harbor, landscape etching, monument |
| Ephemera backgrounds | 20 | map, ledger, handwritten letter, sheet music (pre-1929 only) |

**Steps (scripts in `scripts/assets/`)**

1. **Fetch:** run each search, keep license-flagged hits with images, download at up to 2000 px long edge, save `source.json` beside each file.
2. **Review:** build contact sheets of 48 thumbnails, view them, and mark accept or reject. Reject blurry, cropped, busy-background, or off-theme images. Aim for 2x the target per category so rejects don't leave gaps.
3. **Cut out:** run `rembg` on figures, animals, botanicals, and insects. Use its default general-purpose models only; do not use any background-removal model with a non-commercial license. Review masks on a contact sheet over a mid-gray background and reject ragged ones.
4. **Tag:** for each accepted asset record kind, pose (front, side, back), tone (bw, sepia, color), and for figures the head box. Head box = the top of the alpha mask down to about 1/7 of the figure height, centered on the mask in that band; verify on a contact sheet with boxes drawn.
5. **Normalize:** trim transparent edges, cap at 1600 px, save as PNG (cut-outs) or JPEG (rectangles).
6. **Manifest:** write `assets/library/manifest.json`.

```json
{
  "id": "fig_0042",
  "kind": "figure",
  "file": "figures/fig_0042.png",
  "w": 820, "h": 1600,
  "pose": "back",
  "tone": "bw",
  "headBox": { "x": 300, "y": 0, "w": 220, "h": 228 },
  "source": { "api": "met", "objectId": "123456", "title": "...", "url": "...", "license": "CC0" }
}
```

Also generate `assets/library/CREDITS.md` from the manifest, one line per asset with title, institution, and link.

## Procedural generators

Each generator is a pure function `(rng, params) => SVG fragment` in `packages/envelope/generators/`. Output is SVG so it scales and renders identically in Playwright and on the web page.

**Paper**

- Sizes: business (about 2.3:1) and square-ish (about 1.5:1). Canvas is 1200 px wide.
- Stocks: cream wove, kraft, manila, airmail (red and blue diagonal border stripes on white).
- Aging: SVG `feTurbulence` grain, 0 to 6 foxing spots (small soft sepia blots), faint fold creases, darker edges, one optional coffee ring.
- Flap: a back-flap shape drawn as a separate layer so the renderer can animate it. Edges get a slight torn wobble from a noise-displaced path.

**Stamps (all fictional)**

- Picture: crop a portrait (around the head box) or the center of a vignette, then tint to one ink color: carmine, violet, ultramarine, green, sepia, or orange.
- Frame: rectangle or oval cartouche with corner ornaments, a denomination ("4", "1½", "50c") in a period serif, and an invented country name from a list in `data/countries.json` (for example "Republic of Vellumore"). Never use a real nation's name or postal emblem.
- Edges: white margin plus a perforation mask (half-circles cut along every edge).
- Variants: single, pair, block of 4, and "framed" (stamp inside a hand-drawn ornate picture frame with a hanging wire, for the gallery recipe).

**Postmarks and labels**

- Circular date stamp: double ring, sender's city set on a text path, date in the center ("7 OCT 2026"), 5 to 7 wavy cancellation bars.
- Ink: black, red, or violet, with uneven coverage from noise displacement and a speckle mask so it looks hand-struck.
- Labels: "PAR AVION / BY AIR MAIL", "SPECIAL DELIVERY", "PRINTED MATTER", and a registered "R" label with a random number.

**Address block**

- Recipient name only, plus an optional short line the sender writes ("c/o the 4th floor"). Never render the recipient's email address on the envelope.
- Fonts: 4 handwriting fonts and 1 typewriter font from Google Fonts. Keep only fonts whose license file is OFL or Apache 2.0, and self-host them.
- Per-line baseline jitter, rotation between -2 and 2 degrees, ink in blue-black or sepia.

**Ephemera**

- Washi tape strips: semi-transparent, patterned, torn ends.
- Tickets and tags: typewriter text ("ITEM NO. 1", "Papiers & Lettres"-style phrases from a list in `data/phrases.json`).
- Scraps: torn rectangles cropped from the ephemera backgrounds.

## Compositor

The compositor turns a seed and letter data into an `EnvelopeSpec`: a JSON list of every element with its resolved position. The spec is stored in the database, and both the renderer and the web page draw from it, so they always match.

```ts
type EnvelopeInput = {
  seed: string;            // hash(letterId + shuffleIndex)
  recipientName: string;
  addressLine?: string;
  senderCity: string;
  sentAt: string;          // ISO date for the postmark
  recipe?: RecipeId;       // forced in dev, picked by seed otherwise
};

type EnvelopeSpec = {
  version: 1;
  recipe: RecipeId;
  size: { w: number; h: number };
  paper: PaperSpec;
  flap: FlapSpec;
  layers: Layer[];         // ordered bottom to top
};

type Layer = {
  id: string;
  kind: 'scrap' | 'address' | 'cutout' | 'stamp' | 'label' | 'postmark' | 'tape';
  assetId?: string;        // manifest id when it uses a library image
  x: number; y: number; w: number; h: number;
  rotate: number;          // degrees
  props: Record<string, unknown>;
};
```

Use one seeded PRNG (for example mulberry32) passed down to every generator. No `Math.random` anywhere in the package.

**Composition recipes (v1)**

| Recipe | What it looks like | Asset needs | Key rule |
| --- | --- | --- | --- |
| Stamp heads | 1 to 4 full-body figures in a row; each head is replaced by a portrait stamp lined up with the postage corner | Front-facing figures with head boxes; portrait stamps | Stamp center sits on the head box center, stamp width about 1.3x head width |
| Gallery | 2 to 3 framed stamps hung from the top edge by strings; 2 to 4 figures below, seen from behind, looking up | Back-pose figures; framed stamps | Each figure faces a frame; frames evenly spaced |
| Dense collage | Airmail border, a large portrait or animal, 3 to 6 stamps, labels, tape, 2 postmarks | Any portrait or animal; scraps | Most elements, but the address stays readable |
| Specimen | Butterflies or botanicals pinned around one portrait or animal, with an ornate label | Insects, botanicals, one portrait | Small items spaced on a loose grid with jitter |

**Layout rules for every recipe**

1. Layer order: paper, scraps, address, cut-outs, stamps, labels, postmarks, tape. In Stamp heads, the stamp sits above its figure.
2. Protect the address block: only postmarks and tape may cover it, and by no more than 15% of its area.
3. Postage zone is top right. At least one stamp lives there in every recipe, and one postmark overlaps it.
4. Pick one ink family per envelope (cool or warm) and draw stamp and postmark colors from it.
5. Keep total elements between 6 and 14. Rotations stay within -8 to 8 degrees, except tape.
6. Never reuse the same asset twice in one envelope.

**Dev tool:** a `/dev/gallery` page that renders 24 envelopes from random seeds, with recipe and seed shown under each and a reroll button. This is how Claude Code (and Brandon) judge quality.

## Renderer

The worker loads the envelope as an HTML page in headless Chromium, steps a paused animation frame by frame, screenshots each frame, and encodes a GIF that plays once and stays under 1 MB.

**The opening animation (front stays visible the whole time)**

| Time | What happens |
| --- | --- |
| 0 to 0.6 s | Closed envelope, front facing, held still. This is also the frame older Outlook shows. |
| 0.6 to 1.0 s | Envelope settles with a small tilt and a soft shadow shift. |
| 1.0 to 1.6 s | Back flap swings up past the top edge (hinged at the top, 3D `rotateX`), showing its darker inside. |
| 1.6 to 2.4 s | Folded letter slides up out of the envelope, showing the first line of the letter in a typewriter font. |
| 2.4 s onward | Final frame held; GIF does not loop. |

The frame is taller than the envelope (about 1.6x the envelope height) to leave room for the flap and letter. Background is a solid warm off-white with the shadow baked in, because GIF transparency has hard edges.

**Frame capture**

1. Load `/render/[letterId]` (an internal route that draws the stored `EnvelopeSpec` with CSS animations defined through the Web Animations API, all paused).
2. Wait for `document.fonts.ready` and all images to decode.
3. For each frame at 15 fps, set `currentTime` on every animation, then take a clipped screenshot.
4. Also save a 1200 px PNG of the closed envelope (for the web page and link previews).

**Encoding and size ladder**

1. ffmpeg: build a palette from the frames (`palettegen` with `stats_mode=diff`), then encode with `paletteuse` and ordered dithering, no looping.
2. gifsicle: `-O3 --lossy=N` to shrink further.
3. If the result is over 1 MB, step down: raise `--lossy` (40, 80, 120), then reduce width (1200, 900, 600 px). Stop at the first version under 1 MB and log which step it took.
4. Email displays the GIF at 600 px wide regardless of its pixel width.

**Acceptance checks the worker runs on every job**

- GIF under 1 MB, first frame is the closed envelope, last frame shows the letter.
- Render plus encode under 30 s on a laptop (a target to measure, not a known number).
- Same seed renders byte-identical PNG twice in a row.

## Data model and API routes

Five tables and a small set of routes. Envelope previews on the compose page are drawn in the browser from the `EnvelopeSpec`; only the chosen envelope gets rendered to GIF.

**Tables (Drizzle, Postgres)**

| Table | Key columns |
| --- | --- |
| `senders` | id, email, name, verified\_at, created\_at |
| `letters` | id, public\_slug (22-char random), sender\_id, recipient\_name, recipient\_email, address\_line, sender\_city, body, seed, recipe, envelope\_spec (jsonb), status, gif\_url, png\_url, sent\_at, created\_at |
| `render_jobs` | id, letter\_id, status, attempts, error, locked\_at, finished\_at |
| `verification_tokens` | token\_hash, sender\_id, letter\_id, expires\_at, used\_at |
| `blocked_recipients` | email\_hash, created\_at |

Letter `status` moves: `draft` → `awaiting_verification` → `queued` → `rendering` → `sending` → `sent`, or `failed` from any step after `queued`. Already-verified senders skip `awaiting_verification`.

**Routes**

| Method and path | Does |
| --- | --- |
| `POST /api/letters` | Create a draft; runs moderation and rate-limit checks; returns letter id |
| `GET /api/letters/:id/previews?shuffle=n` | Returns 3 `EnvelopeSpec`s for seeds n*3 to n*3+2 |
| `POST /api/letters/:id/choose` | Saves the chosen seed and spec |
| `POST /api/letters/:id/send` | Sends a verification email, or queues the render if the sender is already verified |
| `GET /verify?token=` | Marks sender verified, queues the render, shows "your letter is on its way" |
| `GET /l/:slug` | The "Open in full" letter page |
| `GET /block?token=` | Recipient opt-out page; confirming adds their email hash to `blocked_recipients` |
| `GET /render/:id` | Internal page the worker screenshots; requires a worker secret header |

The worker claims jobs with `SELECT ... FOR UPDATE SKIP LOCKED`, retries up to 3 times, then marks the letter `failed` and emails the sender.

## Email template and web pages

The email is a simple 600 px table layout: the GIF on top, the letter as real text below, one button, and a footer. The web pages reuse the same `EnvelopeSpec` so the envelope looks identical everywhere.

**Email (`packages/emails/Letter.tsx`)**

- Headers: From `"{Sender name} via {Site}" <letters@{sending domain}>`, Reply-To the sender's email, subject `{Sender name} sent you a letter`. Include a one-click `List-Unsubscribe` header pointing at the block link.
- Preheader: "A letter from {Sender name}, sealed and stamped." Never put letter text in the preheader.
- GIF: `width="600"`, `alt="An envelope from {Sender name}, opening"`, linked to the letter page.
- Letter: the body as HTML paragraphs in Georgia, then the sender's name as sign-off.
- Button: "Open in full" to `/l/:slug`.
- Footer: "Sent with {Site}." plus "Don't want letters from {Site}? Block future letters."
- Send a plain-text part with the letter and both links.
- Keep the HTML small (Gmail clips large messages, around 102 KB; confirm the current limit). Test light and dark mode in Apple Mail and Gmail.

**Pages**

| Route | Content |
| --- | --- |
| `/` | Landing and compose: a desk scene, then the steps from the PRD flow (write, address, pick envelope, verify, send) |
| `/l/:slug` | Closed envelope PNG with "Tap to open"; on tap, the live HTML version of the opening plays with a paper sound, then the letter appears on a paper sheet. Footer: "Write a letter back" |
| `/dev/gallery` | Contact sheet of random envelopes for review (dev only) |

The `/l/:slug` page sets `og:image` to the closed-envelope PNG so shared links look like the envelope. The paper sound is either a CC0 file with its source in `CREDITS.md` or synthesized with Web Audio filtered noise.

## Safety, abuse controls, and config

All of these ship before any email reaches a real inbox outside Mailpit.

| Control | Rule |
| --- | --- |
| Sender verification | One-time link to the sender's email before their first letter; token expires in 24 hours |
| Rate limits | 5 letters per sender per day, 2 per recipient per day, 20 per IP per day (tune later) |
| Recipient block | Check `blocked_recipients` (hashed email) before queueing; silently drop blocked sends |
| Moderation | Run letter body, names, and address line through a moderation call; reject with a plain message |
| Envelope text | Recipient name and address line are capped at 40 characters and checked by moderation, since they are drawn on the image |
| Privacy | No open-tracking pixels. Recipient email is never drawn on the envelope or shown on `/l/:slug` |
| Slugs | 22-character random slugs; letter pages send `noindex` |

**Environment variables (`.env.example`)**

```
DATABASE_URL=
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=
PUBLIC_ASSET_BASE_URL=
EMAIL_PROVIDER=mailpit        # mailpit | resend | postmark
EMAIL_API_KEY=
SENDING_DOMAIN=
SITE_NAME=
SITE_URL=
WORKER_SECRET=
MODERATION_API_KEY=
SMITHSONIAN_API_KEY=          # api.data.gov, only for the asset scripts
```

When moving to a real provider: set up SPF, DKIM, and DMARC on a dedicated sending subdomain and ramp volume slowly.

## Build phases

Six phases, built in order. Claude Code stops for Brandon's review at the end of Phases 1, 2, and 3, because those decide whether the envelopes look good enough to keep going.

**Phase 0: Scaffold**

- [ ] Monorepo, `docker-compose.yml` (Postgres, MinIO, Mailpit), Drizzle schema and migrations, seeded PRNG utility.
- [ ] Done when `pnpm dev` starts the web app and worker, and migrations apply cleanly.

**Phase 1: Asset library** (stop for review)

- [ ] Fetchers for The Met, Art Institute of Chicago, and Smithsonian; review, cut-out, tag, normalize, manifest, credits.
- [ ] Done when every category meets its target count, every manifest entry has a CC0 or public-domain license and source URL, and contact sheets are saved in `assets/review/`.

**Phase 2: Generators and compositor** (stop for review)

- [ ] Paper, stamp, postmark, label, address, and ephemera generators; 4 recipes; `/dev/gallery`.
- [ ] Unit tests: same seed gives identical spec; address-protection rule never broken across 500 seeds; no asset repeats within an envelope.
- [ ] Claude Code screenshots the gallery, reviews it, fixes what looks off, and writes a short note of what changed.

**Phase 3: Renderer and GIF** (stop for review)

- [ ] Worker, `/render/:id`, opening animation, frame capture, encoding with the size ladder, upload to storage.
- [ ] Done when 20 random envelopes all produce GIFs under 1 MB with a closed first frame and letter-out last frame.
- [ ] Produce one sample email Brandon can forward to Gmail, Apple Mail, and Outlook for the real inbox test.

**Phase 4: Product flow**

- [ ] Compose page with 3 previews and shuffle, verification, send pipeline, email template, `/l/:slug`, `/block`.
- [ ] Done when a letter goes from compose to Mailpit end to end, and the letter page plays the opening on tap.

**Phase 5: Safety and deploy prep**

- [ ] Rate limits, moderation, recipient block, email provider adapter, `noindex`, `.env.example`, README with run and deploy notes.
- [ ] Tests for each limit and the block list. Ask Brandon before choosing hosting or creating any accounts.

## Kickoff prompt for Claude Code

Export this doc as Markdown, save it as `SPEC.md` in an empty folder, then paste the prompt below into Claude Code from that folder.

```
Read SPEC.md fully before writing any code. It is the tech spec for a web app that
sends letters by email inside procedurally generated vintage mail art envelopes,
with an opening animation delivered as a GIF.

How to work:
- Build the phases in SPEC.md in order. Use a task list so I can see progress.
- You are responsible for sourcing all image assets yourself from the open-access
  APIs listed in the spec. Keep only items flagged public domain or CC0, and record
  the source of every file in the manifest and CREDITS.md.
- Do not use AI image generation. Everything visual comes from the asset library
  plus the procedural generators.
- Look at your own output. Render contact sheets and screenshots, view them, and
  fix anything that looks templated, broken, or ugly before calling a phase done.
- Stop and check in with me at the end of Phases 1, 2, and 3, with screenshots
  and a short note of what you'd change next.
- Ask me before creating accounts, requesting API keys, spending money, or
  choosing hosting.
- If the spec is wrong or something in it doesn't work in practice, tell me what
  you found and propose a change instead of quietly working around it.

Start with Phase 0, then begin Phase 1 with The Met and Art Institute of Chicago
fetchers (no keys needed).
```

## Sources

- [The Met Collection API launch](https://www.metmuseum.org/perspectives/met-collection-api-2) and [Open Access at The Met](https://www.metmuseum.org/es/openaccess)
- [Art Institute of Chicago API docs](https://api.artic.edu/docs)
- [Smithsonian Open Access developer tools](https://www.si.edu/openaccess/devtools)
- [rembg on PyPI health page (MIT license)](https://depscope.dev/pkg/pypi/rembg)
- [gifsicle lossy compression](https://kornel.ski/lossygif)
- [Mail Art Email PRD](https://claude.ai/code/artifact/cdf84d8e-b5a1-41fe-bd63-c500984ef7ce) for email client support sources
