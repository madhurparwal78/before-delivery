// The working export: the complete document with defaults filled in.
import type { RouteCtx } from '../routes';
import { notFound } from '../errors';
import { requirePersonRoute, openProjectById } from '../store';

export async function handleExport(ctx: RouteCtx, projectId: string): Promise<void> {
  const person = await requirePersonRoute(ctx);
  const { project } = await openProjectById(ctx.app, ctx, projectId, person);
  if (!project) throw notFound();
  const vars = await ctx.app.pool.query<{ variables: unknown; presets: unknown }>(
    `SELECT variables, presets FROM scenes WHERE project_id = $1 ORDER BY ord LIMIT 1`,
    [projectId],
  );
  const scenes = await ctx.app.pool.query<{ doc: unknown }>(
    `SELECT doc FROM scenes WHERE project_id = $1 ORDER BY ord`,
    [projectId],
  );
  const doc = {
    schemaVersion: 3,
    name: project.name,
    variables: vars.rows[0]?.variables ?? [],
    presets: vars.rows[0]?.presets ?? [],
    scenes: scenes.rows.map((s) => s.doc),
  };
  ctx.res.writeHead(200, { 'content-type': 'application/json' });
  ctx.res.end(JSON.stringify(doc));
}
