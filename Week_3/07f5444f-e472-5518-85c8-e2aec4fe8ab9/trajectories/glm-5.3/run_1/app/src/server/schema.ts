// The schema, applied idempotently on every start.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function schemaSql(): string {
  return readFileSync(path.join(__dirname, "schema.sql"), "utf8");
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(schemaSql());
}
