// Every route: the one error order runs here, for the whole API.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { App } from './app';
import type { Hub } from './hub';
import { sendJson } from './http';
import { notFound, ApiError, validationMessage } from './errors';
import { COPY } from '../domain/copy';
import { parseCookies, readBody, JSON_MAX, UPLOAD_MAX } from './http';
import { projectById, membership, projectSummary, newId, requirePersonRoute, openProjectById } from './store';
import { validation } from './errors';
import { makeScene } from '../domain/props';
import { readFileSync } from 'node:fs';
import { handleSessionRoutes } from './routes/session';
import { handleProjectRoutes } from './routes/projects';
import { handleEmbedRoutes } from './routes/embed';
import { handleInviteRoutes } from './routes/invites';
import { handleImportRoutes } from './routes/imports';
import { handleGradingRoutes } from './routes/grading';

export interface RouteCtx {
  app: App;
  hub: Hub;
  method: string;
  path: string;
  query: URLSearchParams;
  cookies: Record<string, string>;
  body: unknown;
  rawBody: Buffer | null;
  res: ServerResponse;
  req: IncomingMessage;
}

// Health is answered before anything else; it never returns 503.
async function health(app: App): Promise<Record<string, unknown>> {
  const dbOk = await app.pool
    .query('SELECT 1')
    .then(() => true)
    .catch(() => false);
  const bucketOk = await app.s3.bucketExists();
  if (!dbOk || !bucketOk) return { status: 'unavailable' };
  return { status: 'ok' };
}

export async function registerRoutes(
  app: App,
  hub: Hub,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;
  const method = (req.method ?? 'GET').toUpperCase();
  const cookies = parseCookies(req);
  const isApi = path.startsWith('/api/');

  // Same origin only: a state-changing request from another origin is
  // refused before any other check.
  const origin = req.headers.origin;
  if (origin && method !== 'GET' && method !== 'HEAD') {
    const host = req.headers.host;
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== (host ?? null)) {
      sendJson(res, 403, { error: 'cross_origin', message: COPY.crossOrigin });
      return;
    }
  }

  if (isApi) {
    // Body handling per route kind
    let body: unknown = undefined;
    let rawBody: Buffer | null = null;
    const isUpload =
      (method === 'POST' && (path.startsWith('/api/projects/') && path.endsWith('/assets'))) ||
      (method === 'POST' && path === '/api/imports');
    const ct = req.headers['content-type'] ?? '';
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const limit = isUpload ? UPLOAD_MAX : JSON_MAX;
      try {
        rawBody = await readBody(req, limit);
      } catch (e) {
        const status = e instanceof Error && 'status' in e ? (e as { status: number }).status : 500;
        const message = e instanceof Error && 'body' in e
          ? ((e as { body: Record<string, unknown> }).body.message as string)
          : 'Something went wrong.';
        sendJson(res, status, { error: 'too_large', message });
        return;
      }
      if (!isUpload && rawBody.length > 0) {
        if (!ct.includes('application/json')) {
          sendJson(res, 415, { error: 'unsupported_media_type', message: COPY.unsupportedMediaType });
          return;
        }
        try {
          body = JSON.parse(rawBody.toString('utf8'));
        } catch {
          sendJson(res, 400, { error: 'invalid_json', message: 'Send valid JSON.' });
          return;
        }
      }
    } else if (method === 'GET' && req.headers['content-type'] === 'application/json' && req.headers['content-length'] && Number(req.headers['content-length']) > JSON_MAX) {
      sendJson(res, 413, { error: 'too_large', message: COPY.tooLarge(JSON_MAX) });
      return;
    }

    const ctx: RouteCtx = {
      app,
      hub,
      method,
      path,
      query: url.searchParams,
      cookies,
      body,
      rawBody,
      res,
      req,
    };

    try {
      if (path === '/api/health' && method === 'GET') {
        sendJson(res, 200, await health(app));
        return;
      }
      if (path.startsWith('/api/grading/')) {
        await handleGradingRoutes(ctx);
        return;
      }
      if (path === '/api/session' || path === '/api/me') {
        await handleSessionRoutes(ctx);
        return;
      }
      if (path.startsWith('/api/invites/')) {
        await handleInviteRoutes(ctx);
        return;
      }
      if (path === '/api/imports' && method === 'POST') {
        await handleImportRoutes(ctx);
        return;
      }
      if (path.startsWith('/api/embed/')) {
        await handleEmbedRoutes(ctx);
        return;
      }
      if (path.startsWith('/api/assets/')) {
        await handleAssetDownload(app, ctx);
        return;
      }
      if (path.startsWith('/api/projects/')) {
        await handleProjectRoutes(ctx);
        return;
      }
      if (path === '/api/projects' && method === 'GET') {
        await listProjects(ctx);
        return;
      }
      if (path === '/api/projects' && method === 'POST') {
        await createProject(ctx);
        return;
      }
      sendJson(res, 404, { error: 'not_found', message: COPY.notFound });
    } catch (e) {
      if (e instanceof ApiError) {
        sendJson(res, e.status, e.body());
      } else {
        console.error('api error', path, e);
        sendJson(res, 500, { error: 'internal', message: 'Something went wrong.' });
      }
    }
    return;
  }

  // Non-API: the app pages and public files. Unpublished, trashed, purged and
  // unknown embeds answer 404 with the published text.
  await serveApp(app, res, path, method);
}

