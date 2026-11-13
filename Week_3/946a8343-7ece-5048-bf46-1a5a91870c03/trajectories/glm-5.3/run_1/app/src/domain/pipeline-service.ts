import type { PoolClient } from 'pg';
import type { Ctx } from '../api/ctx.js';
import { AppError } from '../core/errors.js';
import { getCommit, mergeBase, readTreeFlat } from './repo.js';
import { planPipeline, layoutGraph, type PlanContext } from './pipeline-run.js';
import { PIPELINE_FILE } from '../core/config.js';
import type { MrRow } from './mr-service.js';
import { filesOf } from './merge-service.js';

export interface PipelineCreation {
  id: number | null;
  created: boolean;
  reason?: string;
}

export async function configTextFor(c: PoolClient, ctx: Ctx, commitId: string): Promise<string | null> {
  const files = await filesOf(c, ctx, commitId);
  return files.get(PIPELINE_FILE) ?? null;
}

/** Create a pipeline on a commit; the single creation path for push, train and web. */
export async function createPipeline(
  ctx: Ctx,
  c: PoolClient,
  opts: {
    projectId: number;
    projectPath: string;
    ref: string;
    sha: string;
    source: 'push' | 'train' | 'web';
    defaultBranch: string;
    variables?: Record<string, string>;
    mr?: MrRow | null;
    trainMr?: MrRow | null;
    previousHead?: string | null;
    extraVars?: Record<string, string>;
    configTextOverride?: string | null;
  },
): Promise<PipelineCreation> {
  const commit = await getCommit(c, opts.sha);
  if (!commit) return { id: null, created: false, reason: 'no commit' };
  const configText = opts.configTextOverride !== undefined ? opts.configTextOverride : await configTextFor(c, ctx, opts.sha);
  if (configText === null) return { id: null, created: false, reason: 'no config' };

  const mrForVars = opts.mr ?? null;
  const variables: Record<string, string> = {
    CI_PIPELINE_SOURCE: opts.source,
    CI_COMMIT_SHA: opts.sha,
    CI_COMMIT_SHORT_SHA: opts.sha.slice(0, 7),
    CI_COMMIT_REF_NAME: opts.source === 'train' ? refForTrain(opts) : opts.ref,
    CI_DEFAULT_BRANCH: opts.defaultBranch,
    CI_PROJECT_ID: String(opts.projectId),
    CI_PROJECT_PATH: opts.projectPath,
    ...(opts.extraVars ?? {}),
  };
  variables.CI_COMMIT_BRANCH = opts.source === 'train' ? opts.ref : opts.ref;
  variables.CI_COMMIT_MESSAGE = commit.message;
  if (mrForVars) {
    variables.CI_MERGE_REQUEST_IID = String(mrForVars.iid);
    variables.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME = mrForVars.source;
    variables.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = mrForVars.target;
  }
  if (opts.source === 'train') {
    variables.CI_TRAIN = 'true';
  }

  // project variables are applied at job level; predefined+top level here
  const projectVars = await projectVariablesOf(c, opts.projectId);

  // changed files for rules
  let changedFiles: string[] | null = null;
  if (opts.source === 'push') {
    if (opts.previousHead) {
      const before = await filesOf(c, ctx, opts.previousHead);
      const after = await filesOf(c, ctx, opts.sha);
      changedFiles = [];
      for (const p of new Set([...before.keys(), ...after.keys()])) {
        if (before.get(p) !== after.get(p)) changedFiles.push(p);
      }
    } else {
      changedFiles = null;
    }
  } else if (opts.source === 'train' && opts.trainMr) {
    const version = (await c.query<{ head: string; base: string }>(`SELECT head, base FROM mr_versions WHERE mr_id = $1 ORDER BY number DESC LIMIT 1`, [opts.trainMr.id])).rows[0];
    if (version) {
      const base = await mergeBase(c, version.head, version.base);
      if (base) {
        const before = await filesOf(c, ctx, base);
        const after = await filesOf(c, ctx, opts.sha);
        changedFiles = [];
        for (const p of new Set([...before.keys(), ...after.keys()])) {
          if (before.get(p) !== after.get(p)) changedFiles.push(p);
        }
      }
    }
  } else {
    changedFiles = null;
  }

  const pc: PlanContext = {
    projectId: opts.projectId,
    projectPath: opts.projectPath,
    ref: opts.ref,
    sha: opts.sha,
    source: opts.source,
    branch: opts.ref,
    defaultBranch: opts.defaultBranch,
    commitMessage: commit.message,
    variables: { ...variables, ...projectVars },
    mrIid: mrForVars?.iid ?? null,
    mrSource: mrForVars?.source ?? null,
    mrTarget: mrForVars?.target ?? null,
    changedFiles,
    configText,
    existsPaths: [...(await filesOf(c, ctx, opts.sha)).keys()],
  };
  const plan = planPipeline(ctx, pc);
  if (!plan.created) {
    return { id: null, created: false, reason: plan.reason };
  }
  if (plan.errors.length > 0) {
    const now = ctx.now();
    const r = await c.query<{ id: number }>(
      `INSERT INTO pipelines (project_id, ref, sha, source, status, errors, config_valid, mr_id, train_mr_id, created_at)
       VALUES ($1, $2, $3, $4, 'failed', $5, false, $6, $7, $8) RETURNING id`,
      [opts.projectId, opts.ref, opts.sha, opts.source, JSON.stringify(plan.errors), opts.mr?.id ?? null, opts.trainMr?.id ?? null, now],
    );
    return { id: r.rows[0].id, created: true };
  }
  const now = ctx.now();
  const pl = (await c.query<{ id: number }>(
    `INSERT INTO pipelines (project_id, ref, sha, source, status, errors, config_valid, mr_id, train_mr_id, created_at)
     VALUES ($1, $2, $3, $4, 'running', '[]'::jsonb, true, $5, $6, $7) RETURNING id`,
    [opts.projectId, opts.ref, opts.sha, opts.source, opts.mr?.id ?? null, opts.trainMr?.id ?? null, now],
  )).rows[0];
  const pipelineId = pl.id;
  variables.CI_PIPELINE_ID = String(pipelineId);

  const jobPlans = plan.jobs.map((j, i) => ({ ...j, configIndex: i }));
  const layout = layoutGraph(jobPlans.map((j) => ({ name: j.name, stageIndex: j.stageIndex, needs: expandNeedsFor(j, jobPlans) })));
  for (let i = 0; i < jobPlans.length; i++) {
    const j = jobPlans[i];
    const lay = layout[i];
    const jobVars = { ...variables, ...j.variables, CI_JOB_NAME: j.name, CI_JOB_STAGE: j.stage, CI_JOB_ID: '0' };
    let envName: string | null = null;
    let envTier: string | null = null;
    let envAction: string | null = null;
    let envAutoStop: string | null = null;
    let envOnStop: string | null = null;
    if (j.environment) {
      envName = j.environment.name;
      envTier = j.environment.tier ?? (envName === 'production' ? 'production' : 'other');
      envAction = j.environment.action ?? 'start';
      envAutoStop = j.environment.autoStopIn ?? null;
      envOnStop = j.environment.onStop ?? null;
    }
    const needs = expandNeedsFor(j, jobPlans);
    await c.query(
      `INSERT INTO jobs (pipeline_id, project_id, name, stage, stage_index, config_index, status, attempt, needs, layer, row, x, y, script, config, env_name, when_kind, allow_failure, interruptible, resource_group, retry_config, timeout_ms, artifacts, cache_config, dependencies, matrix_values, has_env_action)
       VALUES ($1, $2, $3, $4, $5, $6, 'created', 1, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
      [
        pipelineId, opts.projectId, j.name, j.stage, j.stageIndex, j.configIndex,
        needs, lay.layer, lay.row, lay.x, lay.y,
        JSON.stringify(j.script), JSON.stringify({ start_in: j.startIn, env_tier: envTier, env_action: envAction, env_auto_stop_in: envAutoStop, env_on_stop: envOnStop, allow_failure: j.allow_failure }),
        envName, j.when, j.allow_failure, j.interruptible, j.resourceGroup,
        JSON.stringify({ max: j.retry, when: j.retryWhen }),
        j.timeoutMs,
        JSON.stringify(j.artifacts),
        JSON.stringify(j.cache),
        j.dependencies ?? [], JSON.stringify(j.matrixValues),
        envName !== null,
      ],
    );
  }
  // step 4 applies once at creation
  await applyCreationEligibility(ctx, c, pipelineId, plan);
  await ctx.live(c, opts.projectId, 'pipeline', { pipeline_id: pipelineId, status: 'running', ref: opts.ref, sha: opts.sha, source: opts.source });
  return { id: pipelineId, created: true };
}

function refForTrain(opts: { ref: string; trainMr?: MrRow | null }): string {
  return opts.ref;
}

function expandNeedsFor(j: { name: string; needs: string[] }, all: Array<{ name: string; needs: string[] }>): string[] {
  // needs on a matrix job needs every expansion
  const out = new Set<string>();
  for (const need of j.needs) {
    const matching = all.filter((x) => x.name === need || x.name.startsWith(`${need} [`) || x.name === need);
    if (matching.length > 0) {
      for (const m of matching) out.add(m.name);
    } else {
      out.add(need);
    }
  }
  return [...out];
}

export async function projectVariablesOf(c: PoolClient, projectId: number): Promise<Record<string, string>> {
  const r = await c.query<{ key: string; value: string }>(`SELECT key, value FROM variables WHERE project_id = $1`, [projectId]);
  const out: Record<string, string> = {};
  for (const row of r.rows) out[row.key] = row.value;
  return out;
}

async function applyCreationEligibility(ctx: Ctx, c: PoolClient, pipelineId: number, plan: ReturnType<typeof planPipeline>): Promise<void> {
  void plan;
  const jobs = (await c.query<{ id: number; name: string; stage_index: number; status: string; needs: string[]; when_kind: string; config: Record<string, unknown> }>(`SELECT id, name, stage_index, status, needs, when_kind, config FROM jobs WHERE pipeline_id = $1`, [pipelineId])).rows;
  const now = ctx.now();
  for (const j of jobs) {
    if (j.status !== 'created') continue;
    const firstStage = Math.min(...jobs.map((x) => x.stage_index));
    if (j.stage_index !== firstStage && j.needs.length === 0) continue;
    if (j.needs.length > 0) continue;
    if (j.when_kind === 'manual') continue;
    if (j.when_kind === 'delayed') {
      const startIn = parseStartIn((j.config as { start_in?: string }).start_in);
      await c.query(`UPDATE jobs SET status = 'scheduled', start_at = $2 WHERE id = $1`, [j.id, now + startIn]);
      continue;
    }
    await setPending(c, j.id, now);
  }
}

function parseStartIn(v: string | undefined): number {
  if (!v) return 0;
  const m = v.trim().match(/^(\d+)(ms|s|m|h)$/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  if (m[2] === 'ms') return n;
  if (m[2] === 's') return n * 1000;
  if (m[2] === 'm') return n * 60_000;
  return n * 3_600_000;
}


/** Interruptible pipeline cancellation on a new push. */
export async function cancelOlderInterruptible(ctx: Ctx, c: PoolClient, projectId: number, branch: string, newPipelineId: number, now: number): Promise<number[]> {
  const rows = (await c.query<{ id: number; status: string; sha: string }>(
    `SELECT id, status, sha FROM pipelines WHERE project_id = $1 AND ref = $2 AND source = 'push' AND id < $3`,
    [projectId, branch, newPipelineId],
  )).rows;
  const canceled: number[] = [];
  for (const p of rows) {
    if (!['created', 'running', 'pending', 'blocked', 'scheduled'].includes(p.status)) continue;
    const jobs = (await c.query<{ id: number; status: string; interruptible: boolean; started_at: number | null }>(`SELECT id, status, interruptible, started_at FROM jobs WHERE pipeline_id = $1`, [p.id])).rows;
    const anyStartedNonInterruptible = jobs.some((j) => j.started_at !== null && !j.interruptible);
    if (anyStartedNonInterruptible) continue;
    const unfinished = jobs.filter((j) => ['created', 'pending', 'running', 'waiting', 'scheduled'].includes(j.status));
    for (const j of unfinished) {
      await c.query(`UPDATE jobs SET status = 'canceled', failure_reason = $3, finished_at = $2 WHERE id = $1`, [j.id, now, `Canceled by newer pipeline ${newPipelineId}.`]);
      await appendLogLine(c, j.id, 'sys', `Canceled by newer pipeline ${newPipelineId}.`);
    }
    await c.query(`UPDATE pipelines SET status = 'canceled', finished_at = $2 WHERE id = $1`, [p.id, now]);
    await ctx.live(c, projectId, 'pipeline', { pipeline_id: p.id, status: 'canceled' });
    canceled.push(p.id);
  }
  return canceled;
}

export async function appendLogLine(c: PoolClient, jobId: number, stream: 'out' | 'sys', text: string): Promise<void> {
  const r = await c.query<{ n: number }>(`SELECT COALESCE(max(n), 0) AS n FROM job_log_lines WHERE job_id = $1`, [jobId]);
  const n = Number(r.rows[0]?.n ?? 0) + 1;
  await c.query(`INSERT INTO job_log_lines (job_id, n, stream, text) VALUES ($1, $2, $3, $4)`, [jobId, n, stream, text]);
}

async function setPending(c: PoolClient, jobId: number, now: number): Promise<void> {
  void now;
  await c.query(`UPDATE jobs SET status = 'pending' WHERE id = $1`, [jobId]);
}
