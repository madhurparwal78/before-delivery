// The embed: anonymous, serves only the live version, switching within 2 s.
import { sendJson } from '../http';
import { notFound } from '../errors';
import { projectById } from '../store';
import type { RouteCtx } from '../routes';

export async function handleEmbedRoutes(ctx: RouteCtx): Promise<void> {
  // /api/embed/:projectId/(scene|version|assets/:assetId)
  const rest = ctx.path.slice('/api/embed/'.length);
  const segments = rest.split('/');
  const projectId = segments[0]!;
  const sub = segments[1] ?? '';

  const project = await projectById(ctx.app.pool, projectId);
  if (!project || project.status !== 'active') throw notFound();
  const live = await ctx.app.pool
    .query<{ number: number; bundle: Buffer }>(
      `SELECT number, bundle FROM versions WHERE project_id = $1 AND status = 'live' ORDER BY number DESC LIMIT 1`,
      [projectId],
    )
    .then((r) => r.rows[0] ?? null);
  if (!live) throw notFound();

  if (sub === 'scene') {
    // Serve the same bytes from storage when it answers, else from the row.
    const objectKey = `projects/${projectId}/versions/${live.number}/scene.json`;
    const stored = await ctx.app.s3.getObject(objectKey);
    const bytes = stored ?? live.bundle;
    ctx.res.writeHead(200, {
      'content-type': 'application/json',
      'x-halation-version': String(live.number),
      'x-scene-source': stored ? 'bundle' : 'row',
    });
    ctx.res.end(bytes);
    return;
  }
  if (sub === 'version') {
    sendJson(ctx.res, 200, { number: live.number });
    return;
  }
  if (sub === 'assets' && segments[2]) {
    const assetId = segments[2]!;
    const asset = await ctx.app.pool
      .query<{ project_id: string; content_type: string }>(
        `SELECT project_id, content_type FROM assets WHERE id = $1`,
        [assetId],
      )
      .then((r) => r.rows[0] ?? null);
    if (!asset || asset.project_id !== projectId) throw notFound();
    const bytes = await ctx.app.s3.getObject(
      `projects/${projectId}/assets/${assetId}/original`,
    );
    if (!bytes) {
      const { storageUnavailable } = await import('../errors');
      const { COPY } = await import('../../domain/copy');
      throw storageUnavailable(COPY.storageOutage);
    }
    ctx.res.writeHead(200, { 'content-type': asset.content_type });
    ctx.res.end(bytes);
    return;
  }
  throw notFound();
}
