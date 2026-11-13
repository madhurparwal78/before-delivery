import { ProjectRow, loadProject, projectAccess, readableProject, requireLevel } from './access';
import { config } from './config';
import { ExpandContext, expandConfig, mainConfigPath } from './ciconfig';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, param, route, stringList, text } from './http';
import { seqOf, tx } from './live';
import {
  createPipeline,
  formatLogLines,
  jobsOfPipeline,
  loadPipeline,
  pipelineJson,
  predefinedVariables,
  projectVariables,
} from './pipeline';
import { filesOfCommit, resolveRef } from './repo';
import { cancelJob, cancelPipeline, jobById, playJob, retryJob, retryPipeline } from './runner';
import { getObject } from './storage';
import { loadDeployment, countedApprovals } from './envs';

async function projectOfJob(ctx: Ctx, jobId: number): Promise<{ project: ProjectRow; job: NonNullable<Awaited<ReturnType<typeof jobById>>> }> {
  const job = await jobById(db, jobId);
  if (job === null) throw errors.notFound();
  const project = await loadProject(db, job.project_id);
  if (project === null) throw errors.notFound();
  const access = await projectAccess(db, project, ctx.user.id);
  if (access.level === 0) throw errors.notFound();
  return { project, job };
}

route(
  'POST',
  '/api/projects/:id/pipelines',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const ref = text(ctx.body, 'ref') ?? project.default_branch;
      const sha = await resolveRef(t.sql, project.id, ref);
      if (sha === null) throw errors.notFound();
      const variables: Record<string, string> = {};
      const raw = ctx.body.variables;
      if (typeof raw === 'object' && raw !== null) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) variables[key] = String(value);
      }
      const result = await createPipeline(t, {
        project,
        ref,
        sha,
        source: 'web',
        variables,
        actor: ctx.user.username,
        beforeSha: null,
      });
      if (!('id' in result)) {
        return { status: 200, body: { created: false, reason: result.reason, seq: await seqOf(t, project.id) } };
      }
      return { status: 201, body: { id: result.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/pipelines', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const ref = ctx.url.searchParams.get('ref');
  const rows = await db.query<{ id: string; ref: string; sha: string; status: string; source: string; created_ms: string }>(
    `select id, ref, sha, status, source, created_ms from pipelines
     where project_id = $1 and ($2::text is null or ref = $2) order by id desc`,
    [project.id, ref],
  );
  return {
    status: 200,
    body: {
      pipelines: rows.map((row) => ({
        id: Number(row.id),
        ref: row.ref,
        sha: row.sha,
        status: row.status,
        source: row.source,
        created_at: new Date(Number(row.created_ms)).toISOString(),
      })),
    },
  };
});

route('GET', '/api/pipelines/:id', async (ctx: Ctx): Promise<Reply> => {
  const pipeline = await loadPipeline(db, param(ctx, 'id'));
  if (pipeline === null) throw errors.notFound();
  const project = await loadProject(db, pipeline.project_id);
  if (project === null) throw errors.notFound();
  const access = await projectAccess(db, project, ctx.user.id);
  if (access.level === 0) throw errors.notFound();
  const body = await pipelineJson(db, pipeline.id);
  return { status: 200, body: { ...body, project_id: project.id } };
});

