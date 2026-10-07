import { existsSync } from "node:fs";
import path from "node:path";

/** Scripts (worker, migrations) read the repo-root .env; Next reads its own. Never overrides real env. */
export function loadRootEnv() {
  const file = path.resolve(import.meta.dirname, "../../../.env");
  if (existsSync(file)) process.loadEnvFile(file);
}
