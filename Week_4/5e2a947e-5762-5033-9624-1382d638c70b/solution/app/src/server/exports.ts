import type pg from 'pg';
import { ApiError } from '../shared/errors.ts';
import type { ExportFormat, ExportInfo, ExportState, Role } from '../shared/model.ts';
import { serializeOutline } from '../shared/outline.ts';
import { EXPORT_TRANSITIONS, LIMITS, canTransition } from '../shared/rules.ts';
import { serverNow, toIso } from './clock.ts';
import { config } from './config.ts';
import { database, query, withMapLock } from './db.ts';
import { Effects, emitEvent } from './groups.ts';
import { randomId } from './ids.ts';
import { loadMap, visibleDoc, type MapRow } from './mapStore.ts';
import { StorageError } from './s3.ts';
import { OUTLINE_TYPE, putConfirmed } from './storage.ts';
import { renderSvg } from './svgExport.ts';
import { onTick } from './tick.ts';

export const FORMATS: Record<ExportFormat, { extension: string; contentType: string }> = {
  sprig: { extension: 'sprig.txt', contentType: OUTLINE_TYPE },
  svg: { extension: 'svg', contentType: 'image/svg+xml' },
};

export const isFormat = (value: unknown): value is ExportFormat => typeof value === 'string' && Object.hasOwn(FORMATS, value);

export interface ExportRow {
  id: string;
  map_id: string;
  user_id: string;
  format: ExportFormat;
  topic_id: string | null;
  state: ExportState;
  progress: number;
  step_at: Date;
  created_at: Date;
}

export const exportKey = (job: Pick<ExportRow, 'map_id' | 'id' | 'format'>): string =>
  `exports/${job.map_id}/${job.id}.${FORMATS[job.format].extension}`;

export const infoOf = (job: ExportRow): ExportInfo => ({
  id: job.id,
  state: job.state,
  progress: job.progress,
  format: job.format,
  download_url: job.state === 'ready' ? `/api/exports/${job.id}/download` : null,
});

/**
 * Jobs this process is driving. A job is driven by the process that accepted it, so an instance whose storage is
 * down never has its jobs finished by another instance on the same database whose storage is up.
 */
const driving = new Set<string>();

export async function createExport(mapId: string, userId: string, format: ExportFormat, topicId: string | null): Promise<ExportInfo> {
  const now = serverNow();
  const rows = await query<ExportRow>(
    database(),
    `INSERT INTO exports (id, map_id, user_id, format, topic_id, state, progress, step_at, created_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, $7) RETURNING *`,
    [randomId(), mapId, userId, format, topicId, toIso(now + config.exportStepMs), toIso(now)],
  );
  const job = rows[0] as ExportRow;
  driving.add(job.id);
  return infoOf(job);
}

const selectJob = async (id: string): Promise<ExportRow | null> =>
  (await query<ExportRow>(database(), 'SELECT * FROM exports WHERE id = $1', [id]))[0] ?? null;

/** The job as it stands now: a step that has come due on the server clock is taken first, so polling never waits for the tick. */
export async function findExport(id: string): Promise<ExportRow | null> {
  const job = await selectJob(id);
  if (!job) return null;
  if (driving.has(id) && job.step_at.getTime() <= serverNow()) {
    await stepDue(job);
    return selectJob(id);
  }
  return job;
}

/** What the job's person may see of the map: their role now, or the least a viewer sees when they have none. */
async function roleOfPerson(client: pg.PoolClient, map: MapRow, userId: string): Promise<Role> {
  if (map.owner_id === userId) return 'owner';
  const rows = await query<{ role: Role }>(
    client,
    `SELECT role FROM members WHERE map_id = $1 AND user_id = $2
     UNION ALL SELECT role FROM guest_sessions WHERE map_id = $1 AND 'guest:' || id = $2`,
    [map.id, userId],
  );
  return rows[0]?.role ?? 'viewer';
}

/** Build the export as its person may see it, write it to storage and confirm it is there. */
async function writeExport(client: pg.PoolClient, job: ExportRow): Promise<void> {
  const map = (await loadMap(client, job.map_id)) as MapRow;
  const doc = visibleDoc(map.doc, await roleOfPerson(client, map, job.user_id));
  const text = job.format === 'svg' ? renderSvg(doc, map.title, job.topic_id) : serializeOutline(doc.topics, job.topic_id);
  await putConfirmed(exportKey(job), new TextEncoder().encode(text), FORMATS[job.format].contentType);
}

/** Take one step of a job that is due. Returns false when nothing was due. */
async function stepOnce(job: ExportRow): Promise<boolean> {
  const fx = new Effects();
  const stepped = await withMapLock(job.map_id, async (client) => {
    const due = await query<ExportRow>(
      client,
      "SELECT * FROM exports WHERE id = $1 AND state IN ('queued', 'running') AND step_at <= $2",
      [job.id, toIso(serverNow())],
    );
    const current = due[0];
    if (!current) return false;
    const steps: readonly number[] = LIMITS.export_steps;
    const target = steps[steps.indexOf(current.progress) + 1] ?? current.progress;
    const writes = target === steps[steps.length - 1];
    if (!canTransition(EXPORT_TRANSITIONS, current.state, writes ? 'ready' : 'running')) return false;
    let next: Pick<ExportRow, 'state' | 'progress'> = { state: writes ? 'ready' : 'running', progress: target };
    if (writes) {
      try {
        await writeExport(client, current);
      } catch (error) {
        if (!(error instanceof StorageError)) throw error;
        next = { state: 'failed', progress: current.progress };
      }
    }
    const stepAt = toIso(current.step_at.getTime() + config.exportStepMs);
    await client.query('UPDATE exports SET state = $2, progress = $3, step_at = $4 WHERE id = $1', [current.id, next.state, next.progress, stepAt]);
    if (next.state !== 'running') driving.delete(current.id);
    await emitEvent(client, current.map_id, { type: 'export', export: infoOf({ ...current, ...next }) }, 'user', current.user_id, fx);
    return true;
  });
  fx.run();
  return stepped;
}

/** Take every step of the job that the server clock has made due. */
async function stepDue(job: ExportRow): Promise<void> {
  while (await stepOnce(job)) continue;
}

/** Retry is the one way out of failed: back to running at the progress it kept, so the next step writes again. */
export async function retryExport(job: ExportRow): Promise<ExportInfo> {
  const fx = new Effects();
  const info = await withMapLock(job.map_id, async (client) => {
    const rows = await query<ExportRow>(
      client,
      "UPDATE exports SET state = 'running', step_at = $2 WHERE id = $1 AND state = 'failed' RETURNING *",
      [job.id, toIso(serverNow() + config.exportStepMs)],
    );
    const retried = rows[0];
    if (!retried) throw new ApiError('invalid_transition', 'Only a failed export can be retried.');
    driving.add(retried.id);
    await emitEvent(client, retried.map_id, { type: 'export', export: infoOf(retried) }, 'user', retried.user_id, fx);
    return infoOf(retried);
  });
  fx.run();
  return info;
}

onTick(async () => {
  if (driving.size === 0) return;
  const due = await query<ExportRow>(
    database(),
    "SELECT * FROM exports WHERE id = ANY($1) AND state IN ('queued', 'running') AND step_at <= $2",
    [[...driving], toIso(serverNow())],
  );
  for (const job of due) await stepDue(job);
});
