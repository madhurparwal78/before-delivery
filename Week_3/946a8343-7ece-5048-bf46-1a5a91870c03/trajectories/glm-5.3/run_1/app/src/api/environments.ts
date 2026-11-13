import { AppError } from '../core/errors.js';
import type { RequestCtx } from './ctx.js';
import { requireBody } from './ctx.js';
import * as errs from './errors.js';
import { loadProject, requireMinRole, requireReadCode, writeAudit } from './common.js';
import { hasPermission, ROLE_LEVEL, type Role } from '../domain/access.js';
import { ianaZoneOk, zoneTime, dayFloor, median, isoFull } from '../core/util.js';

export async function listEnvironments(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const envs = (await client.query(`SELECT id, name, tier, state, auto_stop_at, current_number FROM environments WHERE project_id = $1 ORDER BY id`, [id])).rows;
    const out = [];
    for (const e of envs) {
      const deployments = await deploymentsOf(rc, client, e.id);
      out.push({ id: e.id, name: e.name, tier: e.tier, state: e.state, auto_stop_at: e.auto_stop_at, deployments });
    }
    return { environments: out, now: rc.ctx.now() };
  } finally {
    client.release();
  }
}

async function deploymentsOf(rc: RequestCtx, c: import('pg').PoolClient, envId: number): Promise<unknown[]> {
  const rows = (await c.query(`SELECT id, number, status, sha, pipeline_id, created_at, finished_at, rolled_back FROM deployments WHERE environment_id = $1 ORDER BY number DESC`, [envId])).rows;
  const out = [];
  for (const d of rows) {
    const approvals = (await c.query<{ user: string; status: string; granted_at: number; expires_at: number | null }>(
      `SELECT u.username AS user, da.status, da.granted_at, da.expires_at FROM deployment_approvals da JOIN users u ON u.id = da.user_id WHERE da.deployment_id = $1 ORDER BY da.id`, [d.id])).rows;
    const now = rc.ctx.now();
    const prot = (await c.query<{ approvals: number }>(`SELECT pe.approvals FROM deployments d2 JOIN environments e ON e.id = d2.environment_id JOIN protected_environments pe ON pe.project_id = e.project_id AND pe.name = e.name WHERE d2.id = $1`, [d.id])).rows[0];
    out.push({
      id: d.id,
      number: d.number,
      status: d.status,
      sha: d.sha,
      pipeline_id: d.pipeline_id,
      approvals: approvals.map((a) => ({
        user: a.user,
        status: a.status,
        granted_at: a.granted_at,
        expires_at: a.expires_at,
        expired: a.expires_at !== null && a.expires_at < now,
      })),
      required: prot?.approvals ?? 0,
      created_at: d.created_at,
      finished_at: d.finished_at,
      rolled_back: d.rolled_back,
    });
  }
  return out;
}

export async function getEnvironment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const eid = Number(rc.params.eid);
  const client = await rc.ctx.db.pool.connect();
  try {
    const env = (await client.query(`SELECT id, project_id, name, tier, state, auto_stop_at, current_number FROM environments WHERE id = $1`, [eid])).rows[0];
    if (!env) throw errs.notFound();
    const { access } = await loadProject(client, rc.ctx, env.project_id, rc.user.id);
    requireReadCode(access);
    const prot = (await client.query<{ roles: string; approvals: number }>(`SELECT roles, approvals FROM protected_environments WHERE project_id = $1 AND name = $2`, [env.project_id, env.name])).rows[0];
    const deployments = await deploymentsOf(rc, client, eid);
    return { id: env.id, name: env.name, tier: env.tier, state: env.state, auto_stop_at: env.auto_stop_at, protected: prot ?? null, deployments, now: rc.ctx.now() };
  } finally {
    client.release();
  }
}

