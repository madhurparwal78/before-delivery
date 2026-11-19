import pg from 'pg';

/**
 * The query interface shared by the pool and transactions.
 * A tagged-template function; the row type is given at the call site.
 */
export interface Queryable {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  begin<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  unsafe<T = Record<string, unknown>>(text: string): Promise<T[]>;
}

interface JsonMarker {
  readonly __json: unknown;
}

/** Mark a value to be stored as jsonb. */
export function json(value: unknown): JsonMarker {
  return { __json: value };
}

interface Pool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Build the query text and parameter list from a tagged template. */
function buildQuery(strings: TemplateStringsArray, values: unknown[]): { text: string; params: unknown[] } {
  let text = '';
  const params: unknown[] = [];
  for (let i = 0; i < strings.length; i++) {
    text += strings[i];
    if (i < values.length) {
      const value = values[i];
      if (value !== null && typeof value === 'object' && '__json' in (value as object)) {
        params.push(JSON.stringify((value as JsonMarker).__json));
        text += `$${params.length}::jsonb`;
      } else {
        params.push(value);
        text += `$${params.length}`;
      }
    }
  }
  return { text, params };
}

function tagFor(pool: Pool): Queryable {
  const tag = (<T>(strings: TemplateStringsArray, ...values: unknown[]) => {
    const { text, params } = buildQuery(strings, values);
    return pool.query(text, params).then((r) => r.rows as T[]);
  }) as Queryable;
  tag.unsafe = <T>(text: string) => pool.query(text).then((r) => r.rows as T[]);
  tag.begin = async <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> => {
    const client = await (pool as unknown as { connect(): Promise<Pool & { release(): void }> }).connect();
    const clientTag = (<T2>(strings: TemplateStringsArray, ...values: unknown[]) => {
      const { text, params } = buildQuery(strings, values);
      return client.query(text, params).then((r) => r.rows as T2[]);
    }) as Queryable;
    clientTag.unsafe = <T2>(text: string) => client.query(text).then((r) => r.rows as T2[]);
    clientTag.begin = <T2>(fn2: (tx: Queryable) => Promise<T2>) => fn2(clientTag);
    try {
      await client.query('BEGIN');
      const result = await fn(clientTag);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      (client as unknown as { release(): void }).release();
    }
  };
  return tag;
}

export type Sql = Queryable;

let pool: pg.Pool | null = null;

export function createSql(databaseUrl: string): Sql {
  if (pool === null) {
    pool = new pg.Pool({ connectionString: databaseUrl, max: 20, idleTimeoutMillis: 30_000 });
  }
  return tagFor(pool as unknown as Pool);
}

export async function ensureSchema(sql: Sql, schemaSql: string): Promise<void> {
  await sql.unsafe(schemaSql);
}
