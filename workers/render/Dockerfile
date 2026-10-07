# Render worker: Node + Playwright Chromium + ffmpeg + gifsicle.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg gifsicle && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY workers ./workers
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/lib/samples.ts ./apps/web/lib/samples.ts
RUN pnpm install --frozen-lockfile --filter @mailart/render-worker...
CMD ["pnpm", "--filter", "@mailart/render-worker", "start"]
