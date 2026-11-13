import { ApiError, MESSAGES } from '../shared/errors.js';
import { exportMoveAllowed, exportRefusal, type ExportState } from '../shared/transitions.js';
import { toPlotText } from '../shared/plottext.js';
import { modelSvg } from '../shared/svgtext.js';
import { config } from './config.js';
import { now, onClockAdvance } from './clock.js';
import { one, query } from './db.js';
import { broadcast, loadDrawing } from './drawings.js';
import { newId } from './ids.js';
import { putObject, StorageUnavailable } from './storage.js';

export type ExportFormat = 'plot.txt' | 'svg';

export interface ExportRow {
  id: string;
  drawing_id: string;
  format: ExportFormat;
  state: ExportState;
  progress: number;
  key: string | null;
  username: string;
  next_step_at: string;
}

export function exportPayload(job: ExportRow): Record<string, unknown> {
  return {
    id: job.id,
    format: job.format,
    state: job.state,
    progress: job.progress,
    download_url: job.state === 'ready' ? `/api/exports/${job.id}/download` : null,
  };
}

export async function exportById(id: string): Promise<ExportRow | null> {
  return one<ExportRow>(
    'select id, drawing_id, format, state, progress, key, username, next_step_at from export_jobs where id = $1',
    [id],
  );
}

export async function startExport(drawingId: string, username: string, format: ExportFormat): Promise<ExportRow> {
  const id = newId('exp');
  await query(
    'insert into export_jobs (id, drawing_id, format, state, progress, username, next_step_at) values ($1,$2,$3,$4,$5,$6,$7)',
    [id, drawingId, format, 'queued', 0, username, now() + config.exportStepMs],
  );
  return (await exportById(id)) as ExportRow;
}

export async function retryExport(job: ExportRow): Promise<ExportRow> {
  if (!exportMoveAllowed(job.state, 'running')) {
    throw new ApiError('illegal_transition', exportRefusal(job.state, 'running'));
  }
  await query('update export_jobs set state = $2, progress = 0, key = null, next_step_at = $3 where id = $1', [
    job.id,
    'running',
    now() + config.exportStepMs,
  ]);
  const updated = (await exportById(job.id)) as ExportRow;
  await announce(updated);
  return updated;
}

async function announce(job: ExportRow): Promise<void> {
  const state = await loadDrawing(job.drawing_id);
  if (!state) return;
  await broadcast(state, 'export', exportPayload(job));
}

function exportKey(job: ExportRow): string {
  return `exports/${job.drawing_id}/${job.id}.${job.format === 'svg' ? 'svg' : 'plot.txt'}`;
}

async function exportBody(job: ExportRow): Promise<Buffer> {
  const state = await loadDrawing(job.drawing_id);
  if (!state) throw new ApiError('not_found', MESSAGES.notFound);
  if (job.format === 'svg') {
    return Buffer.from(modelSvg({ model: state.model }), 'utf8');
  }
  return Buffer.from(toPlotText(state.model), 'utf8');
}

async function step(job: ExportRow): Promise<void> {
  if (job.state === 'queued') {
    await query('update export_jobs set state = $2, progress = 0, next_step_at = $3 where id = $1', [
      job.id,
      'running',
      now() + config.exportStepMs,
    ]);
    await announce({ ...job, state: 'running', progress: 0 });
    return;
  }
  if (job.state !== 'running') return;
  const progress = job.progress + 20;
  if (progress < 100) {
    await query('update export_jobs set progress = $2, next_step_at = $3 where id = $1', [
      job.id,
      progress,
      now() + config.exportStepMs,
    ]);
    await announce({ ...job, progress });
    if (progress === 80) await writeObject({ ...job, progress });
    return;
  }
}

async function writeObject(job: ExportRow): Promise<void> {
  const key = exportKey(job);
  try {
    await putObject(key, await exportBody(job));
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      await query('update export_jobs set state = $2, progress = 80 where id = $1', [job.id, 'failed']);
      await announce({ ...job, state: 'failed', progress: 80 });
      return;
    }
    throw error;
  }
  await query('update export_jobs set state = $2, progress = 100, key = $3 where id = $1', [job.id, 'ready', key]);
  await announce({ ...job, state: 'ready', progress: 100, key });
}

async function tick(): Promise<void> {
  const due = await query<ExportRow>(
    "select id, drawing_id, format, state, progress, key, username, next_step_at from export_jobs where state in ('queued','running') and next_step_at <= $1",
    [now()],
  );
  for (const job of due) await step(job);
}

export function startExportRunner(): void {
  setInterval(() => {
    void tick();
  }, Math.max(20, Math.min(config.exportStepMs, 100)));
  onClockAdvance(() => {
    void tick();
  });
}
