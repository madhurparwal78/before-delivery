import { ProjectRow, loadProject } from './access';
import { nowMs } from './clock';
import { config } from './config';
import { expandVariables } from './ciconfig';
import { Sql } from './db';
import { Tx, emit } from './live';
import {
  JobRow,
  appendLog,
  isFinished,
  jobsOfPipeline,
  loadPipeline,
  normalizeJob,
  rollup,
} from './pipeline';
import { filesOfCommit } from './repo';
import { globMatch } from './glob';
import { StorageUnavailable, getObject, putObject } from './storage';
import {
  createDeployment,
  ensureEnvironment,
  latestSuccessful,
  loadDeployment,
  loadEnvironment,
  protectionOf,
  setDeploymentStatus,
} from './envs';
import { queueEvent } from './webhooks';

export type RoundResult = { changed: boolean; jobs: { id: number; name: string; status: string }[] };

async function activePipelines(sql: Sql, projectId: number): Promise<number[]> {
  const rows = await sql.query<{ id: string }>(
    `select id from pipelines where project_id = $1 and status not in ('success','failed','canceled','skipped')
     order by id`,
    [projectId],
  );
  return rows.map((row) => Number(row.id));
}

async function loadJob(sql: Sql, id: number): Promise<JobRow | null> {
  const row = await sql.one<JobRow>(
    `select id, project_id, pipeline_id, name, stage, stage_index, config_order, status, attempt, retried,
            failure_reason, spec, variables, needs, layer, row_index, started_ms, finished_ms, start_at_ms,
            script_index, wait_start_ms, wait_ms, log, log_sealed, workspace, retry_count, resource_group, deployment_id
     from jobs where id = $1`,
    [id],
  );
  return row === null ? null : normalizeJob(row);
}

export async function jobById(sql: Sql, id: number): Promise<JobRow | null> {
  return loadJob(sql, id);
}

async function setStatus(t: Tx, job: JobRow, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  await t.sql.query('update jobs set status = $2 where id = $1', [job.id, status]);
  await emit(t, job.project_id, 'job', { job_id: job.id, name: job.name, status, ...extra });
}

function announcementFor(name: string, status: string): string | null {
  if (status === 'running') return `Job ${name} started`;
  if (status === 'success') return `Job ${name} succeeded`;
  if (status === 'failed') return `Job ${name} failed`;
  return null;
}

export async function failJob(
  t: Tx,
  project: ProjectRow,
  jobId: number,
  status: 'failed' | 'canceled',
  reasonLine: string,
): Promise<void> {
  const job = await loadJob(t.sql, jobId);
  if (job === null || isFinished(job.status)) return;
  await appendLog(t, job, 'sys', reasonLine);
  await finishJob(t, project, job, status, 'script_failure');
}

async function sealLog(t: Tx, job: JobRow): Promise<void> {
  const rows = await t.sql.one<{ log: { stream: string; text: string }[] }>('select log from jobs where id = $1', [
    job.id,
  ]);
  const lines = (rows?.log ?? []).map((entry, index) => `${index + 1} ${entry.stream} ${entry.text}\n`).join('');
  try {
    await putObject(`logs/${job.id}.log`, lines);
    await t.sql.query('update jobs set log_sealed = true where id = $1', [job.id]);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
  }
}

