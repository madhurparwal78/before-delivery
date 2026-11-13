import { Access, ProjectRow, levelOf, writeAudit } from './access';
import { nowMs } from './clock';
import { config } from './config';
import { Sql } from './db';
import { ApiError, errors } from './errors';
import { Tx, emit } from './live';
import { EnvironmentSpec } from './ciconfig';
import { ancestors, findCommit } from './repo';
import { headObject } from './storage';
import { failJob } from './runner';
import { queueEvent } from './webhooks';

export type EnvironmentRow = {
  id: number;
  project_id: number;
  name: string;
  tier: string;
  state: string;
  auto_stop_ms: number | null;
  on_stop: string | null;
};

export type DeploymentRow = {
  id: number;
  environment_id: number;
  number: number;
  status: string;
  sha: string;
  pipeline_id: number | null;
  job_id: number | null;
  deployer: string | null;
  required: number;
  artifact_keys: string[];
  created_ms: number;
  finished_ms: number | null;
};

export async function loadEnvironment(sql: Sql, id: number): Promise<EnvironmentRow | null> {
  const row = await sql.one<EnvironmentRow>(
    'select id, project_id, name, tier, state, auto_stop_ms, on_stop from environments where id = $1',
    [id],
  );
  return row === null
    ? null
    : {
        ...row,
        id: Number(row.id),
        project_id: Number(row.project_id),
        auto_stop_ms: row.auto_stop_ms === null ? null : Number(row.auto_stop_ms),
      };
}

export async function ensureEnvironment(
  t: Tx,
  project: ProjectRow,
  spec: EnvironmentSpec,
): Promise<EnvironmentRow> {
  const existing = await t.sql.one<{ id: string }>(
    'select id from environments where project_id = $1 and name = $2',
    [project.id, spec.name],
  );
  if (existing !== null) {
    const environment = await loadEnvironment(t.sql, Number(existing.id));
    if (environment !== null) return environment;
  }
  const row = await t.sql.one<{ id: string }>(
    `insert into environments (project_id, name, tier, state, on_stop) values ($1, $2, $3, 'available', $4)
     returning id`,
    [project.id, spec.name, spec.tier, spec.on_stop],
  );
  const environment = await loadEnvironment(t.sql, Number(row?.id));
  if (environment === null) throw errors.notFound();
  await emit(t, project.id, 'environment', { environment_id: environment.id, name: environment.name });
  return environment;
}

export async function protectionOf(
  sql: Sql,
  projectId: number,
  name: string,
): Promise<{ roles: string; approvals: number } | null> {
  const row = await sql.one<{ roles: string; approvals: number }>(
    'select roles, approvals from protected_environments where project_id = $1 and name = $2',
    [projectId, name],
  );
  return row === null ? null : { roles: row.roles, approvals: Number(row.approvals) };
}

export async function latestSuccessful(sql: Sql, environmentId: number): Promise<DeploymentRow | null> {
  const row = await sql.one<DeploymentRow>(
    `select id, environment_id, number, status, sha, pipeline_id, job_id, deployer, required, artifact_keys,
            created_ms, finished_ms
     from deployments where environment_id = $1 and status = 'success' order by number desc limit 1`,
    [environmentId],
  );
  return row === null ? null : normalizeDeployment(row);
}

export function normalizeDeployment(row: DeploymentRow): DeploymentRow {
  return {
    ...row,
    id: Number(row.id),
    environment_id: Number(row.environment_id),
    number: Number(row.number),
    pipeline_id: row.pipeline_id === null ? null : Number(row.pipeline_id),
    job_id: row.job_id === null ? null : Number(row.job_id),
    required: Number(row.required),
    created_ms: Number(row.created_ms),
    finished_ms: row.finished_ms === null ? null : Number(row.finished_ms),
  };
}

