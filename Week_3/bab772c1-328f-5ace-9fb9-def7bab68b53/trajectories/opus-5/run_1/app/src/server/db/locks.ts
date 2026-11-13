/** Session advisory locks, so work that calls out to a service still runs one at a time. */

import { createHash } from "node:crypto";
import { pool } from "./pool.js";

export const PLAN_LOCK = 1;
export const REFERENCE_LOCK = 2;
export const SEED_LOCK = 3;
export const QUOTA_LOCK = 4;

function missionKey(missionId: string): number {
  const digest = createHash("sha256").update(missionId).digest();
  return digest.readInt32BE(0);
}

export async function withAdvisoryLock<T>(
  classId: number,
  objectId: string | number,
  run: () => Promise<T>,
): Promise<T> {
  const key = typeof objectId === "number" ? objectId : missionKey(objectId);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1, $2)", [classId, key]);
    try {
      return await run();
    } finally {
      await client.query("select pg_advisory_unlock($1, $2)", [classId, key]);
    }
  } finally {
    client.release();
  }
}