async function finishJob(
  t: Tx,
  project: ProjectRow,
  job: JobRow,
  status: 'success' | 'failed' | 'canceled' | 'warning',
  reason: string | null,
): Promise<void> {
  const finalStatus = status === 'failed' && job.spec.allow_failure ? 'warning' : status;
  await t.sql.query('update jobs set status = $2, finished_ms = $3, failure_reason = $4 where id = $1', [
    job.id,
    finalStatus,
    nowMs(),
    reason,
  ]);
  await appendLog(t, job, 'sys', `Job finished: ${finalStatus}`);
  await sealLog(t, job);
  const announcement = announcementFor(job.name, finalStatus === 'warning' ? 'success' : finalStatus);
  await emit(t, job.project_id, 'job', {
    job_id: job.id,
    name: job.name,
    status: finalStatus,
    ...(announcement === null ? {} : { announcement }),
  });
  if (job.deployment_id !== null) {
    const deployment = await loadDeployment(t.sql, job.deployment_id);
    if (deployment !== null && !['success', 'failed', 'canceled', 'rolled_back'].includes(deployment.status)) {
      const next = finalStatus === 'success' || finalStatus === 'warning' ? 'success' : finalStatus === 'canceled' ? 'canceled' : 'failed';
      await setDeploymentStatus(t, project, deployment, next, 'system');
      if (next === 'success') {
        await recordDeploymentArtifacts(t, job, deployment.id);
        await applyAutoStop(t, project, job, deployment.environment_id);
      }
    }
  }
  if (job.spec.environment !== null && job.spec.environment.action === 'stop' && finalStatus === 'success') {
    const environment = await t.sql.one<{ id: string }>(
      'select id from environments where project_id = $1 and name = $2',
      [project.id, job.spec.environment.name],
    );
    if (environment !== null) {
      await t.sql.query("update environments set state = 'stopped', auto_stop_ms = null where id = $1", [
        Number(environment.id),
      ]);
      await emit(t, project.id, 'environment', { environment_id: Number(environment.id), state: 'stopped' });
    }
  }
}

async function recordDeploymentArtifacts(t: Tx, job: JobRow, deploymentId: number): Promise<void> {
  const rows = await t.sql.query<{ object_key: string }>('select object_key from artifacts where job_id = $1', [job.id]);
  const keys: string[] = rows.map((row) => row.object_key);
  const siblings = await jobsOfPipeline(t.sql, job.pipeline_id);
  const sources =
    job.needs !== null
      ? siblings.filter((candidate) => (job.needs ?? []).includes(candidate.name))
      : siblings.filter((candidate) => candidate.stage_index < job.stage_index);
  const limited =
    job.spec.dependencies === null
      ? sources
      : sources.filter((candidate) => (job.spec.dependencies ?? []).includes(candidate.name));
  for (const source of limited) {
    const inherited = await t.sql.query<{ object_key: string }>(
      'select object_key from artifacts where job_id = $1',
      [source.id],
    );
    keys.push(...inherited.map((row) => row.object_key));
  }
  await t.sql.query('update deployments set artifact_keys = $2 where id = $1', [
    deploymentId,
    JSON.stringify([...new Set(keys)]),
  ]);
}

async function applyAutoStop(t: Tx, project: ProjectRow, job: JobRow, environmentId: number): Promise<void> {
  const environment = await loadEnvironment(t.sql, environmentId);
  if (environment === null) return;
  const spec = job.spec.environment;
  const isReview = environment.name.startsWith('review/');
  const span = spec?.auto_stop_in_ms ?? (isReview ? config.autoStopMs : null);
  if (span === null) return;
  await t.sql.query('update environments set auto_stop_ms = $2 where id = $1', [environment.id, nowMs() + span]);
  await emit(t, project.id, 'environment', {
    environment_id: environment.id,
    name: environment.name,
    auto_stop_at: new Date(nowMs() + span).toISOString(),
  });
}

function jobVariables(job: JobRow): Record<string, string> {
  return {
    ...job.variables,
    CI_JOB_ID: String(job.id),
    CI_JOB_NAME: job.name,
    CI_JOB_STAGE: job.stage,
    CI_ENVIRONMENT_NAME: job.spec.environment === null ? '' : job.spec.environment.name,
  };
}

