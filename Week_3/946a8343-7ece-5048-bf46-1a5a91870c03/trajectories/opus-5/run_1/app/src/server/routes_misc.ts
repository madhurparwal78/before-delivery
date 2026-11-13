import { groupAccess, loadGroup, readableProject, requireLevel, roleLevels } from './access';
import { nowMs } from './clock';
import { config } from './config';
import { db } from './db';
import { lineDiff, splitLines } from './diff';
import { ApiError, errors, storageOutageText } from './errors';
import { Ctx, Reply, param, route, stringList, text } from './http';
import { currentSeq, emit, seqOf, tx } from './live';
import { exportProject, packValidation, parsePack, importGroupProject } from './pack';
import { search } from './search';
import { getObject, storageReachable, storageForcedDown } from './storage';
import { assertTargetAllowed, deliveryText, redeliver } from './webhooks';
import { latestWiki, renderMarkdown, saveWiki, wikiVersions } from './wiki';

route(
  'GET',
  '/api/health',
  async (): Promise<Reply> => {
    let databaseUp = true;
    try {
      await db.query('select 1');
    } catch {
      databaseUp = false;
    }
    if (!databaseUp) return { status: 200, body: { status: 'starting' } };
    const storage = await storageReachable();
    return { status: 200, body: { status: storage ? 'ok' : 'unavailable' } };
  },
  { auth: false },
);

route('GET', '/api/instance', async (): Promise<Reply> => {
  const storage = storageForcedDown() ? false : await storageReachable();
  return {
    status: 200,
    body: {
      storage_down: !storage,
      strip: storage ? 'Spurline is running on Postgres and file storage.' : storageOutageText,
      toast_ms: config.toastMs,
    },
  };
});

route('GET', '/api/groups/by_path', async (ctx: Ctx): Promise<Reply> => {
  const path = ctx.url.searchParams.get('path') ?? '';
  const row = await db.one<{ id: string }>('select id from groups where path = $1', [path]);
  if (row === null) throw errors.notFound();
  const group = await loadGroup(db, Number(row.id));
  if (group === null) throw errors.notFound();
  const access = await groupAccess(db, group, ctx.user.id);
  if (access.level === 0) throw errors.notFound();
  return { status: 200, body: { id: group.id, path: group.path } };
});

route('GET', '/api/projects/:id/wiki/:slug', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const page = await latestWiki(db, project.id, ctx.params.slug);
  if (page === null) {
    return { status: 200, body: { slug: ctx.params.slug, version: 0, title: '', content: '', html: '' } };
  }
  return {
    status: 200,
    body: {
      slug: page.slug,
      version: page.version,
      title: page.title,
      content: page.content,
      html: renderMarkdown(page.content),
      author: page.author,
    },
  };
});

route(
  'PUT',
  '/api/projects/:id/wiki/:slug',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const page = await saveWiki(
        t,
        project,
        ctx.params.slug,
        text(ctx.body, 'title') ?? '',
        text(ctx.body, 'content') ?? '',
        Number(ctx.body.base_version ?? 0),
        ctx.user.username,
      );
      return {
        status: 200,
        body: {
          slug: page.slug,
          version: page.version,
          title: page.title,
          content: page.content,
          html: renderMarkdown(page.content),
          seq: await seqOf(t, project.id),
        },
      };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/wiki/:slug/versions', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const versions = await wikiVersions(db, project.id, ctx.params.slug);
  const from = Number(ctx.url.searchParams.get('from') ?? '0');
  const to = Number(ctx.url.searchParams.get('to') ?? '0');
  const fromPage = versions.find((page) => page.version === from);
  const toPage = versions.find((page) => page.version === to);
  return {
    status: 200,
    body: {
      versions: versions.map((page) => ({
        version: page.version,
        title: page.title,
        author: page.author,
      })),
      diff:
        fromPage === undefined || toPage === undefined
          ? null
          : lineDiff(splitLines(fromPage.content), splitLines(toPage.content)),
    },
  };
});

