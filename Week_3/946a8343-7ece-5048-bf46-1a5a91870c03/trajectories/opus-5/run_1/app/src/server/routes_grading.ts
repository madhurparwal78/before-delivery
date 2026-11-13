import { loadProject } from './access';
import { createSession } from './auth';
import { advanceClock, nowIso, nowMs, setClock } from './clock';
import { db } from './db';
import { errors } from './errors';
import { Ctx, Reply, route, text } from './http';
import { quietTx, seqOf, tx } from './live';
import { CommitAction, commitToBranch } from './push';
import { runRounds, settle } from './runner';
import { seedInstance } from './seed';
import { setStorageDown } from './storage';
import { runDeadlines } from './tasks';
import { sessionCookie } from './auth';

route(
  'POST',
  '/api/grading/seed',
  async (ctx: Ctx): Promise<Reply> => {
    const result = await quietTx(async (t) => seedInstance(t, ctx.body));
    return { status: 201, body: result };
  },
  { auth: false, grading: true, limit: 'commit' },
);

route(
  'POST',
  '/api/grading/session',
  async (ctx: Ctx): Promise<Reply> => {
    const username = text(ctx.body, 'username') ?? '';
    const row = await db.one<{ id: string; username: string }>('select id, username from users where username = $1', [
      username,
    ]);
    if (row === null) throw errors.notFound();
    const token = await tx(async (t) => createSession(t.sql, Number(row.id)));
    return {
      status: 200,
      body: { user: { id: Number(row.id), username: row.username } },
      headers: { 'set-cookie': sessionCookie(token) },
    };
  },
  { auth: false, grading: true },
);

route(
  'POST',
  '/api/grading/clock',
  async (ctx: Ctx): Promise<Reply> => {
    if (typeof ctx.body.set_ms === 'number') setClock(ctx.body.set_ms);
    else if (typeof ctx.body.advance_ms === 'number') advanceClock(ctx.body.advance_ms);
    await runDeadlines();
    return { status: 200, body: { now_ms: nowMs(), now: nowIso() } };
  },
  { auth: false, grading: true },
);

route(
  'POST',
  '/api/grading/commit',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const projectId = Number(ctx.body.project);
      const project = await loadProject(t.sql, projectId);
      if (project === null) throw errors.notFound();
      const username = text(ctx.body, 'as') ?? '';
      const user = await t.sql.one<{ id: string }>('select id from users where username = $1', [username]);
      if (user === null) throw errors.notFound();
      const { projectAccess } = await import('./access');
      const access = await projectAccess(t.sql, project, Number(user.id));
      const actions = (Array.isArray(ctx.body.actions) ? ctx.body.actions : []).map((item) => {
        const action = item as Record<string, unknown>;
        return {
          action: String(action.action) as CommitAction['action'],
          path: String(action.path ?? ''),
          content: action.content === undefined || action.content === null ? undefined : String(action.content),
          previous_path:
            action.previous_path === undefined || action.previous_path === null
              ? undefined
              : String(action.previous_path),
        };
      });
      const result = await commitToBranch(t, {
        project,
        access,
        actor: username,
        branch: text(ctx.body, 'branch') ?? project.default_branch,
        startRef: text(ctx.body, 'start_ref'),
        baseCommit: text(ctx.body, 'base_commit'),
        message: text(ctx.body, 'message') ?? '',
        actions,
        timestamp: typeof ctx.body.timestamp === 'number' ? ctx.body.timestamp : undefined,
      });
      return {
        status: 201,
        body: {
          commit: result.commit,
          seq: await seqOf(t, project.id),
          pipeline: 'id' in result.pipeline ? { id: result.pipeline.id } : result.pipeline,
        },
      };
    }),
  { auth: false, grading: true, limit: 'commit' },
);

route(
  'POST',
  '/api/grading/runner/step',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const projectId = Number(ctx.body.project);
      const count = typeof ctx.body.count === 'number' ? ctx.body.count : 1;
      const result = await runRounds(t, projectId, count);
      return { status: 200, body: { rounds: count, jobs: result.jobs, seq: await seqOf(t, projectId) } };
    }),
  { auth: false, grading: true },
);

route(
  'POST',
  '/api/grading/runner/settle',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const projectId = Number(ctx.body.project);
      const result = await settle(t, projectId);
      return {
        status: 200,
        body: { rounds: result.rounds, jobs: result.result.jobs, seq: await seqOf(t, projectId) },
      };
    }),
  { auth: false, grading: true },
);

route(
  'POST',
  '/api/grading/storage',
  async (ctx: Ctx): Promise<Reply> => {
    const down = ctx.body.down === true;
    setStorageDown(down);
    return { status: 200, body: { storage: down ? 'down' : 'up' } };
  },
  { auth: false, grading: true },
);

route(
  'POST',
  '/api/grading/sink/:name',
  async (ctx: Ctx): Promise<Reply> => {
    const name = ctx.params.name;
    const stored = await db.one<{ value: { status?: number; requests?: unknown[] } }>(
      'select value from instance_state where key = $1',
      [`sink:${name}`],
    );
    const requests = (stored?.value.requests ?? []) as unknown[];
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(ctx.headers)) {
      if (typeof value === 'string') headers[key.toLowerCase()] = value;
    }
    requests.push({ headers, body: ctx.rawBody, received_at_ms: nowMs() });
    const queryStatus = ctx.url.searchParams.get('status');
    const status = queryStatus !== null ? Number(queryStatus) : stored?.value.status ?? 200;
    await db.query(
      `insert into instance_state (key, value) values ($1, $2)
       on conflict (key) do update set value = $2`,
      [`sink:${name}`, JSON.stringify({ status: stored?.value.status ?? 200, requests })],
    );
    return { status, body: { ok: true } };
  },
  { auth: false, grading: true, limit: 'commit' },
);

route(
  'PUT',
  '/api/grading/sink/:name',
  async (ctx: Ctx): Promise<Reply> => {
    const name = ctx.params.name;
    const stored = await db.one<{ value: { status?: number; requests?: unknown[] } }>(
      'select value from instance_state where key = $1',
      [`sink:${name}`],
    );
    await db.query(
      `insert into instance_state (key, value) values ($1, $2)
       on conflict (key) do update set value = $2`,
      [
        `sink:${name}`,
        JSON.stringify({ status: Number(ctx.body.status ?? 200), requests: stored?.value.requests ?? [] }),
      ],
    );
    return { status: 200, body: { status: Number(ctx.body.status ?? 200) } };
  },
  { auth: false, grading: true },
);

route(
  'GET',
  '/api/grading/sink/:name',
  async (ctx: Ctx): Promise<Reply> => {
    const stored = await db.one<{ value: { requests?: unknown[] } }>(
      'select value from instance_state where key = $1',
      [`sink:${ctx.params.name}`],
    );
    return { status: 200, body: { requests: stored?.value.requests ?? [] } };
  },
  { auth: false, grading: true },
);