async function startWork(t: Tx, project: ProjectRow, job: JobRow): Promise<boolean> {
  const pipeline = await loadPipeline(t.sql, job.pipeline_id);
  if (pipeline === null) return false;
  const workspace: Record<string, string> = {};
  const files = await filesOfCommit(t.sql, project.id, pipeline.sha);
  for (const [path, content] of files) workspace[path] = content;

  if (job.spec.cache !== null && job.spec.cache.policy !== 'push') {
    await appendLog(t, job, 'sys', 'section_start cache');
    const keys = [job.spec.cache.key, ...job.spec.cache.fallback_keys];
    let restored = false;
    let lastKey = job.spec.cache.key;
    try {
      for (const [index, key] of keys.entries()) {
        lastKey = key;
        const row = await t.sql.one<{ updated_ms: string; object_key: string }>(
          'select updated_ms, object_key from caches where project_id = $1 and key = $2',
          [project.id, key],
        );
        if (row === null) continue;
        if (Number(row.updated_ms) + config.cacheTtlMs <= nowMs()) {
          await appendLog(t, job, 'sys', `Cache stale: ${key}`);
          continue;
        }
        const body = await getObject(row.object_key);
        if (body === null) continue;
        const stored = JSON.parse(body.toString('utf8')) as Record<string, string>;
        for (const [path, content] of Object.entries(stored)) workspace[path] = content;
        await appendLog(t, job, 'sys', index === 0 ? `Cache hit: ${key}` : `Cache hit from fallback: ${key}`);
        restored = true;
        break;
      }
      if (!restored) await appendLog(t, job, 'sys', `Cache miss: ${lastKey}`);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
      await appendLog(t, job, 'sys', 'Cache skipped: file storage is unavailable.');
    }
    await appendLog(t, job, 'sys', 'section_end cache');
  }

  const siblings = await jobsOfPipeline(t.sql, job.pipeline_id);
  const sources =
    job.needs !== null
      ? siblings.filter((candidate) => (job.needs ?? []).includes(candidate.name))
      : siblings.filter((candidate) => candidate.stage_index < job.stage_index);
  const limited =
    job.spec.dependencies === null ? sources : sources.filter((candidate) => (job.spec.dependencies ?? []).includes(candidate.name));
  for (const source of limited) {
    const artifacts = await t.sql.query<{ path: string; object_key: string; expires_ms: string | null }>(
      'select path, object_key, expires_ms from artifacts where job_id = $1 order by path',
      [source.id],
    );
    if (artifacts.length === 0) continue;
    const expired = artifacts.some((item) => item.expires_ms !== null && Number(item.expires_ms) <= nowMs());
    if (expired) {
      await appendLog(t, job, 'sys', `Artifacts of ${source.name} have expired.`);
      await finishJob(t, project, { ...job, workspace }, 'failed', 'system_failure');
      return false;
    }
    try {
      for (const artifact of artifacts) {
        const body = await getObject(artifact.object_key);
        if (body !== null) workspace[artifact.path] = body.toString('utf8');
      }
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
    await appendLog(t, job, 'sys', `Downloaded artifacts of ${source.name}`);
  }
  await t.sql.query('update jobs set workspace = $2 where id = $1', [job.id, JSON.stringify(workspace)]);
  await appendLog(t, job, 'sys', 'section_start script');
  return true;
}

async function uploadArtifacts(t: Tx, job: JobRow, status: 'success' | 'failed'): Promise<boolean> {
  const spec = job.spec.artifacts;
  if (spec === null || spec.paths.length === 0) return true;
  if (spec.when === 'on_success' && status !== 'success') return true;
  if (spec.when === 'on_failure' && status !== 'failed') return true;
  const row = await t.sql.one<{ workspace: Record<string, string> }>('select workspace from jobs where id = $1', [job.id]);
  const workspace = row?.workspace ?? {};
  const matched = Object.keys(workspace)
    .filter((path) => spec.paths.some((glob) => globMatch(glob, path)))
    .sort();
  await appendLog(t, job, 'sys', 'section_start artifacts');
  try {
    for (const path of matched) {
      const key = `artifacts/${job.id}/${path}`;
      await putObject(key, workspace[path]);
      const expires = spec.never_expires
        ? null
        : nowMs() + (spec.expire_in_ms === null ? config.artifactTtlMs : spec.expire_in_ms);
      await t.sql.query(
        'insert into artifacts (job_id, path, size, expires_ms, object_key) values ($1, $2, $3, $4, $5)',
        [job.id, path, Buffer.byteLength(workspace[path], 'utf8'), expires, key],
      );
    }
    await appendLog(t, job, 'sys', `Uploaded ${matched.length} artifact files`);
    await appendLog(t, job, 'sys', 'section_end artifacts');
    return true;
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await appendLog(t, job, 'sys', 'Artifact upload failed: file storage is unavailable.');
    await appendLog(t, job, 'sys', 'section_end artifacts');
    return false;
  }
}

async function saveCache(t: Tx, project: ProjectRow, job: JobRow): Promise<void> {
  const spec = job.spec.cache;
  if (spec === null || spec.policy === 'pull') return;
  const row = await t.sql.one<{ workspace: Record<string, string> }>('select workspace from jobs where id = $1', [job.id]);
  const workspace = row?.workspace ?? {};
  const stored: Record<string, string> = {};
  for (const path of Object.keys(workspace).sort()) {
    if (spec.paths.some((glob) => globMatch(glob, path))) stored[path] = workspace[path];
  }
  const key = `caches/${project.id}/${spec.key}`;
  try {
    await putObject(key, JSON.stringify(stored));
    await t.sql.query(
      `insert into caches (project_id, key, updated_ms, object_key) values ($1, $2, $3, $4)
       on conflict (project_id, key) do update set updated_ms = $3, object_key = $4`,
      [project.id, spec.key, nowMs(), key],
    );
    await appendLog(t, job, 'sys', `Cache saved: ${spec.key}`);
  } catch (error) {
    if (!(error instanceof StorageUnavailable)) throw error;
    await appendLog(t, job, 'sys', 'Cache skipped: file storage is unavailable.');
  }
}

const reportKinds = ['tests', 'coverage', 'quality', 'security'];

function validReport(kind: string, parsed: unknown): boolean {
  if (kind === 'tests') {
    return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { cases?: unknown }).cases);
  }
  if (kind === 'coverage') {
    return typeof parsed === 'object' && parsed !== null && typeof (parsed as { percent?: unknown }).percent === 'number';
  }
  return Array.isArray(parsed);
}

