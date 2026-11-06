/** The runtime pool, shared by background loops and event publishing. */

import type { Pool } from "./db/pool.js";

let pool: Pool | null = null;

export function setRuntimePool(p: Pool): void {
  pool = p;
}

export function runtimePool(): Pool {
  if (pool === null) throw new Error("Runtime pool not set");
  return pool;
}
