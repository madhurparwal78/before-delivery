import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaSql = readFileSync(resolve('src/server/schema.sql'), 'utf8');

export function applySchema(db: import('pg').Pool): Promise<void> {
  return db.query(schemaSql).then(() => undefined);
}
