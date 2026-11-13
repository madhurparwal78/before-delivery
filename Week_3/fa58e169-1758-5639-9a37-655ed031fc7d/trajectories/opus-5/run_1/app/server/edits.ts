import { limits } from './config';
import { copy } from './copy';
import { one, query } from './db';
import { ApiError } from './http';

const windows = new Map<string, number[]>();

/** Edit routes are limited per person on the wall clock. */
export function checkEditRate(userId: string): void {
  const now = Date.now();
  const recent = (windows.get(userId) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= limits.editsPerMinute) {
    throw new ApiError(429, { error: 'rate_limited', message: copy.rateLimited });
  }
  recent.push(now);
  windows.set(userId, recent);
}

export async function replayedOp(patternId: string, opId: string): Promise<unknown | null> {
  const row = await one<{ response: unknown }>(
    'select response from ops where pattern_id = $1 and op_id = $2',
    [patternId, opId],
  );
  return row ? row.response : null;
}

export async function rememberOp(patternId: string, opId: string, response: unknown): Promise<void> {
  await query(
    `insert into ops (pattern_id, op_id, response) values ($1, $2, $3)
     on conflict (pattern_id, op_id) do nothing`,
    [patternId, opId, JSON.stringify(response)],
  );
}
