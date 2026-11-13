// Project routes: get, trash, restore, plus ops/undo/redo, locks, versions,
// members, invites, uploads and inspection under /api/projects/:id.
import { sendJson } from '../http';
import { notFound, forbidden, conflict } from '../errors';
import { COPY } from '../../domain/copy';
import { projectSummary, requirePersonRoute, openProjectById } from '../store';
import type { RouteCtx } from '../routes';

export async function handleProjectRoutes(ctx: RouteCtx): Promise<void> {
  const rest = ctx.path.slice('/api/projects/'.length);
  const segments = rest.split('/');
  const projectId = segments[0]!;
  const sub = segments[1] ?? '';

  // Version-specific paths first: exports and the immutable rule.
  if (segments[1] === 'versions' && segments[2] && segments[3] === 'export' && ctx.method === 'GET') {
    const { handleVersionExport } = await import('./versions');
    return handleVersionExport(ctx, projectId, Number(segments[2]));
  }
  if (segments[1] === 'versions' && segments[2] && ['PUT', 'PATCH', 'DELETE'].includes(ctx.method)) {
    // Published versions are immutable.
    ctx.res.writeHead(405, { 'content-type': 'application/json' });
    ctx.res.end(
      JSON.stringify({ error: 'immutable', message: COPY.immutable }),
    );
    return;
  }

  if (sub === '') {
    if (ctx.method === 'GET') return getProject(ctx, projectId);
    if (ctx.method === 'DELETE') return trashProject(ctx, projectId);
    throw notFound();
  }
  if (sub === 'restore' && ctx.method === 'POST') return restoreProject(ctx, projectId);
  if (sub === 'ops' && ctx.method === 'POST') {
    const { handleOps } = await import('./ops');
    return handleOps(ctx, projectId);
  }
  if (sub === 'undo' && ctx.method === 'POST') {
    const { handleUndo } = await import('./ops');
    return handleUndo(ctx, projectId);
  }
  if (sub === 'redo' && ctx.method === 'POST') {
    const { handleRedo } = await import('./ops');
    return handleRedo(ctx, projectId);
  }
  if (segments[1] === 'layers' && segments[3] === 'lock') {
    const { handleLock } = await import('./ops');
    const layerId = segments[2]!;
    if (ctx.method === 'PUT') return handleLock(ctx, projectId, layerId);
    if (ctx.method === 'DELETE') {
      const { handleUnlock } = await import('./ops');
      return handleUnlock(ctx, projectId, layerId);
    }
    throw notFound();
  }
  if (sub === 'inspect' && ctx.method === 'GET') {
    const { handleInspect } = await import('./inspect');
    return handleInspect(ctx, projectId);
  }
  if (sub === 'assets' && ctx.method === 'POST') {
    const { handleUpload } = await import('./uploads');
    return handleUpload(ctx, projectId);
  }
  if (sub === 'versions') {
    const { handleVersions } = await import('./versions');
    return handleVersions(ctx, projectId, segments[2] ?? '');
  }
  if (sub === 'members' || sub === 'invites') {
    const { handleMembers } = await import('./members');
    return handleMembers(ctx, projectId, segments[2] ?? '', sub);
  }
  if (sub === 'export' && ctx.method === 'GET') {
    const { handleExport } = await import('./exports');
    return handleExport(ctx, projectId);
  }
  if (segments[1] === 'import'  && segments[2] === 'original' && ctx.method === 'GET') {
    const { handleImportOriginal } = await import('./imports');
    return handleImportOriginal(ctx, projectId);
  }
  throw notFound();
}

async function getProject(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { project, role } = await openProjectById(ctx.app, ctx, projectId, person);
  const scenes = await ctx.app.pool.query<{
    id: string;
    name: string;
    doc: unknown;
  }>(`SELECT id, name, doc FROM scenes WHERE project_id = $1 ORDER BY ord`, [projectId]);
  const assets = await ctx.app.pool.query(`SELECT id, kind, file_name, bytes, sha256, status, width, height, vertices, clips FROM assets WHERE project_id = $1`, [projectId]);
  const variablesRes = await ctx.app.pool.query<{ variables: unknown; presets: unknown }>(
    `SELECT variables, presets FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  const bundleVars = (variablesRes.rows[0]?.variables as never) ?? [];
  const bundlePresets = (variablesRes.rows[0]?.presets as never) ?? [];
  sendJson(ctx.res, 200, {
    project: await projectSummary(ctx.app, projectId, role),
    document: {
      schemaVersion: 3,
      name: project.name,
      variables: bundleVars,
      presets: bundlePresets,
      scenes: scenes.rows.map((s) => s.doc),
    },
    assets: assets.rows,
  });
}

async function trashProject(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const opened = await openProjectById(ctx.app, ctx, projectId, person);
  const role = opened.role;
  const project = opened.project;
  if (role !== 'Owner') throw forbidden(COPY.ownerMembers);
  if (project.status === 'trashed') throw conflict('already_trashed', COPY.alreadyTrashed);
  const now = ctx.app.clock.nowIso();
  await ctx.app.pool.query(
    `UPDATE projects SET status = 'trashed', trashed_at = $2::timestamptz, purge_at = $2::timestamptz + interval '30 days' WHERE id = $1`,
    [projectId, now],
  );
  sendJson(ctx.res, 200, { project: await projectSummary(ctx.app, projectId, role) });
}

async function restoreProject(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const opened = await openProjectById(ctx.app, ctx, projectId, person);
  const role = opened.role;
  const project = opened.project;
  if (role !== 'Owner') throw forbidden(COPY.ownerMembers);
  if (project.status !== 'trashed') throw conflict('not_trashed', COPY.notTrashed);
  if (project.purge_at && ctx.app.clock.nowMs() > project.purge_at.getTime()) {
    throw notFound();
  }
  await ctx.app.pool.query(
    `UPDATE projects SET status = 'active', trashed_at = NULL, purge_at = NULL WHERE id = $1`,
    [projectId],
  );
  sendJson(ctx.res, 200, { project: await projectSummary(ctx.app, projectId, role) });
}