export async function loadDeployment(sql: Sql, id: number): Promise<DeploymentRow | null> {
  const row = await sql.one<DeploymentRow>(
    `select id, environment_id, number, status, sha, pipeline_id, job_id, deployer, required, artifact_keys,
            created_ms, finished_ms
     from deployments where id = $1`,
    [id],
  );
  return row === null ? null : normalizeDeployment(row);
}

export async function setDeploymentStatus(
  t: Tx,
  project: ProjectRow,
  deployment: DeploymentRow,
  status: string,
  actor: string,
): Promise<DeploymentRow> {
  const environment = await loadEnvironment(t.sql, deployment.environment_id);
  if (environment === null) throw errors.notFound();
  const finished = ['success', 'failed', 'canceled', 'rolled_back'].includes(status) ? nowMs() : null;
  await t.sql.query('update deployments set status = $2, finished_ms = coalesce($3, finished_ms) where id = $1', [
    deployment.id,
    status,
    finished,
  ]);
  await writeAudit(
    t,
    { projectId: project.id },
    actor,
    'deployment.status',
    `${project.path}:${environment.name}#${deployment.number}`,
    { status: deployment.status },
    { status },
  );
  await emit(t, project.id, 'deployment', {
    deployment_id: deployment.id,
    environment_id: environment.id,
    number: deployment.number,
    status,
  });
  await queueEvent(t, project, 'deployment', {
    event: 'deployment',
    project: { id: project.id, path: project.path },
    deployment: { environment: environment.name, number: deployment.number, status, sha: deployment.sha },
  });
  const updated = await loadDeployment(t.sql, deployment.id);
  if (updated === null) throw errors.notFound();
  return updated;
}

export async function createDeployment(
  t: Tx,
  project: ProjectRow,
  environment: EnvironmentRow,
  job: { id: number; pipeline_id: number },
  sha: string,
  deployer: string,
): Promise<DeploymentRow> {
  const last = await t.sql.one<{ number: number }>(
    'select coalesce(max(number), 0) as number from deployments where environment_id = $1',
    [environment.id],
  );
  const number = Number(last?.number ?? 0) + 1;
  const protection = await protectionOf(t.sql, project.id, environment.name);
  const status = protection === null ? 'created' : 'awaiting_approval';
  const row = await t.sql.one<{ id: string }>(
    `insert into deployments (environment_id, number, status, sha, pipeline_id, job_id, deployer, required, created_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      environment.id,
      number,
      status,
      sha,
      job.pipeline_id,
      job.id,
      deployer,
      protection === null ? 0 : protection.approvals,
      nowMs(),
    ],
  );
  const deployment = await loadDeployment(t.sql, Number(row?.id));
  if (deployment === null) throw errors.notFound();
  await t.sql.query('update jobs set deployment_id = $2 where id = $1', [job.id, deployment.id]);
  await writeAudit(
    t,
    { projectId: project.id },
    deployer,
    'deployment.status',
    `${project.path}:${environment.name}#${number}`,
    null,
    { status },
  );
  await emit(t, project.id, 'deployment', {
    deployment_id: deployment.id,
    environment_id: environment.id,
    number,
    status,
  });
  await queueEvent(t, project, 'deployment', {
    event: 'deployment',
    project: { id: project.id, path: project.path },
    deployment: { environment: environment.name, number, status, sha },
  });
  return deployment;
}

export type ApprovalRow = { username: string; status: string; granted_ms: number };

export async function approvalsOf(sql: Sql, deploymentId: number): Promise<ApprovalRow[]> {
  const rows = await sql.query<ApprovalRow>(
    'select username, status, granted_ms from deployment_approvals where deployment_id = $1 order by id',
    [deploymentId],
  );
  return rows.map((row) => ({ ...row, granted_ms: Number(row.granted_ms) }));
}

export function approvalExpired(approval: ApprovalRow): boolean {
  return approval.granted_ms + config.deployApprovalMs <= nowMs();
}

export async function countedApprovals(sql: Sql, deploymentId: number): Promise<number> {
  const rows = await approvalsOf(sql, deploymentId);
  return rows.filter((row) => row.status === 'approved' && !approvalExpired(row)).length;
}