export async function approveDeployment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const depId = Number(rc.params.deployment_id);
  const body = requireBody(rc);
  const status = typeof body.status === 'string' ? body.status : 'approved';
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const dep = (await client.query<{ id: number; environment_id: number; number: number; status: string; job_id: number | null; pipeline_id: number | null }>(
      `SELECT id, environment_id, number, status, job_id, pipeline_id FROM deployments WHERE id = $1`, [depId])).rows[0];
    if (!dep) throw errs.notFound();
    const env = (await client.query<{ project_id: number; name: string }>(`SELECT project_id, name FROM environments WHERE id = $1`, [dep.environment_id])).rows[0];
    if (!env) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, id, rc.user.id);
    const prot = (await client.query<{ roles: string; approvals: number }>(`SELECT roles, approvals FROM protected_environments WHERE project_id = $1 AND name = $2`, [id, env.name])).rows[0];
    if (status === 'approved') {
      if (prot) {
        const job = dep.job_id ? (await client.query<{ started_by: number | null }>(`SELECT started_by FROM jobs WHERE id = $1`, [dep.job_id])).rows[0] : null;
        if (job && job.started_by === rc.user.id) {
          throw new AppError(403, 'self_approval', "You can't approve your own deployment.");
        }
        const min = prot.roles as Role;
        if (access.level < ROLE_LEVEL[min] && !hasPermission(access, 'approve')) {
          throw new AppError(403, 'forbidden', `You aren't allowed to approve deployments to ${env.name}.`);
        }
      }
      if (dep.status !== 'awaiting_approval') {
        throw new AppError(409, 'not_awaiting', "This deployment isn't waiting for approval.");
      }
      const existing = (await client.query<{ id: number }>(`SELECT id FROM deployment_approvals WHERE deployment_id = $1 AND user_id = $2 AND status = 'approved'`, [depId, rc.user.id])).rows[0];
      if (existing) throw new AppError(409, 'already_approved', 'You already approved this deployment.');
      const now = rc.ctx.now();
      await client.query(`INSERT INTO deployment_approvals (deployment_id, user_id, status, granted_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [depId, rc.user.id, status, now, now + rc.ctx.settings.deployApprovalMs]);
      await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'deployment.approval', target: `${project.path}:${env.name}#${dep.number}`, before: null, after: { user: rc.user.username, status: 'approved' }, at: now });
      // count valid approvals
      const valid = (await client.query<{ n: string }>(`SELECT count(*) AS n FROM deployment_approvals WHERE deployment_id = $1 AND status = 'approved' AND (expires_at IS NULL OR expires_at >= $2)`, [depId, now])).rows[0];
      const have = Number(valid?.n ?? 0);
      if (prot && have >= prot.approvals) {
        await client.query(`UPDATE deployments SET status = 'approved' WHERE id = $1`, [depId]);
        await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'deployment.status', target: `${project.path}:${env.name}#${dep.number}`, before: { status: 'awaiting_approval' }, after: { status: 'approved' }, at: now });
        if (dep.job_id) {
          await client.query(`UPDATE jobs SET status = 'pending' WHERE id = $1 AND status = 'manual'`, [dep.job_id]);
        }
      }
      const seq = await rc.ctx.live(client, id, 'deployment', { environment: env.name, number: dep.number, status: 'approved', approvals: have, required: prot?.approvals ?? 0 });
      await client.query('COMMIT');
      return { approvals: have, required: prot?.approvals ?? 0, seq };
    }
    // rejected
    if (dep.status !== 'awaiting_approval') {
      throw new AppError(409, 'not_awaiting', "This deployment isn't waiting for approval.");
    }
    const now = rc.ctx.now();
    await client.query(`INSERT INTO deployment_approvals (deployment_id, user_id, status, granted_at, expires_at) VALUES ($1, $2, 'rejected', $3, NULL)`, [depId, rc.user.id, now]);
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'deployment.approval', target: `${project.path}:${env.name}#${dep.number}`, before: null, after: { user: rc.user.username, status: 'rejected' }, at: now });
    await client.query(`UPDATE deployments SET status = 'canceled', finished_at = $2 WHERE id = $1`, [depId, now]);
    await writeAudit(client, { projectId: id, groupId: project.group_id, actor: rc.user.username, action: 'deployment.status', target: `${project.path}:${env.name}#${dep.number}`, before: { status: 'awaiting_approval' }, after: { status: 'canceled' }, at: now });
    if (dep.job_id) {
      await client.query(`UPDATE jobs SET status = 'canceled', failure_reason = $3, finished_at = $2 WHERE id = $1`, [dep.job_id, now, `Deployment rejected by ${rc.user.username}.`]);
      const maxN = (await client.query<{ n: number }>(`SELECT COALESCE(max(n), 0) AS n FROM job_log_lines WHERE job_id = $1`, [dep.job_id])).rows[0];
      await client.query(`INSERT INTO job_log_lines (job_id, n, stream, text) VALUES ($1, $2, 'sys', $3)`, [dep.job_id, Number(maxN?.n ?? 0) + 1, `Deployment rejected by ${rc.user.username}.`]);
      const maxN2 = (await client.query<{ n: number }>(`SELECT COALESCE(max(n), 0) AS n FROM job_log_lines WHERE job_id = $1`, [dep.job_id])).rows[0];
      await client.query(`INSERT INTO job_log_lines (job_id, n, stream, text) VALUES ($1, $2, 'sys', $3)`, [dep.job_id, Number(maxN2?.n ?? 0) + 1, 'Job finished: canceled']);
    }
    const seq = await rc.ctx.live(client, id, 'deployment', { environment: env.name, number: dep.number, status: 'canceled' });
    await client.query('COMMIT');
    return { status: 'canceled', seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function stopEnvironment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return envStopOrKeep(rc, 'stop');
}

