import { query, queryOne } from '../db/pool.js';
import type { StageName } from '../db/uploads.js';
import { PermanentStageError, maxAttempts, retryDelaysSeconds, runStage } from './stages.js';
import { drainOutbox } from '../services/outbox.js';
import { retryPendingSearchWork } from './search-retry.js';

interface DueStageRow {
  stage_id: number;
  upload_id: number;
  revision_id: number;
  name: StageName;
  attempts: number;
}

/**
 * The next stage that may run: the first unconfirmed stage of an upload still in
 * progress, once its retry time has come.
 */
async function claimDueStage(): Promise<DueStageRow | null> {
  return queryOne<DueStageRow>(
    `UPDATE upload_stages SET status = 'running', updated_at = now()
     WHERE id = (
       SELECT s.id FROM upload_stages s
       JOIN uploads u ON u.id = s.upload_id
       WHERE u.status = 'in_progress'
         AND s.status = 'pending'
         AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
         AND s.position = (
           SELECT min(p.position) FROM upload_stages p
           WHERE p.upload_id = s.upload_id AND p.status <> 'confirmed'
         )
       ORDER BY s.updated_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id AS stage_id, upload_id, name, attempts,
       (SELECT revision_id FROM uploads WHERE id = upload_stages.upload_id) AS revision_id`,
  );
}

async function confirmStage(stageId: number, uploadId: number): Promise<void> {
  await query(
    `UPDATE upload_stages SET status = 'confirmed', attempts = attempts + 1,
       next_attempt_at = NULL, failure = NULL, updated_at = now()
     WHERE id = $1`,
    [stageId],
  );
  const remaining = await queryOne<{ n: string }>(
    `SELECT count(*)::text AS n FROM upload_stages WHERE upload_id = $1 AND status <> 'confirmed'`,
    [uploadId],
  );
  if (Number(remaining?.n ?? '0') === 0) {
    await query(`UPDATE uploads SET status = 'completed' WHERE id = $1`, [uploadId]);
  }
}

async function failStage(
  stage: DueStageRow,
  permanent: boolean,
  message: string,
): Promise<void> {
  const attempts = stage.attempts + 1;
  const delays = retryDelaysSeconds();
  const delay = permanent ? undefined : delays[attempts - 1];

  if (delay === undefined || attempts >= maxAttempts()) {
    await query(
      `UPDATE upload_stages SET status = 'failed', attempts = $2, next_attempt_at = NULL,
         failure = $3, updated_at = now() WHERE id = $1`,
      [stage.stage_id, attempts, message],
    );
    await query(`UPDATE uploads SET status = 'failed' WHERE id = $1`, [stage.upload_id]);
    return;
  }
  await query(
    `UPDATE upload_stages SET status = 'pending', attempts = $2,
       next_attempt_at = now() + make_interval(secs => $3), failure = $4, updated_at = now()
     WHERE id = $1`,
    [stage.stage_id, attempts, delay, message],
  );
}

async function tick(): Promise<boolean> {
  const stage = await claimDueStage();
  if (stage === null) return false;
  try {
    await runStage(stage.name, stage.revision_id);
    await confirmStage(stage.stage_id, stage.upload_id);
  } catch (error) {
    const permanent = error instanceof PermanentStageError;
    await failStage(stage, permanent, error instanceof Error ? error.message : String(error));
  }
  return true;
}

const IDLE_MS = 300;

let running = false;

/** Queue work continues across provider outages without a restart. */
export function startQueueWorker(): void {
  if (running) return;
  running = true;
  const loop = async (): Promise<void> => {
    for (;;) {
      let worked = false;
      try {
        worked = await tick();
      } catch {
        // A database blip leaves the stage where it is; the next tick retries.
      }
      if (!worked) {
        await drainOutbox().catch(() => undefined);
        await retryPendingSearchWork().catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
      }
    }
  };
  void loop();
}

/** Restarts a failed upload from its failed stage with attempts reset. */
export async function requeueUpload(uploadId: number): Promise<void> {
  await query(
    `UPDATE upload_stages SET status = 'pending', attempts = 0, next_attempt_at = NULL,
       failure = NULL, updated_at = now()
     WHERE upload_id = $1 AND status <> 'confirmed'`,
    [uploadId],
  );
  await query(`UPDATE uploads SET status = 'in_progress' WHERE id = $1`, [uploadId]);
}