export async function recordApproval(
  t: Tx,
  project: ProjectRow,
  deployment: DeploymentRow,
  access: Access,
  username: string,
  status: 'approved' | 'rejected',
): Promise<{ deployment: DeploymentRow; counted: number; required: number }> {
  const environment = await loadEnvironment(t.sql, deployment.environment_id);
  if (environment === null) throw errors.notFound();
  const protection = await protectionOf(t.sql, project.id, environment.name);
  if (deployment.deployer === username) {
    throw new ApiError(403, 'self_approval', "You can't approve your own deployment.");
  }
  const allowed =
    protection === null
      ? true
      : access.level >= levelOf(protection.roles) || access.permissions.includes('manage_environments');
  if (!allowed) {
    throw new ApiError(403, 'forbidden', `You aren't allowed to approve deployments to ${environment.name}.`);
  }
  if (deployment.status !== 'awaiting_approval') {
    throw errors.conflict('not_awaiting', "This deployment isn't waiting for approval.");
  }
  const existing = await approvalsOf(t.sql, deployment.id);
  if (existing.some((row) => row.username === username)) {
    throw errors.conflict('already_approved', 'You already approved this deployment.');
  }
  await t.sql.query(
    'insert into deployment_approvals (deployment_id, username, status, granted_ms) values ($1, $2, $3, $4)',
    [deployment.id, username, status, nowMs()],
  );
  await writeAudit(
    t,
    { projectId: project.id },
    username,
    'deployment.approval',
    `${project.path}:${environment.name}#${deployment.number}`,
    null,
    { user: username, status },
  );
  if (status === 'rejected') {
    const canceled = await setDeploymentStatus(t, project, deployment, 'canceled', username);
    if (deployment.job_id !== null) {
      await failJob(t, project, deployment.job_id, 'canceled', `Deployment rejected by ${username}.`);
    }
    return { deployment: canceled, counted: 0, required: deployment.required };
  }
  const counted = await countedApprovals(t.sql, deployment.id);
  let updated = deployment;
  if (counted >= deployment.required) {
    updated = await setDeploymentStatus(t, project, deployment, 'approved', username);
    if (deployment.job_id !== null) {
      await t.sql.query("update jobs set status = 'pending' where id = $1 and status = 'manual'", [deployment.job_id]);
      await emit(t, project.id, 'job', { job_id: deployment.job_id, status: 'pending' });
    }
  } else {
    await emit(t, project.id, 'deployment', {
      deployment_id: deployment.id,
      environment_id: environment.id,
      number: deployment.number,
      status: deployment.status,
      announcement: `Deployment approval recorded: ${counted} of ${deployment.required}.`,
    });
  }
  return { deployment: updated, counted, required: deployment.required };
}

export async function stopEnvironment(t: Tx, project: ProjectRow, environment: EnvironmentRow, actor: string): Promise<void> {
  if (environment.on_stop !== null) {
    const row = await t.sql.one<{ id: string }>(
      `select j.id from jobs j join pipelines p on p.id = j.pipeline_id
       where j.project_id = $1 and j.name = $2 order by j.id desc limit 1`,
      [project.id, environment.on_stop],
    );
    if (row !== null) {
      await t.sql.query("update jobs set status = 'pending' where id = $1", [Number(row.id)]);
      await t.sql.query("update environments set state = 'stopping', auto_stop_ms = null where id = $1", [environment.id]);
      await emit(t, project.id, 'environment', {
        environment_id: environment.id,
        name: environment.name,
        state: 'stopping',
      });
      return;
    }
  }
  await t.sql.query("update environments set state = 'stopped', auto_stop_ms = null where id = $1", [environment.id]);
  await emit(t, project.id, 'environment', { environment_id: environment.id, name: environment.name, state: 'stopped' });
}

export async function keepEnvironment(t: Tx, project: ProjectRow, environment: EnvironmentRow): Promise<void> {
  await t.sql.query('update environments set auto_stop_ms = null where id = $1', [environment.id]);
  await emit(t, project.id, 'environment', { environment_id: environment.id, name: environment.name, kept: true });
}