route(
  'POST',
  '/api/projects/:id/wiki/:slug/restore',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'developer');
      const versions = await wikiVersions(t.sql, project.id, ctx.params.slug);
      const chosen = versions.find((page) => page.version === Number(ctx.body.version));
      if (chosen === undefined) throw errors.notFound();
      const latest = versions[versions.length - 1];
      const page = await saveWiki(
        t,
        project,
        ctx.params.slug,
        chosen.title,
        chosen.content,
        latest.version,
        ctx.user.username,
      );
      return { status: 201, body: { version: page.version, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/wiki', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const rows = await db.query<{ slug: string; title: string; version: number }>(
    `select slug, title, max(version) as version from wiki_pages where project_id = $1 group by slug, title
     order by slug`,
    [project.id],
  );
  return {
    status: 200,
    body: { pages: rows.map((row) => ({ slug: row.slug, title: row.title, version: Number(row.version) })) },
  };
});

route(
  'POST',
  '/api/projects/:id/webhooks',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'maintainer');
      const url = text(ctx.body, 'url') ?? '';
      assertTargetAllowed(url);
      const row = await t.sql.one<{ id: string }>(
        'insert into webhooks (project_id, url, secret, events) values ($1, $2, $3, $4) returning id',
        [project.id, url, text(ctx.body, 'secret') ?? '', JSON.stringify(stringList(ctx.body, 'events') ?? [])],
      );
      return { status: 201, body: { id: Number(row?.id), seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/projects/:id/webhooks', async (ctx: Ctx): Promise<Reply> => {
  const { project, access } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  requireLevel(access, 'maintainer');
  const rows = await db.query<{ id: string; url: string; events: string[] }>(
    'select id, url, events from webhooks where project_id = $1 order by id',
    [project.id],
  );
  return {
    status: 200,
    body: { webhooks: rows.map((row) => ({ id: Number(row.id), url: row.url, events: row.events })) },
  };
});

route('GET', '/api/projects/:id/webhooks/:hook/deliveries', async (ctx: Ctx): Promise<Reply> => {
  const { project, access } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  requireLevel(access, 'maintainer');
  const rows = await db.query<{
    id: string;
    uuid: string;
    event: string;
    attempts: { number: number; status_code: number | null; at: string }[];
    state: string;
    next_ms: string | null;
  }>(
    `select d.id, d.uuid, d.event, d.attempts, d.state, d.next_ms from deliveries d
     join webhooks w on w.id = d.webhook_id
     where d.webhook_id = $1 and w.project_id = $2 order by d.id desc`,
    [param(ctx, 'hook'), project.id],
  );
  return {
    status: 200,
    body: {
      deliveries: rows.map((row) => ({
        id: Number(row.id),
        uuid: row.uuid,
        event: row.event,
        attempts: row.attempts,
        state: row.state,
        next_at: row.next_ms === null ? null : new Date(Number(row.next_ms)).toISOString(),
        text: deliveryText({
          uuid: row.uuid,
          attempts: row.attempts,
          next_ms: row.next_ms === null ? null : Number(row.next_ms),
        }),
      })),
    },
  };
});

route(
  'POST',
  '/api/deliveries/:id/redeliver',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const row = await t.sql.one<{ project_id: string }>(
        `select w.project_id from deliveries d join webhooks w on w.id = d.webhook_id where d.id = $1`,
        [param(ctx, 'id')],
      );
      if (row === null) throw errors.notFound();
      const { access } = await readableProject(t.sql, Number(row.project_id), ctx.user.id);
      requireLevel(access, 'maintainer');
      const id = await redeliver(t.sql, param(ctx, 'id'));
      return { status: 201, body: { id } };
    }),
  { write: true },
);

route('GET', '/api/search', async (ctx: Ctx): Promise<Reply> => {
  const scope = ctx.url.searchParams.get('scope') ?? 'issues';
  const query = ctx.url.searchParams.get('q') ?? '';
  const result = await search(db, ctx.user.id, scope, query);
  return { status: 200, body: result };
});

