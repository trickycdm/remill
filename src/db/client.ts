/**
 * Drizzle client factory. This module and everything under `src/db/queries/` are
 * the ONLY places that import Drizzle (steering/DATABASE_STANDARDS.md). Services
 * receive the `Database` handle and call query functions; they never construct it
 * or touch the raw `D1Database` binding.
 */

import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type Database = DrizzleD1Database<typeof schema>;

/** Wrap the raw D1 binding (`c.env.DB`) in a typed Drizzle client. */
export function getDb(d1: D1Database): Database {
  return drizzle(d1, { schema });
}

export { schema };