export async function rollback(
  t: Tx,
  project: ProjectRow,
  environment: EnvironmentRow,
  number: number,
  actor: string,
): Promise<DeploymentRow> {
  const target = await t.sql.one<DeploymentRow>(
    `select id, environment_id, number, status, sha, pipeline_id, job_id, deployer, required, artifact_keys,
            created_ms, finished_ms
     from deployments where environment_id = $1 and number = $2`,
    [environment.id, number],
  );
  if (target === null) throw errors.notFound();
  const source = normalizeDeployment(target);
  if (source.artifact_keys.length === 0) {
    throw errors.conflict('artifact_gone', `Can't roll back: deployment ${number} has no artifact.`);
  }
  for (const key of source.artifact_keys) {
    const present = await headObject(key);
    if (!present) {
      throw errors.conflict('artifact_gone', "Can't roll back: its artifact has expired.");
    }
  }
  const current = await latestSuccessful(t.sql, environment.id);
  const last = await t.sql.one<{ number: number }>(
    'select coalesce(max(number), 0) as number from deployments where environment_id = $1',
    [environment.id],
  );
  const nextNumber = Number(last?.number ?? 0) + 1;
  const row = await t.sql.one<{ id: string }>(
    `insert into deployments (environment_id, number, status, sha, pipeline_id, job_id, deployer, required,
                              artifact_keys, created_ms, finished_ms)
     values ($1, $2, 'success', $3, $4, $5, $6, 0, $7, $8, $8) returning id`,
    [
      environment.id,
      nextNumber,
      source.sha,
      source.pipeline_id,
      source.job_id,
      actor,
      JSON.stringify(source.artifact_keys),
      nowMs(),
    ],
  );
  const created = await loadDeployment(t.sql, Number(row?.id));
  if (created === null) throw errors.notFound();
  await writeAudit(
    t,
    { projectId: project.id },
    actor,
    'deployment.status',
    `${project.path}:${environment.name}#${nextNumber}`,
    null,
    { status: 'success' },
  );
  if (current !== null) {
    await setDeploymentStatus(t, project, current, 'rolled_back', actor);
  }
  await emit(t, project.id, 'deployment', {
    deployment_id: created.id,
    environment_id: environment.id,
    number: nextNumber,
    status: 'success',
  });
  await queueEvent(t, project, 'deployment', {
    event: 'deployment',
    project: { id: project.id, path: project.path },
    deployment: { environment: environment.name, number: nextNumber, status: 'success', sha: source.sha },
  });
  return created;
}