export async function keepEnvironment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  return envStopOrKeep(rc, 'keep');
}

async function envStopOrKeep(rc: RequestCtx, action: 'stop' | 'keep'): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const eid = Number(rc.params.eid);
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const env = (await client.query(`SELECT id, project_id, name FROM environments WHERE id = $1`, [eid])).rows[0];
    if (!env) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, env.project_id, rc.user.id);
    if (!hasPermission(access, 'manage_environments')) requireMinRole(access, 'maintainer');
    const now = rc.ctx.now();
    if (action === 'keep') {
      await client.query(`UPDATE environments SET auto_stop_at = NULL WHERE id = $1`, [eid]);
      const seq = await rc.ctx.live(client, env.project_id, 'environment', { id: eid, event: 'kept' });
      await client.query('COMMIT');
      return { seq };
    }
    // stop: run on_stop job if configured
    const job = (await client.query<{ id: number; config: Record<string, unknown> }>(`SELECT id, config FROM jobs WHERE environment_id = $1 AND config->>'env_action' = 'stop' ORDER BY id DESC LIMIT 1`, [eid])).rows[0];
    await client.query(`UPDATE environments SET state = 'stopping', auto_stop_at = NULL WHERE id = $1`, [eid]);
    if (job) {
      await client.query(`UPDATE jobs SET status = 'pending' WHERE id = $1`, [job.id]);
    } else {
      await client.query(`UPDATE environments SET state = 'stopped' WHERE id = $1`, [eid]);
    }
    const seq = await rc.ctx.live(client, env.project_id, 'environment', { id: eid, event: 'stopping' });
    await client.query('COMMIT');
    return { seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function rollbackDeployment(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const eid = Number(rc.params.eid);
  const body = requireBody(rc);
  const number = typeof body.deployment === 'number' ? body.deployment : null;
  if (number === null) throw errs.validation({ deployment: "Deployment can't be blank." });
  const client = await rc.ctx.db.pool.connect();
  try {
    await client.query('BEGIN');
    const env = (await client.query(`SELECT id, project_id, name, current_number FROM environments WHERE id = $1`, [eid])).rows[0];
    if (!env) throw errs.notFound();
    const { project, access } = await loadProject(client, rc.ctx, env.project_id, rc.user.id);
    if (!hasPermission(access, 'manage_environments')) requireMinRole(access, 'maintainer');
    const source = (await client.query(`SELECT id, sha, job_id FROM deployments WHERE environment_id = $1 AND number = $2`, [eid, number])).rows[0];
    if (!source) throw errs.notFound();
    const artifacts = (await client.query<{ path: string; object_key: string; size: number }>(`SELECT path, object_key, size FROM deploy_artifacts WHERE deployment_id = $1`, [source.id])).rows;
    if (artifacts.length === 0) {
      throw new AppError(409, 'artifact_gone', `Can't roll back: deployment ${number} has no artifact.`);
    }
    for (const a of artifacts) {
      const size = await rc.ctx.storage.tryHead(a.object_key);
      if (size === null) {
        throw new AppError(409, 'artifact_gone', "Can't roll back: its artifact has expired.");
      }
    }
    const now = rc.ctx.now();
    // mark current rolled back
    await client.query(`UPDATE deployments SET rolled_back = true WHERE environment_id = $1 AND number = $2`, [eid, env.current_number]);
    const newNumber = env.current_number + 1;
    const r = await client.query<{ id: number }>(`INSERT INTO deployments (environment_id, number, status, sha, pipeline_id, job_id, created_at, finished_at, rolled_back) VALUES ($1, $2, 'success', $3, NULL, NULL, $4, $4, false) RETURNING id`,
      [eid, newNumber, source.sha, now]);
    for (const a of artifacts) {
      await client.query(`INSERT INTO deploy_artifacts (deployment_id, path, object_key, size) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [r.rows[0].id, a.path, a.object_key, a.size]);
    }
    await client.query(`UPDATE environments SET current_number = $2 WHERE id = $1`, [eid, newNumber]);
    await writeAudit(client, { projectId: env.project_id, groupId: project.group_id, actor: rc.user.username, action: 'deployment.status', target: `${project.path}:${env.name}#${newNumber}`, before: null, after: { status: 'success' }, at: now });
    const seq = await rc.ctx.live(client, env.project_id, 'deployment', { environment: env.name, number: newNumber, status: 'success' });
    await client.query('COMMIT');
    return { number: newNumber, seq };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function metrics(rc: RequestCtx): Promise<unknown> {
  if (!rc.user) throw errs.unauthenticated();
  const id = Number(rc.params.id);
  const zone = rc.query.get('zone') ?? rc.user.time_zone;
  const days = Number(rc.query.get('days') ?? 30);
  if (!ianaZoneOk(zone)) {
    throw new AppError(422, 'validation', `Unknown time zone ${zone}.`, { fields: { zone: `Unknown time zone ${zone}.` } });
  }
  const client = await rc.ctx.db.pool.connect();
  try {
    const { access } = await loadProject(client, rc.ctx, id, rc.user.id);
    requireReadCode(access);
    const now = rc.ctx.now();
    const start = dayFloor(now, zone) - (days - 1) * 86_400_000;
    const deployments = (await client.query(`
      SELECT d.id, d.number, d.status, d.sha, d.created_at, d.finished_at, d.rolled_back, e.name, e.tier
      FROM deployments d JOIN environments e ON e.id = d.environment_id
      WHERE e.project_id = $1 AND e.tier = 'production'
      ORDER BY d.number`, [id])).rows;
    const inRange = deployments.filter((d) => d.finished_at !== null && d.finished_at >= start);
    const successes = inRange.filter((d) => d.status === 'success');
    const deploymentFrequency = successes.length / days;
    // lead time: for each success, the earliest commit author time of merged requests first deployed
    const leadTimes: number[] = [];
    for (const d of successes) {
      const firstDeploy = (await client.query<{ n: string }>(`SELECT count(*) AS n FROM deployments d2 JOIN environments e ON e.id = d2.environment_id WHERE e.project_id = $1 AND e.tier = 'production' AND d2.sha = $2 AND d2.number <= $3`, [id, d.sha, d.number])).rows[0];
      if (Number(firstDeploy?.n ?? 0) > 1) continue;
      const mrs = (await client.query<{ merged_at: number }>(`SELECT merged_at FROM merge_requests WHERE project_id = $1 AND merge_commit = $2`, [id, d.sha])).rows;
      if (mrs.length === 0) continue;
      // earliest commit author time of the merged requests
      const commitRows = (await client.query<{ author_time: number }>(`SELECT author_time FROM commits WHERE id = $1`, [d.sha])).rows;
      if (commitRows.length === 0 || mrs[0].merged_at === null) continue;
      const earliest = Math.min(commitRows[0].author_time * 1000);
      leadTimes.push((d.finished_at - earliest) / 3_600_000);
    }
    const leadTime = median(leadTimes);
    // change failure rate
    let failures = 0;
    for (const d of successes) {
      if (d.rolled_back) {
        failures++;
        continue;
      }
      const next = (await client.query<{ status: string }>(`SELECT d2.status FROM deployments d2 JOIN environments e ON e.id = d2.environment_id WHERE e.project_id = $1 AND e.tier = 'production' AND d2.number > $2 AND d2.environment_id = (SELECT environment_id FROM deployments WHERE id = $3) ORDER BY d2.number LIMIT 1`, [id, d.number, d.id])).rows[0];
      if (next && next.status === 'failed') failures++;
    }
    const cfr = successes.length > 0 ? (failures / successes.length) * 100 : null;
    // recovery time
    const recoveryTimes: number[] = [];
    for (const d of inRange.filter((x) => x.status === 'failed')) {
      const next = (await client.query<{ finished_at: number }>(`SELECT d2.finished_at FROM deployments d2 JOIN environments e ON e.id = d2.environment_id WHERE e.project_id = $1 AND e.tier = 'production' AND d2.number > $2 AND d2.environment_id = (SELECT environment_id FROM deployments WHERE id = $3) AND d2.status = 'success' AND d2.finished_at IS NOT NULL ORDER BY d2.number LIMIT 1`, [id, d.number, d.id])).rows[0];
      if (next && d.finished_at !== null) {
        recoveryTimes.push((next.finished_at - d.finished_at) / 3_600_000);
      }
    }
    const recovery = median(recoveryTimes);
    return {
      deployment_frequency: Number(deploymentFrequency.toFixed(2)),
      lead_time_hours: leadTime === null ? null : Number(leadTime.toFixed(2)),
      change_failure_rate: cfr === null ? null : Number(cfr.toFixed(1)),
      recovery_time_hours: recovery === null ? null : Number(recovery.toFixed(2)),
      now,
      zone,
    };
  } finally {
    client.release();
  }
}

export { isoFull, zoneTime };
