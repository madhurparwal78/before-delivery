import type { Db } from "./db.js";
import { SCHEMA } from "./schema.js";

/** Applies the schema idempotently every time the app serves. */
export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
