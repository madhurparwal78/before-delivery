import { loadProject } from './access';
import { nowMs } from './clock';
import { config } from './config';
import { db } from './db';
import { Tx, dueLeaves, emit, tx, viewersOf } from './live';
import { applyPack, exportProject, parsePack } from './pack';
import { StorageUnavailable, putObject } from './storage';
import { timeoutCars } from './train';
import { stopEnvironment, loadEnvironment } from './envs';
import { flushDeliveries } from './webhooks';

export const exportOutageText = 'Export failed: file storage is unavailable.';

async function stepExports(t: Tx): Promise<void> {
  const rows = await t.sql.query<{ id: string; project_id: string; progress: number; next_step_ms: string }>(
    `select id, project_id, progress, next_step_ms from exports where status = 'running' and next_step_ms <= $1`,
    [nowMs()],
  );
  for (const row of rows) {
    const id = Number(row.id);
    const projectId = Number(row.project_id);
    const progress = Number(row.progress) + 20;
    if (progress < 100) {
      await t.sql.query('update exports set progress = $2, next_step_ms = $3 where id = $1', [
        id,
        progress,
        nowMs() + config.exportStepMs,
      ]);
      await emit(t, projectId, 'export', { export_id: id, progress, status: 'running' });
      continue;
    }
    const project = await loadProject(t.sql, projectId);
    if (project === null) continue;
    try {
      const text = await exportProject(t.sql, project);
      const key = `exports/${projectId}/${id}.spurpack`;
      await putObject(key, text);
      await t.sql.query("update exports set progress = 100, status = 'finished', object_key = $2 where id = $1", [
        id,
        key,
      ]);
      await emit(t, projectId, 'export', {
        export_id: id,
        progress: 100,
        status: 'finished',
        announcement: 'Export ready.',
      });
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      await t.sql.query("update exports set status = 'failed', error = $2 where id = $1", [id, exportOutageText]);
      await emit(t, projectId, 'export', {
        export_id: id,
        progress: Number(row.progress),
        status: 'failed',
        error: exportOutageText,
        announcement: exportOutageText,
      });
    }
  }
}

async function stepImports(t: Tx): Promise<void> {
  const rows = await t.sql.query<{ id: string; project_id: string | null; progress: number; content: string }>(
    `select id, project_id, progress, content from imports where status = 'running' and next_step_ms <= $1`,
    [nowMs()],
  );
  for (const row of rows) {
    const id = Number(row.id);
    const projectId = row.project_id === null ? null : Number(row.project_id);
    if (projectId === null) continue;
    const progress = Number(row.progress) + 20;
    if (progress < 100) {
      await t.sql.query('update imports set progress = $2, next_step_ms = $3 where id = $1', [
        id,
        progress,
        nowMs() + config.exportStepMs,
      ]);
      await emit(t, projectId, 'import', { import_id: id, progress, status: 'running' });
      continue;
    }
    const project = await loadProject(t.sql, projectId);
    if (project === null) continue;
    const parsed = await parsePack(t.sql, row.content);
    await applyPack(t, project, parsed);
    await t.sql.query("update imports set progress = 100, status = 'finished' where id = $1", [id]);
    await emit(t, projectId, 'import', {
      import_id: id,
      progress: 100,
      status: 'finished',
      announcement: `Import finished: ${parsed.commits.length} commits, ${parsed.issues.length} issues, ${parsed.requests.length} requests.`,
    });
  }
}

async function stepEnvironments(t: Tx): Promise<void> {
  const rows = await t.sql.query<{ id: string; project_id: string }>(
    `select id, project_id from environments where auto_stop_ms is not null and auto_stop_ms <= $1 and state = 'available'`,
    [nowMs()],
  );
  for (const row of rows) {
    const project = await loadProject(t.sql, Number(row.project_id));
    const environment = await loadEnvironment(t.sql, Number(row.id));
    if (project === null || environment === null) continue;
    await stopEnvironment(t, project, environment, 'system');
  }
}

async function stepArtifacts(t: Tx): Promise<void> {
  const rows = await t.sql.query<{ id: string; object_key: string }>(
    'select id, object_key from artifacts where expires_ms is not null and expires_ms <= $1',
    [nowMs()],
  );
  for (const row of rows) {
    await t.sql.query('delete from artifacts where id = $1', [Number(row.id)]);
    const { deleteObject } = await import('./storage');
    try {
      await deleteObject(row.object_key);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  }
}

async function stepPresence(t: Tx): Promise<void> {
  const done = new Set<number>();
  for (const leave of dueLeaves(config.presenceTimeoutMs)) {
    if (done.has(leave.projectId)) continue;
    done.add(leave.projectId);
    await emit(t, leave.projectId, 'presence', { viewing: viewersOf(leave.projectId) });
  }
}

async function stepTrains(t: Tx): Promise<void> {
  const rows = await t.sql.query<{ project_id: string }>('select distinct project_id from train_cars', []);
  for (const row of rows) {
    const project = await loadProject(t.sql, Number(row.project_id));
    if (project === null) continue;
    await timeoutCars(t, project);
  }
}

export async function runDeadlines(): Promise<void> {
  await tx(async (t) => {
    await stepExports(t);
    await stepImports(t);
    await stepEnvironments(t);
    await stepArtifacts(t);
    await stepTrains(t);
    await stepPresence(t);
  });
  await flushDeliveries();
}

export function startBackgroundTimers(): void {
  setInterval(() => {
    void runDeadlines().catch(() => undefined);
  }, 250).unref();
  if (!config.grading) {
    setInterval(() => {
      void runProjectRounds().catch(() => undefined);
    }, 1000).unref();
  }
}

async function runProjectRounds(): Promise<void> {
  const rows = await db.query<{ project_id: string }>(
    `select distinct project_id from pipelines where status not in ('success','failed','canceled','skipped')`,
    [],
  );
  for (const row of rows) {
    await tx(async (t) => {
      const { runRound } = await import('./runner');
      const project = await loadProject(t.sql, Number(row.project_id));
      if (project === null) return;
      await runRound(t, project);
    });
  }
}