async function runCommand(t: Tx, project: ProjectRow, job: JobRow, command: string): Promise<'continue' | 'wait' | 'done' | 'failed'> {
  const [verb, ...rest] = command.trim().split(' ');
  const argument = rest.join(' ');
  if (verb === 'print') {
    await appendLog(t, job, 'out', argument);
    return 'continue';
  }
  if (verb === 'write') {
    const space = argument.indexOf(' ');
    const path = space === -1 ? argument : argument.slice(0, space);
    const content = space === -1 ? '' : argument.slice(space + 1);
    const row = await t.sql.one<{ workspace: Record<string, string> }>('select workspace from jobs where id = $1', [job.id]);
    const workspace = { ...(row?.workspace ?? {}), [path]: `${content}\n` };
    await t.sql.query('update jobs set workspace = $2 where id = $1', [job.id, JSON.stringify(workspace)]);
    await appendLog(t, job, 'sys', `Wrote ${path}`);
    return 'continue';
  }
  if (verb === 'wait') {
    await appendLog(t, job, 'sys', `Waiting ${argument} ms`);
    await t.sql.query('update jobs set wait_start_ms = $2, wait_ms = $3 where id = $1', [
      job.id,
      nowMs(),
      Number(argument),
    ]);
    return 'wait';
  }
  if (verb === 'exit') {
    const code = Number(argument);
    await appendLog(t, job, 'sys', `Exit code ${code}`);
    return code === 0 ? 'done' : 'failed';
  }
  if (verb === 'emit') {
    const [kind, path] = argument.split(' ');
    if (!reportKinds.includes(kind)) {
      await appendLog(t, job, 'sys', `Unknown command: ${command}`);
      return 'failed';
    }
    const row = await t.sql.one<{ workspace: Record<string, string> }>('select workspace from jobs where id = $1', [job.id]);
    const content = (row?.workspace ?? {})[path];
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(content ?? '');
    } catch {
      parsed = null;
    }
    if (content === undefined || !validReport(kind, parsed)) {
      await appendLog(t, job, 'sys', `Report ${path} is not valid ${kind} JSON.`);
      return 'failed';
    }
    try {
      const key = `reports/${job.id}/${kind}.json`;
      await putObject(key, content);
      await t.sql.query(
        `insert into reports (job_id, kind, data, object_key) values ($1, $2, $3, $4)
         on conflict (job_id, kind) do update set data = $3, object_key = $4`,
        [job.id, kind, JSON.stringify(parsed), key],
      );
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
    await appendLog(t, job, 'sys', `Stored ${kind} report from ${path}`);
    if (kind === 'security') {
      const { syncFindings } = await import('./reports');
      await syncFindings(t, project, job, parsed as { id: string; severity: string; title: string; path: string; line: number }[]);
    }
    return 'continue';
  }
  await appendLog(t, job, 'sys', `Unknown command: ${command}`);
  return 'failed';
}

