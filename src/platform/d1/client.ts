import { drizzle } from "drizzle-orm/d1";

import * as schema from "../../../database/schema";

export function createDatabase(database: D1Database) {
  return drizzle(database, { schema });
}

export type Database = ReturnType<typeof createDatabase>;
