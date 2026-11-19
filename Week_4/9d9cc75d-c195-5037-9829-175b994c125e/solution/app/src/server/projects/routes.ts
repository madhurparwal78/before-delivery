import type { Module } from '../http/app.ts';
import { invalid, notFound } from '../http/errors.ts';
import { json, noContent } from '../http/reply.ts';
import { nonBlank } from '../http/validate.ts';
import { normalizeUsername } from '../auth/accounts.ts';
import { isRole, projectAccess, projectSchema, requireRole } from './access.ts';
import { createProject, setMember } from './store.ts';

export const NAME_REQUIRED = 'Name is required.';

export const mountProjects: Module = (app) => {
  app.schema(projectSchema);

  app.route({
    method: 'POST',
    path: '/api/projects',
    body: 'json',
    handler: async (ctx) => {
      const name = nonBlank(ctx.object().name);
      if (name === null) throw invalid({ name: NAME_REQUIRED });
      const id = await app.db.transaction((tx) => createProject(tx, name, [[ctx.user.id, 'creator']], false));
      return json(201, { id, name, role: 'creator', explorers_schedule: false });
    },
  });

  app.route({
    method: 'GET',
    path: '/api/projects/:id',
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      const members = await app.db.rows<{ username: string; role: string }>(
        `SELECT u.username, m.role FROM project_members m JOIN users u ON u.id = m.user_id
          WHERE m.project_id = $1 ORDER BY u.username`,
        [project.id],
      );
      const sources = await app.db.rows<{ id: string; name: string }>(
        `SELECT id, name FROM sources WHERE project_id = $1 ORDER BY created_at, id`,
        [project.id],
      );
      return json(200, {
        id: project.id,
        name: project.name,
        role,
        explorers_schedule: project.explorers_schedule,
        members,
        sources,
        workbooks: await app.workbooksOf(project.id, ctx.user.id, role),
      });
    },
  });

  app.route({
    method: 'PATCH',
    path: '/api/projects/:id',
    body: 'json',
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const flag = ctx.object().explorers_schedule;
      if (typeof flag !== 'boolean') throw invalid({ explorers_schedule: 'Explorers schedule must be true or false.' });
      await app.db.exec(`UPDATE projects SET explorers_schedule = $2 WHERE id = $1`, [project.id, flag]);
      return json(200, { id: project.id, name: project.name, role, explorers_schedule: flag });
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/projects/:id/members/:username',
    body: 'json',
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const memberRole = ctx.object().role;
      if (!isRole(memberRole)) throw invalid({ role: 'Role must be viewer, explorer or creator.' });
      const username = normalizeUsername(ctx.params.username ?? '');
      const target = await app.db.row<{ id: string }>(`SELECT id FROM users WHERE username = $1`, [username]);
      if (!target) throw invalid({ username: 'No such user.' });
      await setMember(app.db, project.id, target.id, memberRole);
      return json(200, { username, role: memberRole });
    },
  });

  app.route({
    method: 'DELETE',
    path: '/api/projects/:id/members/:username',
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const removed = await app.db.exec(
        `DELETE FROM project_members WHERE project_id = $1
           AND user_id = (SELECT id FROM users WHERE username = $2)`,
        [project.id, normalizeUsername(ctx.params.username ?? '')],
      );
      if (removed === 0) throw notFound();
      return noContent();
    },
  });
};
