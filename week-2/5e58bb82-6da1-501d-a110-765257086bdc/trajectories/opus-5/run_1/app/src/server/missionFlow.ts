import type { MissionStatus } from '../shared/types.js';
import type { Db } from './db.js';
import { lineFinished } from './domain/transitions.js';
import { recordEvent, SYSTEM_ACTOR } from './events.js';
import { findMission, listLines } from './repo.js';

/** Records a mission status move with its event. */
export async function setMissionStatus(
  db: Db,
  missionId: string,
  from: MissionStatus,
  to: MissionStatus,
  actor: string,
  now: Date,
  extra: { launched?: boolean; completed?: boolean } = {},
): Promise<boolean> {
  const updated = await db.query(
    `UPDATE missions SET status = $3, version = version + 1,
       launched_at = CASE WHEN $4 THEN $5 ELSE launched_at END,
       completed_at = CASE WHEN $6 THEN $5 ELSE completed_at END
     WHERE id = $1 AND status = $2`,
    [missionId, from, to, extra.launched === true, now.toISOString(), extra.completed === true],
  );
  if (updated.rowCount === 0) return false;
  await recordEvent(db, missionId, 'status', actor, `Status ${from} → ${to}`, now);
  return true;
}

/** Launched → Surveying happens on its own when the first line starts. */
export async function maybeSurveying(db: Db, missionId: string, now: Date): Promise<void> {
  const mission = await findMission(db, missionId);
  if (!mission || mission.status !== 'Launched') return;
  await setMissionStatus(db, missionId, 'Launched', 'Surveying', SYSTEM_ACTOR, now);
}

/**
 * Surveying → Recovering happens on its own as soon as every line of every kind
 * is Surveyed, Delivered or Superseded.
 */
export async function maybeRecovering(db: Db, missionId: string, now: Date): Promise<void> {
  const mission = await findMission(db, missionId);
  if (!mission || mission.status !== 'Surveying') return;
  const lines = await listLines(db, missionId);
  if (lines.length === 0) return;
  if (!lines.every((line) => lineFinished(line.status))) return;
  await setMissionStatus(db, missionId, 'Surveying', 'Recovering', SYSTEM_ACTOR, now);
}
