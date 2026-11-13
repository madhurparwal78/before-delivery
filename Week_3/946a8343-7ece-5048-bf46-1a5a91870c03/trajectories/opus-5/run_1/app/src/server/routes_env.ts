import { hasPermission, readableProject, requireLevel, roleLevels } from './access';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, param, route, text } from './http';
import { seqOf, tx } from './live';
import {
  approvalExpired,
  approvalsOf,
  keepEnvironment,
  loadDeployment,
  loadEnvironment,
  metricTexts,
  metrics,
  normalizeDeployment,
  protectionOf,
  recordApproval,
  rollback,
  stopEnvironment,
  DeploymentRow,
} from './envs';

async function environmentsJson(projectId: number): Promise<Record<string, unknown>[]> {
  const rows = await db.query<{ id: string }>('select id from environments where project_id = $1 order by id', [
    projectId,
  ]);
  const out: Record<string, unknown>[] = [];
  for (const row of rows) {
    const environment = await loadEnvironment(db, Number(row.id));
    if (environment === null) continue;
    const deployments = await db.query<DeploymentRow>(
      `select id, environment_id, number, status, sha, pipeline_id, job_id, deployer, required, artifact_keys,
              created_ms, finished_ms
       from deployments where environment_id = $1 order by number`,
      [environment.id],
    );
    const items: Record<string, unknown>[] = [];
    for (const raw of deployments) {
      const deployment = normalizeDeployment(raw);
      const approvals = await approvalsOf(db, deployment.id);
      items.push({
        id: deployment.id,
        number: deployment.number,
        status: deployment.status,
        sha: deployment.sha,
        pipeline_id: deployment.pipeline_id,
        job_id: deployment.job_id,
        deployer: deployment.deployer,
        required: deployment.required,
        has_artifacts: deployment.artifact_keys.length > 0,
        approvals: approvals.map((approval) => ({
          user: approval.username,
          status: approval.status,
          expires_at: new Date(approval.granted_ms + 86400000).toISOString(),
          expired: approvalExpired(approval),
        })),
        given: approvals.filter((approval) => approval.status === 'approved' && !approvalExpired(approval)).length,
      });
    }
    out.push({
      id: environment.id,
      name: environment.name,
      tier: environment.tier,
      state: environment.state,
      auto_stop_at: environment.auto_stop_ms === null ? null : new Date(environment.auto_stop_ms).toISOString(),
      deployments: items,
    });
  }
  return out;
}

route('GET', '/api/projects/:id/environments', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  return { status: 200, body: { environments: await environmentsJson(project.id) } };
});

route('GET', '/api/projects/:id/environments/:env', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const all = await environmentsJson(project.id);
  const found = all.find((item) => item.id === param(ctx, 'env'));
  if (found === undefined) throw errors.notFound();
  const protection = await protectionOf(db, project.id, String(found.name));
  return { status: 200, body: { ...found, protection } };
});

route(
  'POST',
  '/api/projects/:id/deployments/:deployment/approvals',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      const deployment = await loadDeployment(t.sql, param(ctx, 'deployment'));
      if (deployment === null) throw errors.notFound();
      const status = text(ctx.body, 'status') === 'rejected' ? 'rejected' : 'approved';
      const result = await recordApproval(t, project, deployment, access, ctx.user.username, status);
      return {
        status: 200,
        body: {
          id: result.deployment.id,
          number: result.deployment.number,
          status: result.deployment.status,
          given: result.counted,
          required: result.required,
          announcement: `Deployment approval recorded: ${result.counted} of ${result.required}.`,
          seq: await seqOf(t, project.id),
        },
      };
    }),
  { write: true, idempotent: true },
);

route(
  'POST',
  '/api/environments/:id/stop',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const environment = await loadEnvironment(t.sql, param(ctx, 'id'));
      if (environment === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, environment.project_id, ctx.user.id);
      if (access.level < roleLevels.maintainer && !hasPermission(access, 'manage_environments')) {
        throw errors.forbidden();
      }
      await stopEnvironment(t, project, environment, ctx.user.username);
      return { status: 200, body: { id: environment.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/environments/:id/keep',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const environment = await loadEnvironment(t.sql, param(ctx, 'id'));
      if (environment === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, environment.project_id, ctx.user.id);
      if (access.level < roleLevels.maintainer && !hasPermission(access, 'manage_environments')) {
        throw errors.forbidden();
      }
      await keepEnvironment(t, project, environment);
      return { status: 200, body: { id: environment.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/environments/:id/rollback',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const environment = await loadEnvironment(t.sql, param(ctx, 'id'));
      if (environment === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, environment.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      const number = Number(ctx.body.deployment);
      const created = await rollback(t, project, environment, number, ctx.user.username);
      return { status: 201, body: { number: created.number, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/metrics', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const zone = ctx.url.searchParams.get('zone') ?? ctx.user.time_zone;
  const days = Number(ctx.url.searchParams.get('days') ?? '30');
  const values = await metrics(db, project, zone, days === 7 || days === 90 ? days : 30);
  return { status: 200, body: { ...values, texts: metricTexts(values), zone, days } };
});

