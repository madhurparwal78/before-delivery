import { Pool } from "pg";

let current: Pool | null = null;

export function createDbPool(connectionString: string): { raw(): Pool; end(): Promise<void> } {
  if (current !== null) {
    void current.end().catch(() => undefined);
  }
  current = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
  });
  return {
    raw: () => {
      if (current === null) throw new Error("pool_closed");
      return current;
    },
    end: () => {
      const pool = current;
      current = null;
      return pool === null ? Promise.resolve() : pool.end();
    },
  };
}