async function serveApp(
  app: App,
  res: ServerResponse,
  path: string,
  method: string,
): Promise<void> {
  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 404, { error: 'not_found', message: COPY.notFound });
    return;
  }
  if (path === '/' || path === '/signin' || path === '/projects' || path.startsWith('/projects/') || path.startsWith('/invite/')) {
    const html = readFileSync(joinDist('index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  if (path.startsWith('/embed/')) {
    const projectId = path.slice('/embed/'.length).split('/')[0]!;
    const project = await projectById(app.pool, projectId);
    const live = await app.pool
      .query<{ number: number }>(
        `SELECT number FROM versions WHERE project_id = $1 AND status = 'live'`,
        [projectId],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null);
    if (!project || project.status !== 'active' || !live) {
      const html = embedPage404();
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    const html = readFileSync(joinDist('embed.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  // Static assets
  const file = path.slice(1);
  const safe = file.replace(/\.\./g, '');
  const full = joinDist(safe);
  if (existsSyncF(full)) {
    const data = readFileSync(full);
    const ext = safe.slice(safe.lastIndexOf('.')).toLowerCase();
    const mime =
      ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.json'
            ? 'application/json'
            : 'application/octet-stream';
    res.writeHead(200, { 'content-type': mime });
    res.end(data);
    return;
  }
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><title>Not found</title><p>Not found.</p>');
}

function joinDist(file: string): string {
  return `/app/dist/public/${file}`;
}

function existsSyncF(p: string): boolean {
  try {
    readFileSync(p);
    return true;
  } catch {
    return false;
  }
}

function embedPage404(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Halation Studio</title><link rel="stylesheet" href="/app.css">
</head><body class="embed-missing">
<main class="missing-panel"><p>${COPY.embedUnpublished}</p></main>
</body></html>`;
}


async function handleAssetDownload(app: App, ctx: RouteCtx): Promise<void> {
  // Uploaded originals are served only through the app's own routes after
  // the visibility check.
  const parts = ctx.path.split('/');
  const assetId = parts[3]!;
  const person = await requirePersonRoute(ctx);
  const asset = await app.pool.query<{
    id: string;
    project_id: string;
    content_type: string;
  }>(`SELECT id, project_id, content_type FROM assets WHERE id = $1`, [assetId]);
  const row = asset.rows[0];
  if (!row) throw notFound();
  await openProjectById(app, ctx, row.project_id, person);
  const bytes = await app.s3.getObject(`projects/${row.project_id}/assets/${assetId}/original`);
  if (!bytes) throw notFound();
  ctx.res.writeHead(200, {
    'content-type': row.content_type,
    'content-length': String(bytes.length),
  });
  ctx.res.end(bytes);
}

async function listProjects(ctx: RouteCtx): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const status = ctx.query.get('status') === 'trashed' ? 'trashed' : 'active';
  const res = await ctx.app.pool.query<{ id: string }>(
    `SELECT DISTINCT pr.id FROM projects pr
     JOIN members m ON m.project_id = pr.id
     WHERE m.person_id = $1 AND pr.status = $2`,
    [person.id, status],
  );
  const out = [];
  for (const row of res.rows) {
    const role = await membership(ctx.app.pool, row.id, person.id);
    if (!role) continue;
    out.push(await projectSummary(ctx.app, row.id, role));
  }
  sendJson(ctx.res, 200, { projects: out });
}

async function createProject(ctx: RouteCtx): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const body = ctx.body as { workspaceId?: string; name?: string };
  const fields: Record<string, string> = {};
  if (!body?.workspaceId) fields.workspaceId = COPY.enterName;
  if (!body?.name || typeof body.name !== 'string') fields.name = COPY.enterName;
  if (Object.keys(fields).length > 0) throw validation(fields);
  const ws = await ctx.app.pool.query<{ id: string }>(
    `SELECT id FROM workspaces WHERE id = $1`,
    [body!.workspaceId!],
  );
  if (!ws.rows[0] || ws.rows[0].id !== person.workspaceId) throw notFound();
  const name = body!.name!.trim();
  if (name.length < 1 || name.length > 60) {
    throw validationMessage(COPY.mustBeBetween(1, 60), 'name');
  }
  const projectId = newId('prj');
  const sceneId = newId('scn');
  const doc = makeScene(sceneId, 'Main');
  const client = await ctx.app.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO projects (id, workspace_id, name, status, created_at)
       VALUES ($1, $2, $3, 'active', now())`,
      [projectId, person.workspaceId, name],
    );
    await client.query(
      `INSERT INTO members (project_id, person_id, role) VALUES ($1, $2, 'Owner')`,
      [projectId, person.id],
    );
    await client.query(
      `INSERT INTO scenes (id, project_id, name, ord, doc, variables, presets)
       VALUES ($1, $2, 'Main', 0, $3::jsonb, '[]'::jsonb, '[]'::jsonb)`,
      [sceneId, projectId, JSON.stringify(doc)],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    throw e;
  }
  client.release();
  sendJson(ctx.res, 201, { project: await projectSummary(ctx.app, projectId, 'Owner') });
}
