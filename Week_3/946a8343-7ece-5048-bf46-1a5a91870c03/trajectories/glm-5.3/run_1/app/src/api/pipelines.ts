import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, writeAudit } from './common.js';
import { effectiveAccess, hasPermission, ROLE_LEVEL } from '../domain/access.js';
import { createPipeline, configTextFor, projectVariablesOf, appendLogLine } from '../domain/pipeline-service.js';
import { lintPipeline } from '../domain/pipeline-config.js';
import { latestAttempts, rollupStatus, Scheduler, type JobRow } from '../domain/scheduler.js';
import { onCarPipelineFinished } from '../domain/train.js';
import { PIPELINE_FILE } from '../core/config.js';

export async function createWebPipeline(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const variables = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
    ? Object.fromEntries(Object.entries(body.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : {};
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireMinRole(access, 'developer');
    const head = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, ref])).rows[0]?.commit_id;
    if (!head) throw errs.validation({ ref: `Branch ${ref} doesn't exist.` });
    const result = await createPipeline(rc.ctx, client, {
      projectId: id, projectPath: project.path, ref, sha: head, source: 'web', defaultBranch: project.default_branch, extraVars: variables,
    });
    await client.query('COMMIT');
    if (!result.created || result.id === null) {
      return { id: null, created: false, reason: result.reason, seq: await rc.ctx.currentSeq(rc.ctx.db.pool, id) };
    }
    return { id: result.id, seq: await rc.ctx.live(rc.ctx.db.pool, id, 'pipeline', { pipeline_id: result.id, status: 'running' }) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function listPipelines(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const ref = rc.query.get('ref');
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const rows = ref
      ? (await client.query(`SELECT id, ref, sha, source, status, created_at, finished_at FROM pipelines WHERE project_id = $1 AND ref = $2 ORDER BY id DESC`, [id, ref])).rows
      : (await client.query(`SELECT id, ref, sha, source, status, created_at, finished_at FROM pipelines WHERE project_id = $1 ORDER BY id DESC`, [id])).rows;
    return { pipelines: rows };
  } finally {
    client.release();
  }
}

export async function getPipeline(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const pid = Number(rc.params.pid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const pl = (await client.query<{ id: number; project_id: number; ref: string; sha: string; source: string; status: string; errors: string[]; config_valid: boolean; created_at: number; finished_at: number | null }>(
      `SELECT id, project_id, ref, sha, source, status, errors, config_valid, created_at, finished_at FROM pipelines WHERE id = $1`, [pid])).rows[0];
    if (!pl) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, pl.project_id, rc.user.id);
    requireReadCode(access);
    const jobs = (await client.query<JobRow>(`SELECT * FROM jobs WHERE pipeline_id = $1 ORDER BY stage_index, config_index, id`, [pid])).rows;
    const latest = latestAttempts(jobs);
    const stages = [...new Set(latest.map((j) => j.stage))].map((name) => {
      const stageJobs = latest.filter((j) => j.stage === name);
      return { name, status: rollupStatus(stageJobs) };
    });
    const now = rc.ctx.now();
    return {
      id: pl.id,
      ref: pl.ref,
      sha: pl.sha,
      source: pl.source,
      status: pl.status,
      errors: pl.errors,
      stages,
      jobs: latest.map((j) => ({
        id: j.id,
        name: j.name,
        stage: j.stage,
        status: j.status,
        attempt: j.attempt,
        retried: j.retried,
        failure_reason: j.failure_reason,
        layer: j.layer,
        row: j.row,
        x: j.x,
        y: j.y,
        needs: j.needs,
        started_at: j.started_at,
        finished_at: j.finished_at,
        start_at: j.start_at,
        duration: j.started_at === null ? 'not started' : j.finished_at === null ? 'in progress' : formatDuration(j.started_at, j.finished_at),
        allow_failure: j.allow_failure,
        script: j.script,
      })),
      now,
    };
    void now;
  } finally {
    client.release();
  }
}

