import type { Db } from './db.js';
import { SCHEMA_SQL } from './schema.js';

export async function applySchema(db: Db): Promise<void> {
  await db.pool.query(SCHEMA_SQL);
}
