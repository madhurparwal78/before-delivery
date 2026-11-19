import pg from "pg";

export type PgPool = pg.Pool;
export type PgClient = pg.PoolClient;

const poolCache = new Map<string, PgPool>();

export function poolFor(url: string): PgPool {
  let p = poolCache.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url, max: 8 });
    poolCache.set(url, p);
  }
  return p;
}