async function completeScript(t: Tx, project: ProjectRow, job: JobRow, failed: boolean): Promise<void> {
  await appendLog(t, job, 'sys', 'section_end script');
  const status = failed ? 'failed' : 'success';
  const uploaded = await uploadArtifacts(t, job, status);
  await saveCache(t, project, job);
  if (!uploaded) {
    await finishJob(t, project, job, 'failed', 'system_failure');
    return;
  }
  await finishJob(t, project, job, status, failed ? 'script_failure' : null);
}

async function takeTurn(t: Tx, project: ProjectRow, jobId: number): Promise<boolean> {
  const job = await loadJob(t.sql, jobId);
  if (job === null || job.status !== 'running') return false;
  if (job.wait_start_ms !== null && job.wait_ms !== null) {
    if (nowMs() < job.wait_start_ms + job.wait_ms) return false;
    await t.sql.query('update jobs set wait_start_ms = null, wait_ms = null, script_index = script_index + 1 where id = $1', [
      job.id,
    ]);
    const after = await loadJob(t.sql, jobId);
    if (after !== null && after.script_index >= after.spec.script.length) {
      await completeScript(t, project, after, false);
    }
    return true;
  }
  const commands = job.spec.script_raw ?? job.spec.script;
  const raw = commands[job.script_index];
  if (raw === undefined) {
    await completeScript(t, project, job, false);
    return true;
  }
  const command = expandVariables(raw, jobVariables(job));
  const outcome = await runCommand(t, project, job, command);
  if (outcome === 'wait') return true;
  if (outcome === 'failed') {
    await appendLog(t, job, 'sys', 'section_end script');
    await uploadArtifacts(t, job, 'failed');
    await saveCache(t, project, job);
    await finishJob(t, project, job, 'failed', 'script_failure');
    return true;
  }
  await t.sql.query('update jobs set script_index = script_index + 1 where id = $1', [job.id]);
  if (outcome === 'done') {
    const after = await loadJob(t.sql, jobId);
    if (after !== null) await completeScript(t, project, after, false);
    return true;
  }
  const after = await loadJob(t.sql, jobId);
  if (after !== null && after.script_index >= commands.length) {
    await completeScript(t, project, after, false);
  }
  return true;
}

function countsAsFinishedForStage(job: JobRow): boolean {
  if (isFinished(job.status)) return true;
  return job.status === 'manual' && job.spec.allow_failure;
}

