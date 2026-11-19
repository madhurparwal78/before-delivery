// The monthly quota: the UTC calendar month by the server's clock, and how much of it is used.
import type { Quota } from "../shared/types";
import { rows, type Db } from "./db";

export function period(now = new Date()): { start: Date; resets: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    resets: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

/**
 * used_seconds per project: billable seconds of sessions that ended within the period, plus, for
 * every open session, received audio ms × channels / 1000 rounded down.
 */
export async function usedSeconds(projectIds: readonly string[], db?: Db): Promise<Map<string, number>> {
  const { start, resets } = period();
  const found = await rows<{ project_id: string; used: number }>(
    `SELECT project_id,
            COALESCE(SUM(CASE WHEN ended_at IS NULL THEN (audio_ms * channels) / 1000 ELSE billable_seconds END), 0)::bigint AS used
       FROM sessions
      WHERE project_id = ANY($1::uuid[]) AND (ended_at IS NULL OR (ended_at >= $2 AND ended_at < $3))
      GROUP BY project_id`,
    [projectIds, start, resets],
    db,
  );
  return new Map(found.map((row) => [row.project_id, row.used]));
}

export function quotaObject(limitMinutes: number, used: number): Quota {
  const now = new Date();
  const { start, resets } = period(now);
  return {
    limit_minutes: limitMinutes,
    used_seconds: used,
    period_start: start.toISOString(),
    resets_at: resets.toISOString(),
    exhausted: used >= limitMinutes * 60,
    server_time: now.toISOString(),
  };
}

export async function projectQuota(projectId: string, limitMinutes: number, db?: Db): Promise<Quota> {
  return quotaObject(limitMinutes, (await usedSeconds([projectId], db)).get(projectId) ?? 0);
}