function formatDuration(start: number, end: number): string {
  const secs = Math.max(0, Math.round((end - start) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

export async function retryPipeline(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const pid = Number(rc.params.pid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const pl = (await client.query<{ id: number; project_id: number }>(`SELECT id, project_id FROM pipelines WHERE id = $1`, [pid])).rows[0];
    if (!pl) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, pl.project_id, rc.user.id);
    requireMinRole(access, 'developer');
    const jobs = (await client.query<JobRow>(`SELECT * FROM jobs WHERE pipeline_id = $1`, [pid])).rows;
    const latest = latestAttempts(jobs);
    const scheduler = new Scheduler(rc.ctx);
    for (const j of latest) {
      if (j.status === 'failed' || j.status === 'canceled') {
        await scheduler.retryJob(client, j, true);
      } else if (j.status === 'skipped') {
        await client.query(`UPDATE jobs SET status = 'created' WHERE id = $1`, [j.id]);
      }
    }
    await client.query(`UPDATE pipelines SET status = 'running', finished_at = NULL WHERE id = $1`, [pid]);
    const seq = await rc.ctx.live(client, pl.project_id, 'pipeline', { pipeline_id: pid, status: 'running' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelPipeline(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const pid = Number(rc.params.pid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const pl = (await client.query<{ id: number; project_id: number }>(`SELECT id, project_id FROM pipelines WHERE id = $1`, [pid])).rows[0];
    if (!pl) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, pl.project_id, rc.user.id);
    requireMinRole(access, 'developer');
    const now = rc.ctx.now();
    await client.query(`UPDATE jobs SET status = 'canceled', failure_reason = 'canceled by user', finished_at = $2 WHERE pipeline_id = $1 AND status IN ('created','pending','running','waiting','scheduled')`, [pid, now]);
    for (const j of (await client.query<{ id: number }>(`SELECT id FROM jobs WHERE pipeline_id = $1`, [pid])).rows) {
      await appendLogLine(client, j.id, 'sys', 'Job canceled by user');
    }
    await client.query(`UPDATE pipelines SET status = 'canceled', finished_at = $2 WHERE id = $1`, [pid, now]);
    const seq = await rc.ctx.live(client, pl.project_id, 'pipeline', { pipeline_id: pid, status: 'canceled' });
    await onCarPipelineFinished(rc.ctx, client, pl.project_id, '', pid, 'canceled', 'main');
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function lintConfig(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const body = requireBody(rc);
  const content = typeof body.content === 'string' ? body.content : '';
  const ref = typeof body.ref === 'string' ? body.ref : '';
  const variables = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
    ? Object.fromEntries(Object.entries(body.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
    : {};
  const changedFiles = Array.isArray(body.changed_files) ? body.changed_files.map(String) : [];
  const client = await rc.ctx.db.pool.connect();
  try {
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const refHead = (await client.query<{ commit_id: string }>(`SELECT commit_id FROM refs WHERE project_id = $1 AND kind = 'branch' AND name = $2`, [id, ref])).rows[0]?.commit_id ?? null;
    const { filesOf } = await import('../domain/merge-service.js');
    const cache = new Map<string, string | null>();
    if (refHead) {
      const refFiles = await filesOf(client, rc.ctx, refHead);
      cache.set(PIPELINE_FILE, content);
      for (const [k, v] of refFiles) if (k !== PIPELINE_FILE) cache.set(k, v);
    } else {
      cache.set(PIPELINE_FILE, content);
    }
    const lint = lintPipeline(content, (path) => cache.get(path) ?? null, { retryMax: rc.ctx.settings.retryMax });
    void project; void variables; void changedFiles;
    if (lint.valid && lint.raw) {
      const jobList: Array<{ name: string; stage: string; variables: Record<string, string> }> = [];
      for (const [name, cfg] of lint.raw.jobs) {
        if (name.startsWith('.')) continue;
        const expanded = expandMatrixNames(cfg);
        for (const [expName, matrixValues] of expanded) {
          jobList.push({ name: expName, stage: cfg.stage, variables: { ...cfg.variables, ...matrixValues } });
        }
      }
      const summary = `Valid. ${jobList.length} jobs in ${lint.raw.stages.length} stages.`;
      return { valid: true, errors: [], summary, jobs: jobList };
    }
    return { valid: false, errors: lint.errors.map((e) => e.message), summary: '', jobs: [] };
  } finally {
    client.release();
  }
}

function expandMatrixNames(cfg: { matrix: Record<string, string[]>; name: string }): Array<[string, Record<string, string>]> {
  const keys = Object.keys(cfg.matrix);
  if (keys.length === 0) return [[cfg.name, {}]];
  const combos: Array<Record<string, string>> = [];
  const build = (i: number, acc: Record<string, string>): void => {
    if (i === keys.length) {
      combos.push({ ...acc });
      return;
    }
    for (const v of cfg.matrix[keys[i]]) {
      acc[keys[i]] = v;
      build(i + 1, acc);
    }
  };
  build(0, {});
  return combos.map((m) => {
    const label = keys.map((k) => m[k]).join(', ');
    return [`${cfg.name} [${label}]`, m] as [string, Record<string, string>];
  });
}


export async function getJob(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const job = (await client.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireReadCode(access);
    const lines = (await client.query<{ n: number; stream: string; text: string }>(`SELECT n, stream, text FROM job_log_lines WHERE job_id = $1 ORDER BY n`, [jid])).rows;
    const artifacts = (await client.query<{ path: string; size: number; expires_at: number | null; object_key: string | null; keep: boolean }>(`SELECT path, size, expires_at, object_key, keep FROM artifacts WHERE job_id = $1`, [jid])).rows;
    const now = rc.ctx.now();
    const logSealed = ((job.config as { log_sealed?: boolean }).log_sealed) === true;
    return {
      id: job.id,
      name: job.name,
      stage: job.stage,
      status: job.status,
      attempt: job.attempt,
      retried: job.retried,
      failure_reason: job.failure_reason,
      started_at: job.started_at,
      finished_at: job.finished_at,
      start_at: job.start_at,
      log_sealed: logSealed,
      log: lines.map((l) => `${l.n} ${l.stream} ${l.text}`),
      artifacts: artifacts.map((a) => ({
        path: a.path,
        size: a.size,
        expires_at: a.expires_at,
        expired: a.expires_at !== null && a.expires_at < now,
        keep: a.keep,
      })),
      environment: job.env_name,
      waiting: job.status === 'waiting',
      needs: job.needs,
      pipeline_id: job.pipeline_id,
      allow_failure: job.allow_failure,
      when: job.when_kind,
      duration: job.started_at === null ? 'not started' : job.finished_at === null ? 'in progress' : formatDuration(job.started_at, job.finished_at),
      now,
    };
  } finally {
    client.release();
  }
}

export async function getJobLog(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const job = (await client.query<{ project_id: number }>(`SELECT project_id FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireReadCode(access);
    const lines = (await client.query<{ n: number; stream: string; text: string }>(`SELECT n, stream, text FROM job_log_lines WHERE job_id = $1 ORDER BY n`, [jid])).rows;
    return { lines: lines.map((l) => `${l.n} ${l.stream} ${l.text}`) };
  } finally {
    client.release();
  }
}

export async function playJob(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireMinRole(access, 'developer');
    if (job.status !== 'manual') throw new AppError(409, 'wrong_state', 'Only manual jobs can be played.');
    await client.query(`UPDATE jobs SET status = 'pending', started_by = $2 WHERE id = $1`, [jid, rc.user.id]);
    const seq = await rc.ctx.live(client, job.project_id, 'job', { job_id: jid, status: 'pending' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function retryJob(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireMinRole(access, 'developer');
    if (!['failed', 'success', 'canceled', 'warning'].includes(job.status)) {
      throw new AppError(409, 'wrong_state', 'Only finished jobs can be retried.');
    }
    const scheduler = new Scheduler(rc.ctx);
    const newId = await scheduler.retryJob(client, job, true);
    const seq = await rc.ctx.live(client, job.project_id, 'job', { job_id: newId, status: 'pending' });
    await client.query('COMMIT');
    return { id: newId, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function cancelJob(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<JobRow>(`SELECT * FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireMinRole(access, 'developer');
    if (!['created', 'pending', 'running', 'waiting', 'scheduled', 'manual'].includes(job.status)) {
      throw new AppError(409, 'wrong_state', 'Only unfinished jobs can be canceled.');
    }
    const now = rc.ctx.now();
    await client.query(`UPDATE jobs SET status = 'canceled', failure_reason = 'canceled by user', finished_at = $2 WHERE id = $1`, [jid, now]);
    await appendLogLine(client, jid, 'sys', 'Job canceled by user');
    await appendLogLine(client, jid, 'sys', 'Job finished: canceled');
    await client.query(`UPDATE pipelines SET status = 'canceled', finished_at = $2 WHERE id = $1 AND status NOT IN ('success','failed','canceled')`, [job.pipeline_id, now]);
    const seq = await rc.ctx.live(client, job.project_id, 'job', { job_id: jid, status: 'canceled' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function downloadArtifact(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const path = rc.params.path;
  const client = await rc.ctx.db.pool.connect();
  try {
    const job = (await client.query<{ project_id: number }>(`SELECT project_id FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    requireReadCode(access);
    const art = (await client.query<{ object_key: string | null; expires_at: number | null }>(`SELECT object_key, expires_at FROM artifacts WHERE job_id = $1 AND path = $2`, [jid, path])).rows[0];
    if (!art || !art.object_key) throw errs.notFound();
    const now = rc.ctx.now();
    if (art.expires_at !== null && art.expires_at < now) throw errs.notFound();
    const content = await rc.ctx.storage.tryGet(art.object_key);
    if (content === null) {
      throw new AppError(503, 'storage_unavailable', 'File storage is unavailable. Uploads, artifacts and exports are paused.');
    }
    return { __file: content, __type: 'text/plain; charset=utf-8' };
  } finally {
    client.release();
  }
}

export async function keepArtifacts(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const jid = Number(rc.params.jid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query<{ project_id: number }>(`SELECT project_id FROM jobs WHERE id = $1`, [jid])).rows[0];
    if (!job) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, job.project_id, rc.user.id);
    if (!hasPermission(access, 'manage_environments')) requireMinRole(access, 'maintainer');
    await client.query(`UPDATE artifacts SET expires_at = NULL, keep = true WHERE job_id = $1`, [jid]);
    const seq = await rc.ctx.live(client, job.project_id, 'job', { job_id: jid, event: 'artifacts_kept' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export { effectiveAccess, ROLE_LEVEL };