export async function settleStatuses(t: Tx, project: ProjectRow, pipelineId: number): Promise<boolean> {
  let changed = false;
  const jobs = await jobsOfPipeline(t.sql, pipelineId);
  const live = jobs.filter((job) => !job.retried);
  for (const job of live) {
    if (job.status !== 'created') continue;
    const deps =
      job.needs !== null
        ? live.filter((candidate) => (job.needs ?? []).includes(candidate.name))
        : live.filter((candidate) => candidate.stage_index < job.stage_index);
    const ready =
      job.needs !== null
        ? deps.every((candidate) => isFinished(candidate.status))
        : deps.every((candidate) => countsAsFinishedForStage(candidate));
    if (!ready) continue;
    const successful = deps.every((candidate) => ['success', 'warning', 'skipped'].includes(candidate.status));
    const anyFailed = deps.some((candidate) => ['failed', 'canceled'].includes(candidate.status));
    let next: string;
    if (job.spec.when === 'on_success') next = successful ? 'ready' : 'skipped';
    else if (job.spec.when === 'on_failure') next = anyFailed ? 'ready' : 'skipped';
    else next = 'ready';
    if (next === 'skipped') {
      await setStatus(t, job, 'skipped');
      changed = true;
      continue;
    }
    if (job.spec.when === 'manual') {
      await prepareDeployment(t, project, job);
      const reloaded = await loadJob(t.sql, job.id);
      if (reloaded !== null && reloaded.status === 'created') await setStatus(t, job, 'manual');
      changed = true;
      continue;
    }
    if (job.spec.when === 'delayed') {
      const startAt = nowMs() + (job.spec.start_in_ms ?? 0);
      await t.sql.query("update jobs set status = 'scheduled', start_at_ms = $2 where id = $1", [job.id, startAt]);
      await emit(t, project.id, 'job', {
        job_id: job.id,
        name: job.name,
        status: 'scheduled',
        start_at: new Date(startAt).toISOString(),
      });
      changed = true;
      continue;
    }
    await prepareDeployment(t, project, job);
    const reloaded = await loadJob(t.sql, job.id);
    if (reloaded !== null && reloaded.status === 'created') {
      await setStatus(t, job, 'pending');
    }
    changed = true;
  }
  const retryable = live.filter(
    (job) =>
      job.status === 'failed' &&
      !job.retried &&
      job.retry_count < job.spec.retry_max &&
      job.spec.retry_when.includes(job.failure_reason ?? 'script_failure'),
  );
  for (const job of retryable) {
    await t.sql.query('update jobs set retried = true where id = $1', [job.id]);
    await createAttempt(t, project, job, 'pending');
    changed = true;
  }
  const status = rollup(await jobsOfPipeline(t.sql, pipelineId));
  const pipeline = await loadPipeline(t.sql, pipelineId);
  if (pipeline !== null && pipeline.status !== status) {
    await t.sql.query('update pipelines set status = $2 where id = $1', [pipelineId, status]);
    const announcement = await pipelineAnnouncement(t.sql, pipelineId, status);
    await emit(t, project.id, 'pipeline', {
      pipeline_id: pipelineId,
      status,
      ref: pipeline.ref,
      ...(announcement === null ? {} : { announcement }),
    });
    if (['success', 'failed', 'canceled'].includes(status)) {
      await queueEvent(t, project, 'pipeline', {
        event: 'pipeline',
        project: { id: project.id, path: project.path },
        pipeline: { id: pipelineId, ref: pipeline.ref, sha: pipeline.sha, status, source: pipeline.source },
      });
      const { onPipelineFinished } = await import('./trainhooks');
      await onPipelineFinished(t, project, pipelineId, status);
    }
    changed = true;
  }
  return changed;
}

async function pipelineAnnouncement(sql: Sql, pipelineId: number, status: string): Promise<string | null> {
  if (status === 'success') return `Pipeline ${pipelineId} succeeded`;
  if (status === 'canceled') return `Pipeline ${pipelineId} was canceled`;
  if (status !== 'failed') return null;
  const jobs = await jobsOfPipeline(sql, pipelineId);
  const pipeline = await loadPipeline(sql, pipelineId);
  if (pipeline !== null && pipeline.errors.length > 0) return `Pipeline ${pipelineId} failed: config has errors`;
  const culprit = jobs
    .filter((job) => job.status === 'failed' && !job.retried && !job.spec.allow_failure)
    .sort((a, b) => a.config_order - b.config_order)[0];
  return culprit === undefined ? `Pipeline ${pipelineId} failed` : `Pipeline ${pipelineId} failed: job ${culprit.name}`;
}

export async function createAttempt(t: Tx, project: ProjectRow, job: JobRow, status: string): Promise<number> {
  const row = await t.sql.one<{ id: string }>(
    `insert into jobs (project_id, pipeline_id, name, stage, stage_index, config_order, status, attempt, spec,
                       variables, needs, layer, row_index, resource_group, retry_count, log, workspace)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '[]', '{}') returning id`,
    [
      project.id,
      job.pipeline_id,
      job.name,
      job.stage,
      job.stage_index,
      job.config_order,
      status,
      job.attempt + 1,
      JSON.stringify(job.spec),
      JSON.stringify(job.variables),
      job.needs === null ? null : JSON.stringify(job.needs),
      job.layer,
      job.row_index,
      job.resource_group,
      job.retry_count + 1,
    ],
  );
  const id = Number(row?.id);
  await emit(t, project.id, 'job', { job_id: id, name: job.name, status });
  return id;
}

