import { db } from './db.js';

/** The only reader of the machine clock. Every rule works on workspace time: machine time plus a stored offset. */
export function machineMs(): number {
  return Date.now();
}

async function offsetOf(workspaceId: string): Promise<number> {
  const { rows } = await db.query<{ offset: number }>('SELECT clock_offset_ms AS "offset" FROM workspaces WHERE id = $1', [workspaceId]);
  return rows[0]?.offset ?? 0;
}

export async function workspaceNow(workspaceId: string): Promise<number> {
  return machineMs() + (await offsetOf(workspaceId));
}

export async function advanceClock(workspaceId: string, seconds: number): Promise<void> {
  await db.query('UPDATE workspaces SET clock_offset_ms = clock_offset_ms + $2 WHERE id = $1', [workspaceId, seconds * 1000]);
}

export async function setClock(workspaceId: string, instantMs: number): Promise<void> {
  await db.query('UPDATE workspaces SET clock_offset_ms = $2 WHERE id = $1', [workspaceId, instantMs - machineMs()]);
}

export async function clockOffsetSeconds(workspaceId: string): Promise<number> {
  return Math.round((await offsetOf(workspaceId)) / 1000);
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}
