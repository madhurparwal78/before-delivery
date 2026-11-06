import type { MissionEventKind } from '../shared/types.js';
import type { Db } from './db.js';
import { SYSTEM_ACTOR } from './domain/transitions.js';

/** Every mission event is recorded once, with the published summary. */
export async function recordEvent(
  db: Db,
  missionId: string,
  kind: MissionEventKind,
  actor: string,
  summary: string,
  at?: Date,
): Promise<void> {
  await db.query(
    `INSERT INTO mission_events (mission_id, at, kind, actor, summary)
     VALUES ($1, COALESCE($2, now()), $3, $4, $5)`,
    [missionId, at ?? null, kind, actor, summary],
  );
}

export { SYSTEM_ACTOR };
