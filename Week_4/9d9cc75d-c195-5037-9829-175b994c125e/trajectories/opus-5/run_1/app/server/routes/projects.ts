import { projectAccess, roleIn, userByName } from '../auth.js';
import { id, q, q1 } from '../db.js';
import { asObject, bool, fail, requireUser, sendJson, str, type Router } from '../http.js';
import type { Role } from '../../shared/types.js';

const ROLES: Role[] = ['viewer', 'explorer', 'creator'];

export function registerProjects(router: Router): void {
  router.post('/api/projects', async (ctx) => {
    const user = requireUser(ctx);
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    const projectId = id();
    await q1('INSERT INTO projects (id, name) VALUES ($1, $2)', [projectId, name]);
    await q1('INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3)', [projectId, user.id, 'creator']);
    sendJson(ctx.res, 201, { id: projectId, name, role: 'creator', explorers_schedule: false });
  });

  router.get('/api/projects/:id', async (ctx) => {
    const role = await projectAccess(ctx, ctx.params.id, 'viewer');
    const project = await q1<{ id: string; name: string; explorers_schedule: boolean }>(
      'SELECT id, name, explorers_schedule FROM projects WHERE id = $1',
      [ctx.params.id],
    );
    if (project === null) return;
    const members = await q<{ username: string; role: Role }>(
      'SELECT u.username, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 ORDER BY u.username',
      [ctx.params.id],
    );
    const sources = await q<{ id: string; name: string }>(
      'SELECT id, name FROM sources WHERE project_id = $1 ORDER BY created_at',
      [ctx.params.id],
    );
    const workbooks = await q<{ id: string; name: string; state: string; certified_by: string | null }>(
      `SELECT id, name, state, certified_by FROM workbooks WHERE project_id = $1 ${
        role === 'creator' ? '' : "AND state = 'published'"
      } ORDER BY created_at`,
      [ctx.params.id],
    );
    sendJson(ctx.res, 200, {
      id: project.id,
      name: project.name,
      role,
      explorers_schedule: project.explorers_schedule,
      members,
      sources,
      workbooks,
    });
  });

  router.patch('/api/projects/:id', async (ctx) => {
    await projectAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const value = bool(body.explorers_schedule);
    if (value === null) fail(422, 'invalid');
    await q1('UPDATE projects SET explorers_schedule = $2 WHERE id = $1', [ctx.params.id, value]);
    const project = await q1<{ id: string; name: string; explorers_schedule: boolean }>(
      'SELECT id, name, explorers_schedule FROM projects WHERE id = $1',
      [ctx.params.id],
    );
    const user = requireUser(ctx);
    sendJson(ctx.res, 200, { ...project, role: await roleIn(ctx.params.id, user.id) });
  });

  router.put('/api/projects/:id/members/:username', async (ctx) => {
    await projectAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const role = str(body.role) ?? '';
    if (!ROLES.includes(role as Role)) fail(422, 'invalid');
    const target = await userByName(ctx.params.username.toLowerCase());
    if (target === null) fail(422, 'invalid', { username: 'No such user.' });
    await q1(
      `INSERT INTO members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO UPDATE SET role = $3`,
      [ctx.params.id, target.id, role],
    );
    sendJson(ctx.res, 200, { username: target.username, role });
  });

  router.delete('/api/projects/:id/members/:username', async (ctx) => {
    await projectAccess(ctx, ctx.params.id, 'creator');
    const target = await userByName(ctx.params.username.toLowerCase());
    if (target === null) fail(422, 'invalid', { username: 'No such user.' });
    await q1('DELETE FROM members WHERE project_id = $1 AND user_id = $2', [ctx.params.id, target.id]);
    ctx.res.writeHead(204);
    ctx.res.end();
  });
}
