import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts", "apps/web/test/**/*.test.ts", "workers/*/test/**/*.test.ts"], testTimeout: 60_000 },
});