route(
  'POST',
  '/api/projects/:id/exports',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const { project, access } = await readableProject(t.sql, param(ctx, 'id'), ctx.user.id);
      requireLevel(access, 'owner');
      const row = await t.sql.one<{ id: string }>(
        `insert into exports (project_id, status, progress, next_step_ms) values ($1, 'running', 0, $2) returning id`,
        [project.id, nowMs() + config.exportStepMs],
      );
      const id = Number(row?.id);
      await emit(t, project.id, 'export', { export_id: id, progress: 0, status: 'running' });
      return { status: 202, body: { id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/exports/:id', async (ctx: Ctx): Promise<Reply> => {
  const row = await db.one<{ id: string; project_id: string; status: string; progress: number; error: string | null; object_key: string | null }>(
    'select id, project_id, status, progress, error, object_key from exports where id = $1',
    [param(ctx, 'id')],
  );
  if (row === null) throw errors.notFound();
  await readableProject(db, Number(row.project_id), ctx.user.id);
  return {
    status: 200,
    body: {
      status: row.status,
      progress: Number(row.progress),
      error: row.error,
      download: row.object_key === null ? null : `/api/exports/${Number(row.id)}/file`,
    },
  };
});

route('GET', '/api/exports/:id/file', async (ctx: Ctx): Promise<Reply> => {
  const row = await db.one<{ project_id: string; object_key: string | null }>(
    'select project_id, object_key from exports where id = $1',
    [param(ctx, 'id')],
  );
  if (row === null || row.object_key === null) throw errors.notFound();
  await readableProject(db, Number(row.project_id), ctx.user.id);
  const body = await getObject(row.object_key);
  if (body === null) throw errors.storageUnavailable(storageOutageText);
  ctx.res.writeHead(200, {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': `attachment; filename="project-${Number(row.project_id)}.spurpack"`,
    'content-length': body.length,
  });
  ctx.res.end(body);
  return 'handled';
});

route('GET', '/api/projects/:id/exports', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const rows = await db.query<{ id: string; status: string; progress: number; error: string | null; object_key: string | null }>(
    'select id, status, progress, error, object_key from exports where project_id = $1 order by id desc',
    [project.id],
  );
  return {
    status: 200,
    body: {
      exports: rows.map((row) => ({
        id: Number(row.id),
        status: row.status,
        progress: Number(row.progress),
        error: row.error,
        download: row.object_key === null ? null : `/api/exports/${Number(row.id)}/file`,
      })),
    },
  };
});

route('GET', '/api/projects/:id/export_text', async (ctx: Ctx): Promise<Reply> => {
  const { project, access } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  requireLevel(access, 'owner');
  const text2 = await exportProject(db, project);
  ctx.res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(text2) });
  ctx.res.end(text2);
  return 'handled';
});

route(
  'POST',
  '/api/groups/:id/imports',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const group = await loadGroup(t.sql, param(ctx, 'id'));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level === 0) throw errors.notFound();
      if (access.level < roleLevels.owner) throw errors.forbidden();
      const slug = ctx.url.searchParams.get('slug') ?? 'imported';
      if (Buffer.byteLength(ctx.rawBody, 'utf8') > config.exportMaxBytes) {
        throw new ApiError(
          413,
          'payload_too_large',
          `File is too large (${config.exportMaxBytes} bytes at most).`,
        );
      }
      const parsed = await parsePack(t.sql, ctx.rawBody);
      const failure = packValidation(parsed);
      if (failure !== null) throw failure;
      const row = await t.sql.one<{ id: string }>(
        `insert into imports (group_id, slug, content, status, counts) values ($1, $2, $3, 'preview', $4) returning id`,
        [
          group.id,
          slug,
          ctx.rawBody,
          JSON.stringify({
            commits: parsed.commits.length,
            issues: parsed.issues.length,
            requests: parsed.requests.length,
          }),
        ],
      );
      return {
        status: 200,
        body: {
          id: Number(row?.id),
          preview: {
            commits: parsed.commits.length,
            issues: parsed.issues.length,
            requests: parsed.requests.length,
          },
          text: `Adds ${parsed.commits.length} commits, ${parsed.issues.length} issues, ${parsed.requests.length} requests.`,
        },
      };
    }),
  { write: true, limit: 'importPack' },
);