route(
  'POST',
  '/api/pipelines/:id/retry',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const pipeline = await loadPipeline(t.sql, param(ctx, 'id'));
      if (pipeline === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, pipeline.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      await retryPipeline(t, project, pipeline.id);
      return { status: 200, body: { id: pipeline.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/pipelines/:id/cancel',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const pipeline = await loadPipeline(t.sql, param(ctx, 'id'));
      if (pipeline === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, pipeline.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      await cancelPipeline(t, project, pipeline.id);
      return { status: 200, body: { id: pipeline.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('POST', '/api/projects/:id/ci/lint', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const content = text(ctx.body, 'content') ?? '';
  const ref = text(ctx.body, 'ref') ?? project.default_branch;
  const head = await resolveRef(db, project.id, ref);
  const files = head === null ? new Map<string, string>() : await filesOfCommit(db, project.id, head);
  files.set(mainConfigPath, content);
  const variables: Record<string, string> = {};
  const raw = ctx.body.variables;
  if (typeof raw === 'object' && raw !== null) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) variables[key] = String(value);
  }
  const predefined = await predefinedVariables(
    db,
    { project, ref, sha: head ?? '', source: 'push', actor: ctx.user.username },
    0,
  ).catch(() => ({}) as Record<string, string>);
  const ctxExpand: ExpandContext = {
    files,
    predefined,
    projectVariables: await projectVariables(db, project.id),
    runVariables: variables,
    changedFiles: stringList(ctx.body, 'changed_files') ?? [],
    treePaths: [...files.keys()],
  };
  const result = expandConfig(ctxExpand);
  return {
    status: 200,
    body: {
      valid: result.valid,
      errors: result.errors,
      summary: result.valid
        ? result.summary
        : result.errors.length === 1
          ? 'Lint found 1 problem.'
          : `Lint found ${result.errors.length} problems.`,
      jobs: result.jobs.map((job) => ({
        name: job.name,
        stage: job.stage,
        variables: Object.fromEntries(
          Object.entries(job.variables)
            .filter(([key]) => !key.startsWith('CI_'))
            .sort(([a], [b]) => (a < b ? -1 : 1)),
        ),
      })),
    },
  };
});

route('GET', '/api/jobs/:id', async (ctx: Ctx): Promise<Reply> => {
  const { project, job } = await projectOfJob(ctx, param(ctx, 'id'));
  const artifacts = await db.query<{ path: string; size: number; expires_ms: string | null }>(
    'select path, size, expires_ms from artifacts where job_id = $1 order by path',
    [job.id],
  );
  const deployment = job.deployment_id === null ? null : await loadDeployment(db, job.deployment_id);
  const { nowMs } = await import('./clock');
  return {
    status: 200,
    body: {
      id: job.id,
      project_id: project.id,
      pipeline_id: job.pipeline_id,
      name: job.name,
      stage: job.stage,
      status: job.status,
      attempt: job.attempt,
      retried: job.retried,
      failure_reason: job.failure_reason,
      log_sealed: job.log_sealed,
      started_at: job.started_ms === null ? null : new Date(job.started_ms).toISOString(),
      finished_at: job.finished_ms === null ? null : new Date(job.finished_ms).toISOString(),
      start_at: job.start_at_ms === null ? null : new Date(job.start_at_ms).toISOString(),
      artifacts: artifacts.map((row) => ({
        path: row.path,
        size: Number(row.size),
        expires_at: row.expires_ms === null ? null : new Date(Number(row.expires_ms)).toISOString(),
        expired: row.expires_ms !== null && Number(row.expires_ms) <= nowMs(),
      })),
      environment: job.spec.environment === null ? null : job.spec.environment.name,
      waiting:
        deployment === null || deployment.status !== 'awaiting_approval'
          ? null
          : {
              deployment: deployment.number,
              given: await countedApprovals(db, deployment.id),
              required: deployment.required,
            },
    },
  };
});

route('GET', '/api/jobs/:id/log', async (ctx: Ctx): Promise<Reply> => {
  const { job } = await projectOfJob(ctx, param(ctx, 'id'));
  return { status: 200, body: { lines: formatLogLines(job.log) } };
});

route('GET', '/api/jobs/:id/log/stream', async (ctx: Ctx): Promise<Reply> => {
  const { job } = await projectOfJob(ctx, param(ctx, 'id'));
  ctx.res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  ctx.res.write(`: heartbeat\n\n`);
  for (const line of formatLogLines(job.log)) {
    ctx.res.write(`event: line\ndata: ${line}\n\n`);
  }
  const { isFinished } = await import('./pipeline');
  if (isFinished(job.status)) {
    ctx.res.write(`event: end\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
    ctx.res.end();
    return 'handled';
  }
  let sent = job.log.length;
  const heartbeat = setInterval(() => {
    ctx.res.write(`: heartbeat\n\n`);
  }, config.sseHeartbeatMs);
  const poll = setInterval(() => {
    void (async () => {
      const fresh = await jobById(db, job.id);
      if (fresh === null) return;
      const lines = formatLogLines(fresh.log);
      for (let index = sent; index < lines.length; index += 1) {
        ctx.res.write(`event: line\ndata: ${lines[index]}\n\n`);
      }
      sent = lines.length;
      if (isFinished(fresh.status)) {
        ctx.res.write(`event: end\ndata: ${JSON.stringify({ status: fresh.status })}\n\n`);
        clearInterval(poll);
        clearInterval(heartbeat);
        ctx.res.end();
      }
    })();
  }, 200);
  ctx.req.on('close', () => {
    clearInterval(poll);
    clearInterval(heartbeat);
  });
  return 'handled';
});

route(
  'POST',
  '/api/jobs/:id/play',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const job = await jobById(t.sql, param(ctx, 'id'));
      if (job === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, job.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      const variables: Record<string, string> = {};
      const raw = ctx.body.variables;
      if (typeof raw === 'object' && raw !== null) {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) variables[key] = String(value);
      }
      await playJob(t, project, job, ctx.user.username, variables);
      return { status: 200, body: { id: job.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/jobs/:id/retry',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const job = await jobById(t.sql, param(ctx, 'id'));
      if (job === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, job.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      const id = await retryJob(t, project, job, ctx.user.username);
      return { status: 201, body: { id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route(
  'POST',
  '/api/jobs/:id/cancel',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const job = await jobById(t.sql, param(ctx, 'id'));
      if (job === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, job.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      await cancelJob(t, project, job);
      return { status: 200, body: { id: job.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/jobs/:id/artifacts/:path', async (ctx: Ctx): Promise<Reply> => {
  const { job } = await projectOfJob(ctx, param(ctx, 'id'));
  const row = await db.one<{ object_key: string; expires_ms: string | null }>(
    'select object_key, expires_ms from artifacts where job_id = $1 and path = $2',
    [job.id, ctx.params.path],
  );
  if (row === null) throw errors.notFound();
  const body = await getObject(row.object_key);
  if (body === null) throw errors.notFound();
  ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': body.length });
  ctx.res.end(body);
  return 'handled';
});

route(
  'POST',
  '/api/jobs/:id/artifacts/keep',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const job = await jobById(t.sql, param(ctx, 'id'));
      if (job === null) throw errors.notFound();
      const { project, access } = await readableProject(t.sql, job.project_id, ctx.user.id);
      requireLevel(access, 'developer');
      await t.sql.query('update artifacts set expires_ms = null where job_id = $1', [job.id]);
      return { status: 200, body: { id: job.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/jobs', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const pipelineId = Number(ctx.url.searchParams.get('pipeline') ?? '0');
  const jobs = await jobsOfPipeline(db, pipelineId);
  return {
    status: 200,
    body: { jobs: jobs.filter((job) => job.project_id === project.id).map((job) => ({ id: job.id, name: job.name, status: job.status })) },
  };
});
