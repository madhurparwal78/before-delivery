// Export jobs: queued, then running in steps of 20 percent every PLOT_EXPORT_STEP_MS of the server clock. The object is written after
// the fourth step; the job is `ready` only when storage confirms it, and `failed` at 80 when it does not.
import { randomUUID } from 'node:crypto';
import * as copy from '../shared/copy.ts';
import { ApiError, fieldError } from '../shared/errors.ts';
import { buildScene, modelSvg } from '../shared/geometry/index.ts';
import { serializeCanonical } from '../shared/model/index.ts';
import {
  BUSY_EXPORT_STATES, EXPORT_DONE, EXPORT_STEP_PERCENT, EXPORT_WRITE_AT, FIRST_EXPORT_STATE, isDownloadable, moveExport, retryExport,
} from '../shared/rules.ts';
import { EXPORT_FORMATS, type ExportFormat, type ExportJob, type ExportState } from '../shared/types.ts';
import { accessTo } from './access.ts';
import { requireUser } from './auth.ts';
import { objectBody } from './body.ts';
import { clock } from './clock.ts';
import { config } from './config.ts';
import { db, type Queryable } from './db.ts';
import { getDrawing } from './drawings.ts';
import { hub } from './live.ts';
import { registerStartStep } from './registry.ts';
import { roleOnDrawing } from './roles.ts';
import { route } from './router.ts';
import { s3 } from './s3.ts';
import { scheduler } from './scheduler.ts';

const CONTENT_TYPE: Record<ExportFormat, string> = { 'plot.txt': 'text/plain; charset=utf-8', svg: 'image/svg+xml' };

interface JobRow { id: string; drawing_id: string; format: ExportFormat; state: ExportState; progress: number; username: string; next_step_at: Date | null }

const COLUMNS = 'id, drawing_id, format, state, progress, username, next_step_at';
const objectKey = (job: Pick<JobRow, 'id' | 'drawing_id' | 'format'>): string => `exports/${job.drawing_id}/${job.id}.${job.format}`;

const jobOf = (row: JobRow): ExportJob => ({
  id: row.id, format: row.format, state: row.state, progress: row.progress,
  download_url: isDownloadable(row.state) ? `/api/exports/${row.id}/download` : null,
});

async function loadJob(jobId: string, q: Queryable = db): Promise<JobRow> {
  return (await q.query<JobRow>(`SELECT ${COLUMNS} FROM export_jobs WHERE id = $1`, [jobId]))[0];
}

type JobChange = { state: ExportState; progress: number; nextStepAt: number | null };

async function writeJob(q: Queryable, row: JobRow, change: JobChange): Promise<JobRow> {
  const nextStepAt = change.nextStepAt === null ? null : new Date(change.nextStepAt);
  await q.query('UPDATE export_jobs SET state = $2, progress = $3, next_step_at = $4 WHERE id = $1', [row.id, change.state, change.progress, nextStepAt]);
  return { ...row, state: change.state, progress: change.progress, next_step_at: nextStepAt };
}

function announceJob(row: JobRow): void {
  hub.broadcast(row.drawing_id, { type: 'export', data: { job: jobOf(row), username: row.username } });
}

async function saveJob(row: JobRow, change: JobChange): Promise<JobRow> {
  const saved = await writeJob(db, row, change);
  announceJob(saved);
  return saved;
}

async function contentOf(job: JobRow): Promise<Buffer> {
  const { state } = await getDrawing(job.drawing_id);
  return Buffer.from(job.format === 'svg' ? modelSvg(buildScene(state)) : serializeCanonical(state));
}

function scheduleStep(jobId: string, dueAt: number): void {
  scheduler.schedule(dueAt, () => runStep(jobId, dueAt));
}