async function prepareDeployment(t: Tx, project: ProjectRow, job: JobRow): Promise<void> {
  const spec = job.spec.environment;
  if (spec === null || spec.action !== 'start') return;
  if (job.deployment_id !== null) return;
  const environment = await ensureEnvironment(t, project, spec);
  const pipeline = await loadPipeline(t.sql, job.pipeline_id);
  if (pipeline === null) return;
  const deployer = job.variables.SPUR_DEPLOYER ?? 'system';
  const deployment = await createDeployment(t, project, environment, job, pipeline.sha, deployer);
  const protection = await protectionOf(t.sql, project.id, environment.name);
  if (protection !== null) {
    await t.sql.query("update jobs set status = 'manual', deployment_id = $2 where id = $1", [job.id, deployment.id]);
    await emit(t, project.id, 'job', { job_id: job.id, name: job.name, status: 'manual' });
  }
}

export async function runRound(t: Tx, project: ProjectRow): Promise<RoundResult> {
  let changed = false;
  const pipelines = await activePipelines(t.sql, project.id);

  for (const pipelineId of pipelines) {
    for (const job of await jobsOfPipeline(t.sql, pipelineId)) {
      if (job.status === 'scheduled' && job.start_at_ms !== null && job.start_at_ms <= nowMs()) {
        await setStatus(t, job, 'pending');
        changed = true;
      }
      if (job.status === 'running' && job.started_ms !== null && job.started_ms + job.spec.timeout_ms <= nowMs()) {
        await appendLog(t, job, 'sys', 'Job exceeded its time limit.');
        await finishJob(t, project, job, 'failed', 'job_timeout');
        changed = true;
      }
      if (job.status !== 'running' && !job.log_sealed && isFinished(job.status)) {
        await sealLog(t, job);
      }
    }
  }

  const runningRow = await t.sql.one<{ count: string }>(
    `select count(*)::text as count from jobs where project_id = $1 and status = 'running'`,
    [project.id],
  );
  let running = Number(runningRow?.count ?? '0');
  const startedNow: number[] = [];
  const pendingRows = await t.sql.query<JobRow>(
    `select j.id, j.project_id, j.pipeline_id, j.name, j.stage, j.stage_index, j.config_order, j.status, j.attempt,
            j.retried, j.failure_reason, j.spec, j.variables, j.needs, j.layer, j.row_index, j.started_ms,
            j.finished_ms, j.start_at_ms, j.script_index, j.wait_start_ms, j.wait_ms, j.log, j.log_sealed,
            j.workspace, j.retry_count, j.resource_group, j.deployment_id
     from jobs j where j.project_id = $1 and j.status = 'pending'
     order by j.pipeline_id, j.stage_index, j.config_order, j.id`,
    [project.id],
  );
  for (const pendingRow of pendingRows) {
    if (running >= config.parallelLimit) break;
    const job = normalizeJob(pendingRow);
    if (job.resource_group !== null) {
      const held = await t.sql.one<{ count: string }>(
        `select count(*)::text as count from jobs where project_id = $1 and resource_group = $2 and status = 'running'`,
        [project.id, job.resource_group],
      );
      if (Number(held?.count ?? '0') > 0) continue;
    }
    if (job.deployment_id !== null) {
      const deployment = await loadDeployment(t.sql, job.deployment_id);
      if (deployment !== null) {
        const current = await latestSuccessful(t.sql, deployment.environment_id);
        if (
          current !== null &&
          current.pipeline_id !== null &&
          deployment.pipeline_id !== null &&
          deployment.pipeline_id < current.pipeline_id
        ) {
          await appendLog(t, job, 'sys', `This deployment is outdated: deployment ${current.number} is newer.`);
          await setDeploymentStatus(t, project, deployment, 'failed', 'system');
          await finishJob(t, project, job, 'failed', 'outdated_deployment');
          changed = true;
          continue;
        }
        await setDeploymentStatus(t, project, deployment, 'running', 'system');
      }
    }
    await t.sql.query("update jobs set status = 'running', started_ms = $2 where id = $1", [job.id, nowMs()]);
    await emit(t, project.id, 'job', {
      job_id: job.id,
      name: job.name,
      status: 'running',
      announcement: `Job ${job.name} started`,
    });
    running += 1;
    changed = true;
    const started = await loadJob(t.sql, job.id);
    if (started !== null) {
      const ok = await startWork(t, project, started);
      if (ok) startedNow.push(job.id);
    }
  }

  const runningJobs = await t.sql.query<{ id: string }>(
    `select id from jobs where project_id = $1 and status = 'running' order by pipeline_id, stage_index, config_order, id`,
    [project.id],
  );
  for (const row of runningJobs) {
    const turned = await takeTurn(t, project, Number(row.id));
    if (turned) changed = true;
  }

  for (const pipelineId of await activePipelines(t.sql, project.id)) {
    const settled = await settleStatuses(t, project, pipelineId);
    if (settled) changed = true;
  }

  const jobs = await t.sql.query<{ id: string; name: string; status: string }>(
    'select id, name, status from jobs where project_id = $1 order by id',
    [project.id],
  );
  return {
    changed,
    jobs: jobs.map((row) => ({ id: Number(row.id), name: row.name, status: row.status })),
  };
}

