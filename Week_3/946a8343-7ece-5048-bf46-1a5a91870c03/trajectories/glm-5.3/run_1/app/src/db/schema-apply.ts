import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Db } from './db.js';

export function schemaSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, 'schema.sql'), 'utf8');
}

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'" && sql[i - 1] !== '\\') inString = !inString;
    if (c === ';' && !inString) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export async function applySchema(db: Db): Promise<void> {
  const sql = schemaSql();
  const client = await db.pool.connect();
  try {
    for (const statement of splitStatements(sql)) {
      await client.query(statement);
    }
    db.markReady();
  } finally {
    client.release();
  }
}
