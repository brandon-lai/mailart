# Mailart

**Write a letter. The recipient gets an email with a one-of-a-kind collage envelope that opens as an animated GIF, with the letter text below it.**

Built from `SPEC.md` (the Mail Art Email tech spec, v1: Collage style only) and the Mail Art Email PRD.

- Every envelope is assembled by code from 294 public-domain/CC0 museum images plus procedural paper, stamps, postmarks, labels and tape. No AI image generation.
- Same seed + letter data → same `EnvelopeSpec` → same pixels. One seeded PRNG (mulberry32); `Math.random` never appears in `packages/envelope`.
- The spec is stored per letter and drawn by one renderer everywhere: compose previews, the GIF worker, the letter page.

## The state of it

| | Status |
| --- | --- |
| Asset library (Phase 1) | Done. 294 assets, every category over target, every entry CC0/PD with a source URL. Contact sheets in `assets/review/`. |
| Generators + compositor + `/dev/gallery` (Phase 2) | Done. 4 recipes. 15 compositor tests over 500 seeds. |
| Renderer + GIF (Phase 3) | Done. `pnpm worker --check 20`: 20/20 under 1 MB, closed first frame, letter-out last frame, byte-identical PNG, 8–20 s each. One spec change, see "Spec findings". |
| Product flow (Phase 4) | Done locally end to end: compose → verify → render → Mailpit → `/l/:slug` plays on tap. |
| Safety (Phase 5) | Done. Verification, rate limits, block list, moderation, noindex, 22-char slugs. 16 integration tests. |
| Production | Web app deploys to Vercel in **demo mode** (no database, no email provider): compose and previews work, the gallery and sample letters work, sending refuses with a plain message. See "What's blocked". |

## Run it locally

Needs Node 22, pnpm 9, Postgres, Mailpit, ffmpeg, gifsicle. Either `docker compose up postgres mailpit minio` or Homebrew (`brew install postgresql@16 mailpit ffmpeg gifsicle`).

```bash
pnpm install
cp .env.example .env                      # set DATABASE_URL, HASH_SECRET, WORKER_SECRET
cp .env apps/web/.env.local
pnpm db:migrate
npx playwright install chromium           # once, for the worker
pnpm --filter web dev                     # http://localhost:3335
pnpm worker                               # in another shell: polls render_jobs
open http://localhost:8025                # Mailpit catches every email
```

Useful:

```bash
pnpm test                                 # compositor tests; API tests run when the dev server is up
pnpm worker --check 20                    # Phase 3 acceptance on 20 random envelopes (no DB needed)
pnpm worker --samples                     # re-render the demo letters into apps/web/public/samples
open http://localhost:3335/dev/gallery    # 24 random envelopes; ?recipe=gallery&n=6&batch=abc
```

Asset pipeline (already run; outputs committed):

```bash
pnpm assets:fetch [category]              # Met + AIC search, license-filtered, cached in assets/raw
pnpm assets:sheets raw                    # 48-up contact sheets for review → scripts/assets/review.json
python3 -m venv .venv && .venv/bin/pip install "rembg[cpu]" pillow numpy scipy
pnpm assets:cutout                        # rembg (u2net, Apache-2.0), split insect plates, tag, normalize
pnpm assets:sheets cutouts | heads        # mask review over mid-gray; head boxes drawn
pnpm assets:manifest                      # manifest.json, CREDITS.md, packages/envelope/src/data/library.json
```

## Layout

```
apps/web/              Next.js 16: compose (/), /l/:slug, /verify, /block, /dev/gallery, /render/:id, API routes
packages/envelope/     generators, builder, recipes, compositor, renderer (SVG strings), seeded PRNG
packages/db/           Drizzle schema + migrations, lazy postgres.js client, queries, hashing/tokens
packages/emails/       React Email templates (letter, verify, sent, failed) + Mailpit/Resend/Postmark adapters
workers/render/        Playwright capture, ffmpeg + gifsicle size ladder, storage, job loop
scripts/assets/        fetch.ts, sheets.ts, process.py, manifest.ts, review.json (every accept/reject decision)
assets/library/        manifest.json, CREDITS.md, ids.json (masters are regenerable, gitignored)
assets/review/         contact sheets: raw candidates, cut-outs over gray, head boxes
apps/web/public/lib/   900 px WebP derivatives of the library (what pages and the renderer load)
```