export async function runRounds(t: Tx, projectId: number, count: number): Promise<RoundResult> {
  const project = await loadProject(t.sql, projectId);
  if (project === null) throw new Error('project is missing');
  let last: RoundResult = { changed: false, jobs: [] };
  for (let index = 0; index < count; index += 1) {
    last = await runRound(t, project);
  }
  return last;
}

export async function settle(t: Tx, projectId: number): Promise<{ rounds: number; result: RoundResult }> {
  const project = await loadProject(t.sql, projectId);
  if (project === null) throw new Error('project is missing');
  let rounds = 0;
  let last: RoundResult = { changed: false, jobs: [] };
  for (let index = 0; index < 500; index += 1) {
    last = await runRound(t, project);
    rounds += 1;
    if (!last.changed) break;
  }
  return { rounds, result: last };
}

export async function playJob(t: Tx, project: ProjectRow, job: JobRow, actor: string, variables: Record<string, string>): Promise<void> {
  await t.sql.query('update jobs set status = $2, variables = variables || $3::jsonb where id = $1', [
    job.id,
    'pending',
    JSON.stringify({ ...variables, SPUR_DEPLOYER: actor }),
  ]);
  await emit(t, project.id, 'job', { job_id: job.id, name: job.name, status: 'pending' });
  await settleStatuses(t, project, job.pipeline_id);
}

export async function retryJob(t: Tx, project: ProjectRow, job: JobRow, actor: string): Promise<number> {
  await t.sql.query('update jobs set retried = true where id = $1', [job.id]);
  const id = await createAttempt(t, project, job, 'pending');
  await settleStatuses(t, project, job.pipeline_id);
  return id;
}

export async function cancelJob(t: Tx, project: ProjectRow, job: JobRow): Promise<void> {
  if (isFinished(job.status)) return;
  await finishJob(t, project, job, 'canceled', 'canceled');
  await settleStatuses(t, project, job.pipeline_id);
}

export async function retryPipeline(t: Tx, project: ProjectRow, pipelineId: number): Promise<void> {
  const jobs = await jobsOfPipeline(t.sql, pipelineId);
  for (const job of jobs) {
    if (job.retried) continue;
    if (job.status === 'failed' || job.status === 'canceled') {
      await t.sql.query('update jobs set retried = true where id = $1', [job.id]);
      await createAttempt(t, project, job, 'pending');
    } else if (job.status === 'skipped') {
      await setStatus(t, job, 'created');
    }
  }
  await settleStatuses(t, project, pipelineId);
}

export async function cancelPipeline(t: Tx, project: ProjectRow, pipelineId: number): Promise<void> {
  const jobs = await jobsOfPipeline(t.sql, pipelineId);
  for (const job of jobs) {
    if (isFinished(job.status)) continue;
    await finishJob(t, project, job, 'canceled', 'canceled');
  }
  await t.sql.query("update pipelines set status = 'canceled' where id = $1", [pipelineId]);
  await emit(t, project.id, 'pipeline', {
    pipeline_id: pipelineId,
    status: 'canceled',
    announcement: `Pipeline ${pipelineId} was canceled`,
  });
}
