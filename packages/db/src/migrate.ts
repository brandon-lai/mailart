import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  await migrate(drizzle(sql), { migrationsFolder: path.join(import.meta.dirname, "../migrations") });
  console.log("migrations applied");
  await sql.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
