import pg from 'pg';
import type { ContentRecord, Interview, Product, Scenario } from '../domain/content.js';
import { scenarioOrder, startingContent } from '../domain/seed.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function openPool(connectionString: string): pg.Pool {
  pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 0,
  });
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database pool is not open');
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS content_record (
  id integer PRIMARY KEY CHECK (id = 1),
  edition integer NOT NULL,
  product jsonb NOT NULL,
  interviews jsonb NOT NULL,
  scenarios jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function prepareDatabase(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query(CREATE_SQL);
    const existing = await client.query<{ edition: number }>('SELECT edition FROM content_record WHERE id = 1');
    if (existing.rowCount === 0) {
      const start = startingContent(1);
      await client.query(
        'INSERT INTO content_record (id, edition, product, interviews, scenarios) VALUES (1, $1, $2, $3, $4)',
        [start.edition, JSON.stringify(start.product), JSON.stringify(start.interviews), JSON.stringify(start.scenarios)],
      );
    }
  } finally {
    client.release();
  }
}

interface Row {
  edition: number;
  product: Product;
  interviews: Interview[];
  scenarios: Scenario[];
}

export async function readContent(): Promise<ContentRecord | null> {
  const result = await getPool()
    .query<Row>('SELECT edition, product, interviews, scenarios FROM content_record WHERE id = 1')
    .then((r) => r.rows[0] ?? null)
    .catch(() => null);
  if (!result) return null;
  return {
    edition: Number(result.edition),
    product: result.product,
    interviews: result.interviews,
    scenarios: scenarioOrder(result.scenarios),
  };
}

export async function writeContent(next: ContentRecord): Promise<void> {
  await getPool().query(
    'UPDATE content_record SET edition = $1, product = $2, interviews = $3, scenarios = $4, updated_at = now() WHERE id = 1',
    [next.edition, JSON.stringify(next.product), JSON.stringify(next.interviews), JSON.stringify(next.scenarios)],
  );
}

export async function currentEdition(): Promise<number | null> {
  const row = await getPool()
    .query<{ edition: number }>('SELECT edition FROM content_record WHERE id = 1')
    .then((r) => r.rows[0] ?? null)
    .catch(() => null);
  return row ? Number(row.edition) : null;
}
