// The one place that reads the machine clock and applies a workspace's offset.
// Every time rule (waits, retries, schedules, holds, idempotency, timestamps)
// goes through workspaceNow / wsDate; nothing else reads Date.now().

import type { Db } from "./db.js";
import { CONFIG } from "./config.js";

const cache = new Map<string, { offset: number; loaded: number }>();
const TTL = 200;

export function realNow(): Date {
  return new Date();
}

export function realNowMs(): number {
  return Date.now();
}

export async function wsOffset(db: Db, wsId: string): Promise<number> {
  const hit = cache.get(wsId);
  if (hit && realNowMs() - hit.loaded < TTL) return hit.offset;
  const r = await db.query("SELECT clock_offset_seconds AS o FROM workspaces WHERE id=$1", [wsId]);
  const offset = Number(r.rows[0]?.o ?? 0);
  cache.set(wsId, { offset, loaded: realNowMs() });
  return offset;
}

export function invalidateWs(wsId: string): void {
  cache.delete(wsId);
}

export async function workspaceNow(db: Db, wsId: string): Promise<Date> {
  const offset = await wsOffset(db, wsId);
  return new Date(realNowMs() + offset * 1000);
}

// Used inside a transaction that has already read the offset, or when the
// offset is known (engine loop).
export function wsDateFromOffset(offset: number): Date {
  return new Date(realNowMs() + offset * 1000);
}

export async function setWorkspaceClock(db: Db, wsId: string, iso: string): Promise<void> {
  await db.query("UPDATE workspaces SET clock_offset_seconds=$1 WHERE id=$2", [iso, wsId]);
  invalidateWs(wsId);
}

export function isoOf(d: Date): string {
  return d.toISOString();
}