## Decisions, and why

- **One pass instead of stopping after Phases 1–3.** This was built with `/build`, which runs PRD to deploy without check-ins. The spec's own rule about money and accounts still held: no Smithsonian key, no email provider, no moderation API account, no paid services were created. Everything that needs one is listed under "What's blocked".
- **Name: Mailart** (PRD open question 1). It's the tradition the product borrows from, it's plain, and the repo name matches.
- **Hosting: Vercel for the web app, the worker runs anywhere with Chromium.** Vercel functions can't hold a polling Playwright worker. The worker only needs `DATABASE_URL` and `RENDER_BASE_URL`, so a laptop, a $5 VM or the Dockerfile in `workers/render` all work. Choosing that host is Brandon's call (spec rule 5).
- **The Met's v1 search was retired on 2026-10-01.** The fetcher uses `/v1.1/search` (paged, max 500). Some IDs it returns 404 on `/objects`; those are skipped. AIC's IIIF server answers 403 without an `AIC-User-Agent` header.
- **Library images are committed as 900 px WebP** (25 MB) rather than git-lfs. Masters (PNG/JPEG, ≤1600 px) stay out of git; `scripts/assets` regenerates them, and `assets/library/ids.json` pins every asset id to its source so ids never move.
- **Group plates and silhouettes are flagged.** A stamp can only replace one head, so stamp-heads skips fashion plates with several people. Black silhouettes print as ink blobs at stamp size, so they never become stamps.
- **Insect plates are split.** Hollar's and similar sheets of many insects are cut into one asset per insect (connected components of the rembg mask), which is where most of the 35 insects come from.
- **`letters.ip_hash` is a sixth column the spec didn't list.** The 20-per-IP limit needs something to count. It is an HMAC of the address, never the address. `HASH_SECRET` (new env var) keys it, the recipient-email hashes and the block tokens; never rotate it once live.
- **Moderation provider: Claude (`claude-opus-5-5`, `effort: "low"`, structured output) when `MODERATION_API_KEY` is set**, plus a local word list that always runs. It fails closed: if the API is down the letter isn't saved. A `refusal` stop reason from the classifier is treated as a reject, not retried on a fallback model, because a declined moderation request means the text tripped safety classifiers.
- **Blocked recipients are dropped silently.** The sender sees "on its way" either way, so blocking can't be probed. The letter is marked `failed`.
- **Sender confirmation email** after delivery, with a link to the letter (PRD sender flow step 7; the tech spec didn't list it).
- **Postmark date = the day the draft was created**, so previews and the stored envelope agree even if verification happens the next day.
- **Opt-out is POST-only.** `/block` shows a button; `/api/block` takes RFC 8058 one-click POSTs (`List-Unsubscribe-Post`). A GET never blocks, because mail scanners fetch links.
- **`/dev/gallery` is available in production when `ENABLE_DEV_GALLERY=1`.** The spec calls it dev-only, but it is how quality gets judged, and it holds no data.
- **Local dev used Homebrew services, not Docker** (Docker wasn't installed). `docker-compose.yml` and the worker Dockerfile are written but were not run here.

## Spec findings (the spec asked to be told, not worked around)

1. **The settle tilt and the 1 MB budget don't fit together.** Measured on the same envelopes:

   | | 1200 px, lossy 20 | First rung under 1 MB |
   | --- | --- | --- |
   | business, with tilt | 3045 KB | 600 px (794 KB) |
   | business, no tilt | 1435 KB | 900 px (817 KB) |
   | square, with tilt | 4057 KB | 600 px (920 KB) |
   | square, no tilt | 1326 KB | 900 px (762 KB) |

   One square envelope with the tilt stayed over 1 MB even at 600 px, lossy 120 (1139 KB), so the ladder alone could not meet the acceptance criterion. The 1.4° tilt moves every envelope pixel for six frames, and photographic collage on grained paper costs ~265 KB per full GIF frame even undithered. **Shipped:** the GIF keeps the 0.6–1.0 s beat as a soft shadow shift without the tilt; the live letter page keeps the tilt. Result: 20/20 under 1 MB, mostly at 900–1200 px. `GET /render/:id?tilt=1` restores it for comparison. **Proposed change:** accept this, or accept 600 px GIFs with the tilt (which still fails on some square envelopes).
2. **The PRD wants the GIF "rendered at 2x" (1200 px).** About a third of envelopes reach 1200 px; the rest land at 900 px. All display at 600 px in the email.
3. **Head box on group figures.** The spec's "centered on the mask in that band" lands between two people on fashion plates. The box now follows the column run that holds the topmost pixel (the tallest person's head).
4. **Render time:** 8–20 s per job on an M-series laptop (capture ~7 s; the rest is walking the size ladder). Under the 30 s target.

## What's blocked on Brandon

These need an account, a key, money or a terms-of-service acceptance, none of which were mine to do:

| Missing | Effect now | Finish it |
| --- | --- | --- |
| A database | Production runs demo mode: no letters saved or sent. Supabase's free tier allows 2 active projects per user and `heatcheck` + `attn` hold both. | Free a slot (or use any Postgres), then `vercel env add DATABASE_URL production` with the transaction-pooler URL (port 6543), `DATABASE_URL=... pnpm db:migrate`, push. |
| An email provider + sending domain | `emailConfigured()` refuses on Vercel without one. | Create a Resend or Postmark account, verify a subdomain (SPF, DKIM, DMARC), then set `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `SENDING_DOMAIN`. Ramp volume slowly. |
| Somewhere to run the worker | Queued letters wait. | Any host with Docker: `docker build -f workers/render/Dockerfile .`, env `DATABASE_URL`, `RENDER_BASE_URL=https://<site>`, `WORKER_SECRET` (same as Vercel), `SITE_URL`, storage vars. |
| S3-compatible storage | The worker writes to local disk, which only a co-located web app can serve. | Create a bucket (R2, S3, or Supabase Storage), set `S3_*` and `PUBLIC_FILES_BASE_URL` on the worker. |
| `MODERATION_API_KEY` | Only the local word list runs. | An Anthropic API key. |
| `SMITHSONIAN_API_KEY` | Smithsonian fetcher is written but skipped. | Free api.data.gov key; the library already meets every target without it. |

The real-inbox test (spec Phase 3: Gmail, Apple Mail, Outlook) needs a real send, so it waits on the email provider. The `/l/:slug` sample letters and `apps/web/public/samples/*.gif` are real worker output and can be checked meanwhile.

## PRD open questions, answered

1. **Name:** Mailart.
2. **Auto-play in the email, or a closed envelope with "open in full" as the main moment?** Auto-play, once: the GIF opens on its own and stops on the letter, because the letter should be readable without a click. The closed-envelope reveal lives on `/l/:slug`: the PNG shows closed with "Tap to open", and the tap plays the opening with sound.
3. **Pick from 3, or a surprise envelope?** Pick from 3 with shuffle, as the tech spec says. Choosing is part of the gift, and a surprise means the sender can't vouch for what their friend receives.
4. **Does the sender add their own touch?** Not in v1, beyond the optional line under the name (drawn on the envelope) and the city on the postmark. A stamp pick is the natural v2 addition, since the compositor already takes a forced recipe.
5. **Free or paid stamp packs?** Free in v1. Nothing in v1 costs per letter except rendering, and payments would add accounts the PRD doesn't want.
6. **Which AI image model?** None in v1 (spec ground rule 1). Deferred to the Illustrated-cover phase.
7. **Public wall or private?** Private. Letter pages use 22-character random slugs and `noindex`, and the recipient's email never appears on them. A wall needs explicit sender and recipient consent, which v1 has no UI for.

## What I'd change next

- Grow stamp-heads' figure pool: 37 front-facing solo figures with head boxes is enough to avoid repeats within an envelope, not enough to avoid familiarity across many.
- The gallery recipe has only 8 back-view figures, so they recur. A targeted Met search for "rear view" fashion plates would help most.
- Encode once per width instead of re-running gifsicle per lossy rung (saves ~5 s per job).
- The CSS-animation upgrade for Apple Mail (PRD v2) could reuse `Stage` almost as-is.

## Credits

Images: `assets/library/CREDITS.md` (The Metropolitan Museum of Art and the Art Institute of Chicago, CC0/public domain). Fonts: SIL OFL 1.1 and Apache 2.0, licences beside each file in `apps/web/public/fonts/`. The paper sound is synthesized with Web Audio.