function dayKey(ms: number, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function assertZone(zone: string): void {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(new Date());
  } catch {
    throw errors.validation('zone', `Unknown time zone ${zone}.`);
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : sorted[sorted.length / 2 - 1];
  return middle;
}

export type Metrics = {
  deployment_frequency: number | null;
  lead_time_hours: number | null;
  change_failure_rate: number | null;
  recovery_time_hours: number | null;
};

export async function metrics(sql: Sql, project: ProjectRow, zone: string, days: number): Promise<Metrics> {
  assertZone(zone);
  const environments = await sql.query<{ id: string }>(
    "select id from environments where project_id = $1 and tier = 'production'",
    [project.id],
  );
  const ids = environments.map((row) => Number(row.id));
  if (ids.length === 0) {
    return { deployment_frequency: 0, lead_time_hours: null, change_failure_rate: null, recovery_time_hours: null };
  }
  const rows = await sql.query<DeploymentRow>(
    `select id, environment_id, number, status, sha, pipeline_id, job_id, deployer, required, artifact_keys,
            created_ms, finished_ms
     from deployments where environment_id = any($1) order by finished_ms, number`,
    [ids],
  );
  const all = rows.map(normalizeDeployment);
  const todayKey = dayKey(nowMs(), zone);
  const cutoffKeys = new Set<string>();
  for (let offset = 0; offset < days; offset += 1) {
    cutoffKeys.add(dayKey(nowMs() - offset * 86400000, zone));
  }
  const inRange = all.filter(
    (deployment) => deployment.finished_ms !== null && cutoffKeys.has(dayKey(deployment.finished_ms, zone)),
  );
  const successes = inRange.filter((deployment) => deployment.status === 'success' || deployment.status === 'rolled_back');
  const frequency = Number((successes.length / days).toFixed(2));

  const leadTimes: number[] = [];
  const seenRequests = new Set<number>();
  for (const deployment of successes) {
    const reachable = await ancestors(sql, project.id, deployment.sha);
    const merged = await sql.query<{ id: string; merge_commit: string | null }>(
      "select id, merge_commit from merge_requests where project_id = $1 and state = 'merged' order by iid",
      [project.id],
    );
    for (const request of merged) {
      const id = Number(request.id);
      if (seenRequests.has(id)) continue;
      if (request.merge_commit === null || !reachable.has(request.merge_commit)) continue;
      seenRequests.add(id);
      const commit = await findCommit(sql, project.id, request.merge_commit);
      if (commit === null) continue;
      const sourceHead = commit.parents[1] ?? commit.parents[0] ?? null;
      if (sourceHead === null) continue;
      const targetBase = commit.parents[0] ?? null;
      const sourceReach = await ancestors(sql, project.id, sourceHead);
      const baseReach = targetBase === null ? new Set<string>() : await ancestors(sql, project.id, targetBase);
      let earliest: number | null = null;
      for (const id2 of sourceReach) {
        if (baseReach.has(id2)) continue;
        const candidate = await findCommit(sql, project.id, id2);
        if (candidate === null) continue;
        if (earliest === null || candidate.authored_at * 1000 < earliest) earliest = candidate.authored_at * 1000;
      }
      if (earliest === null || deployment.finished_ms === null) continue;
      leadTimes.push((deployment.finished_ms - earliest) / 3600000);
    }
  }
  const lead = median(leadTimes);

  let failures = 0;
  for (const [index, deployment] of inRange.entries()) {
    if (deployment.status === 'rolled_back') {
      failures += 1;
      continue;
    }
    if (deployment.status !== 'success') continue;
    for (let next = index + 1; next < inRange.length; next += 1) {
      const candidate = inRange[next];
      if (candidate.status === 'success') break;
      if (candidate.status === 'failed') {
        failures += 1;
        break;
      }
    }
  }
  const rate = inRange.length === 0 ? null : Number(((failures / inRange.length) * 100).toFixed(1));

  const recoveries: number[] = [];
  for (const [index, deployment] of all.entries()) {
    if (deployment.status !== 'failed' || deployment.finished_ms === null) continue;
    for (let next = index + 1; next < all.length; next += 1) {
      const candidate = all[next];
      if (candidate.status === 'success' && candidate.finished_ms !== null) {
        recoveries.push((candidate.finished_ms - deployment.finished_ms) / 3600000);
        break;
      }
    }
  }
  const recovery = median(recoveries);
  return {
    deployment_frequency: frequency,
    lead_time_hours: lead === null ? null : Number(lead.toFixed(2)),
    change_failure_rate: rate,
    recovery_time_hours: recovery === null ? null : Number(recovery.toFixed(2)),
  };
}

export function metricTexts(values: Metrics): string[] {
  return [
    `Deployment frequency ${(values.deployment_frequency ?? 0).toFixed(2)} per day`,
    values.lead_time_hours === null ? 'Lead time No data' : `Lead time ${values.lead_time_hours.toFixed(2)} hours`,
    values.change_failure_rate === null
      ? 'Change failure rate 0.0%'
      : `Change failure rate ${values.change_failure_rate.toFixed(1)}%`,
    values.recovery_time_hours === null
      ? 'Recovery time No failures'
      : `Recovery time ${values.recovery_time_hours.toFixed(2)} hours`,
  ];
}
