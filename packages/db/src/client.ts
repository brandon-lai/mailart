import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/** One flag, checked at every entry point: with no DATABASE_URL the app runs in demo mode. */
export const hasDatabase = () => !!process.env.DATABASE_URL;

type Handle = { sql: postgres.Sql; db: PostgresJsDatabase<typeof schema> };
const g = globalThis as unknown as { __mailartDb?: Handle };

/**
 * Connect lazily: a module-level postgres() would throw at import time when the
 * URL is absent and take demo mode down with it. Cached on globalThis so dev
 * reloads do not exhaust the pool.
 */
export function getDb(): Handle {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!g.__mailartDb) {
    // prepare:false: transaction poolers (Supabase :6543) cannot hold prepared statements.
    const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: Number(process.env.DB_POOL_MAX ?? 5) });
    g.__mailartDb = { sql, db: drizzle(sql, { schema }) };
  }
  return g.__mailartDb;
}