route(
  'POST',
  '/api/imports/:id/confirm',
  async (ctx: Ctx): Promise<Reply> =>
    tx(async (t) => {
      const row = await t.sql.one<{ id: string; group_id: string; slug: string; content: string }>(
        'select id, group_id, slug, content from imports where id = $1',
        [param(ctx, 'id')],
      );
      if (row === null) throw errors.notFound();
      const group = await loadGroup(t.sql, Number(row.group_id));
      if (group === null) throw errors.notFound();
      const access = await groupAccess(t.sql, group, ctx.user.id);
      if (access.level < roleLevels.owner) throw errors.forbidden();
      const parsed = await parsePack(t.sql, row.content);
      const defaultBranch =
        parsed.config.find((entry) => entry.key === 'default_branch')?.value ??
        parsed.refs.find((ref) => ref.kind === 'branch')?.name ??
        'main';
      const project = await importGroupProject(t, group.id, row.slug, defaultBranch);
      await t.sql.query(
        "update imports set project_id = $2, status = 'running', progress = 0, next_step_ms = $3 where id = $1",
        [Number(row.id), project.id, nowMs() + config.exportStepMs],
      );
      await emit(t, project.id, 'import', { import_id: Number(row.id), progress: 0, status: 'running' });
      return { status: 202, body: { project: project.id, seq: await seqOf(t, project.id) } };
    }),
  { write: true },
);

route('GET', '/api/imports/:id', async (ctx: Ctx): Promise<Reply> => {
  const row = await db.one<{ id: string; project_id: string | null; status: string; progress: number; counts: Record<string, number> }>(
    'select id, project_id, status, progress, counts from imports where id = $1',
    [param(ctx, 'id')],
  );
  if (row === null) throw errors.notFound();
  return {
    status: 200,
    body: {
      status: row.status,
      progress: Number(row.progress),
      project: row.project_id === null ? null : Number(row.project_id),
      counts: row.counts,
    },
  };
});

route('GET', '/api/projects/:id/live_seq', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  return { status: 200, body: { seq: await currentSeq(db, project.id) } };
});

route('GET', '/api/projects/:id/home', async (ctx: Ctx): Promise<Reply> => {
  const { project } = await readableProject(db, param(ctx, 'id'), ctx.user.id);
  const refs = await db.query<{ name: string; commit_id: string; message: string | null }>(
    "select name, commit_id, message from refs where project_id = $1 and kind = 'tag' order by name desc",
    [project.id],
  );
  const pipelines = await db.query<{ id: string; status: string; sha: string }>(
    `select id, status, sha from pipelines where project_id = $1 and ref = $2 order by id desc limit 20`,
    [project.id, project.default_branch],
  );
  const finished = pipelines.filter((row) => ['success', 'failed', 'canceled', 'warning'].includes(row.status));
  const passed = finished.filter((row) => row.status === 'success').length;
  const openRequests = await db.one<{ count: string }>(
    `select count(*)::text as count from merge_requests where project_id = $1 and state in ('opened','on_train')`,
    [project.id],
  );
  const { visibleIssues } = await import('./planning');
  const issues = await visibleIssues(db, project, ctx.user.id);
  const activity = await db.query<{ id: string; author: string; body: string; created_at: string }>(
    'select id, author, body, created_at from notes where project_id = $1 order by id desc limit 3',
    [project.id],
  );
  return {
    status: 200,
    body: {
      project: {
        id: project.id,
        path: project.path,
        slug: project.slug,
        default_branch: project.default_branch,
        description: `Shared work in ${project.path}.`,
      },
      latest_tag: refs.length === 0 ? null : { name: refs[0].name, commit: refs[0].commit_id, message: refs[0].message },
      tags: refs.map((row) => ({ name: row.name, message: row.message ?? '' })),
      latest_pipeline:
        pipelines.length === 0 ? null : { id: Number(pipelines[0].id), status: pipelines[0].status, sha: pipelines[0].sha },
      health: {
        open_merge_requests: Number(openRequests?.count ?? '0'),
        pipelines_passed: finished.length === 0 ? '—' : `${Math.round((passed / finished.length) * 100)}%`,
        open_issues: issues.filter((issue) => issue.state === 'opened').length,
      },
      activity: activity.map((row) => ({ id: Number(row.id), author: row.author, body: row.body, at: row.created_at })),
    },
  };
});