/** One step of 20 percent; the fourth writes the object, and the job is `ready` or `failed` by what storage says. */
async function runStep(jobId: string, dueAt: number): Promise<void> {
  const job = await loadJob(jobId);
  const progress = job.progress + EXPORT_STEP_PERCENT;
  if (progress < EXPORT_WRITE_AT) {
    await saveJob(job, { state: job.state, progress, nextStepAt: dueAt + config.exportStepMs });
    scheduleStep(jobId, dueAt + config.exportStepMs);
    return;
  }
  const writing = await saveJob(job, { state: job.state, progress, nextStepAt: null });
  try {
    await s3.put(objectKey(job), await contentOf(job), CONTENT_TYPE[job.format]);
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'storage_unavailable')) console.error('export write failed', error);
    await saveJob(writing, { state: moveExport('running', 'failed'), progress, nextStepAt: null });
    return;
  }
  await saveJob(writing, { state: moveExport('running', 'ready'), progress: EXPORT_DONE, nextStepAt: null });
}

/** Queued jobs start running at once; the first step is due one step after they were asked for. */
async function startRunning(jobId: string, askedAt: number): Promise<void> {
  const job = await loadJob(jobId);
  await saveJob(job, { state: moveExport('queued', 'running'), progress: 0, nextStepAt: askedAt + config.exportStepMs });
  scheduleStep(jobId, askedAt + config.exportStepMs);
}

registerStartStep(async () => {
  for (const job of await db.query<JobRow>(`SELECT ${COLUMNS} FROM export_jobs WHERE state = ANY($1)`, [BUSY_EXPORT_STATES])) {
    if (job.state === FIRST_EXPORT_STATE) {
      const askedAt = clock.now();
      scheduler.schedule(askedAt, () => startRunning(job.id, askedAt));
    } else if (job.next_step_at) scheduleStep(job.id, job.next_step_at.getTime());
    else await saveJob(job, { state: moveExport('running', 'failed'), progress: job.progress, nextStepAt: null });
  }
});

route('POST', '/api/drawings/:id/exports', async (ctx) => {
  await roleOnDrawing(ctx, ctx.params.id);
  const format = EXPORT_FORMATS.find((candidate) => candidate === objectBody(ctx.json()).format);
  if (!format) throw fieldError('format', copy.EXPORT_FORMAT);
  const id = randomUUID();
  const askedAt = clock.now();
  await db.query('INSERT INTO export_jobs (id, drawing_id, format, state, progress, username) VALUES ($1, $2, $3, $4, 0, $5)', [id, ctx.params.id, format, FIRST_EXPORT_STATE, requireUser(ctx).username]);
  scheduler.schedule(askedAt, () => startRunning(id, askedAt));
  return ctx.reply(202, jobOf(await loadJob(id)));
});

route('GET', '/api/exports/:id', async (ctx) => {
  await accessTo(ctx, 'export', ctx.params.id);
  return ctx.reply(200, jobOf(await loadJob(ctx.params.id)));
});

route('POST', '/api/exports/:id/retry', async (ctx) => {
  await accessTo(ctx, 'export', ctx.params.id);
  const nextStepAt = clock.now() + config.exportStepMs;
  // the job is locked for the read-check-write: of two racing retries one restarts it, the other finds it running
  const restarted = await db.tx(async (q) => {
    await q.query('SELECT 1 FROM export_jobs WHERE id = $1 FOR UPDATE', [ctx.params.id]);
    const job = await loadJob(ctx.params.id, q);
    return writeJob(q, job, { state: retryExport(job.state), progress: 0, nextStepAt });
  });
  announceJob(restarted);
  scheduleStep(restarted.id, nextStepAt);
  return ctx.reply(202, jobOf(restarted));
});

route('GET', '/api/exports/:id/download', async (ctx) => {
  await accessTo(ctx, 'export', ctx.params.id);
  const job = await loadJob(ctx.params.id);
  if (!isDownloadable(job.state)) throw new ApiError('not_ready', copy.EXPORT_NOT_READY);
  return ctx.reply(200, await s3.get(objectKey(job)), {
    'content-type': CONTENT_TYPE[job.format], 'content-disposition': `attachment; filename="export.${job.format}"`,
  });
});
