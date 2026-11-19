import type { Role } from '../../shared/model.ts';
import type { App, AuthUser, Module } from '../http/app.ts';
import { conflict, invalid, notFound } from '../http/errors.ts';
import { json } from '../http/reply.ts';
import { isObject, nonBlank } from '../http/validate.ts';
import { projectAccess, requireRole } from '../projects/access.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { mountSheets } from '../sheets/routes.ts';
import { workbookScope } from '../sheets/scope.ts';
import { sheetSchema, workbookSheets } from '../sheets/store.ts';
import { seedWorkbooks } from './seed.ts';
import { saveParameter, saveSet } from './params.ts';
import {
  certifyWorkbook,
  createWorkbook,
  openWorkbook,
  publishWorkbook,
  requireVersion,
  workbookSchema,
} from './store.ts';
import type { WorkbookRow, WorkbookState } from './store.ts';

async function detail(app: App, workbook: WorkbookRow) {
  const [ws, sheets, dashboards] = await Promise.all([
    workbookScope(app, workbook),
    workbookSheets(app.db, workbook.id),
    app.db.rows<{ id: string; name: string }>(`SELECT id, name FROM dashboards WHERE workbook_id = $1 ORDER BY seq`, [
      workbook.id,
    ]),
  ]);
  return {
    id: workbook.id,
    name: workbook.name,
    project: workbook.project_id,
    source: workbook.source_id,
    state: workbook.state,
    version: workbook.version,
    certified_by: workbook.certified_by,
    sheets: sheets.map(({ id, name }) => ({ id, name })),
    dashboards,
    parameters: ws.parameters,
    sets: ws.sets,
  };
}

/** The workbook of a parameter or set row, opened for a creator. */
async function editableOwner(app: App, user: AuthUser, table: 'parameters' | 'sets', id: string): Promise<WorkbookRow> {
  const found = await app.db.row<{ workbook_id: string }>(`SELECT workbook_id FROM ${table} WHERE id = $1`, [id]);
  if (!found) throw notFound();
  const { workbook, role } = await openWorkbook(app, user, found.workbook_id);
  requireRole(role, 'creator');
  return workbook;
}

export const mountWorkbooks: Module = (app) => {
  app.schema([...workbookSchema, ...sheetSchema]);

  app.workbooksOf = (projectId: string, _userId: string, role: Role) =>
    app.db.rows<{ id: string; name: string; state: WorkbookState; certified_by: string | null }>(
      `SELECT id, name, state, certified_by FROM workbooks
        WHERE project_id = $1 AND (state = 'published' OR $2 = 'creator') ORDER BY seq`,
      [projectId, role],
    );

  app.route({
    method: 'GET',
    path: '/api/workbooks',
    handler: async (ctx) =>
      json(
        200,
        await app.db.rows(
          `SELECT w.id, w.name, w.project_id AS project, w.state, w.certified_by FROM workbooks w
             JOIN project_members m ON m.project_id = w.project_id AND m.user_id = $1
            WHERE w.state = 'published' OR m.role = 'creator' ORDER BY w.seq`,
          [ctx.user.id],
        ),
      ),
  });

  app.route({
    method: 'POST',
    path: '/api/projects/:id/workbooks',
    body: 'json',
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      const peeked = ctx.peek();
      const sourceId = isObject(peeked) && typeof peeked.source === 'string' ? peeked.source : null;
      if (sourceId !== null) {
        const source = await app.db.row(`SELECT id FROM sources WHERE id = $1 AND project_id = $2`, [sourceId, project.id]);
        if (!source) throw notFound();
      }
      requireRole(role, 'creator');
      const name = nonBlank(ctx.object().name);
      const errors: Record<string, string> = {};
      if (name === null) errors.name = NAME_REQUIRED;
      if (sourceId === null) errors.source = 'Source is required.';
      if (name === null || sourceId === null) throw invalid(errors);
      return json(201, await detail(app, await createWorkbook(app.db, project.id, sourceId, name.trim())));
    },
  });

  app.route({
    method: 'GET',
    path: '/api/workbooks/:id',
    handler: async (ctx) => json(200, await detail(app, (await openWorkbook(app, ctx.user, ctx.params.id ?? '')).workbook)),
  });

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/publish',
    body: 'json',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      const peeked = ctx.peek();
      const projectId = isObject(peeked) && typeof peeked.project === 'string' ? peeked.project : null;
      const target = projectId === null ? null : await projectAccess(app, ctx.user, projectId);
      requireRole(role, 'creator');
      if (target !== null) requireRole(target.role, 'creator');
      requireVersion(ctx, workbook.version);
      if (target === null) throw invalid({ project: 'Project is required.' });
      await publishWorkbook(app.db, workbook.id, target.project.id);
      return json(200, { state: 'published', project: target.project.id, version: workbook.version, certified_by: null });
    },
  });

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/certify',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      if (workbook.state !== 'published') throw conflict('not_published');
      return json(200, { certified_by: await certifyWorkbook(app.db, workbook.id, ctx.user.username) });
    },
  });

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/parameters',
    body: 'json',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      return json(201, await saveParameter(app, workbook, null, ctx.object()));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/parameters/:id',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params.id ?? '';
      const workbook = await editableOwner(app, ctx.user, 'parameters', id);
      return json(200, await saveParameter(app, workbook, id, ctx.object()));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/workbooks/:id/sets',
    body: 'json',
    handler: async (ctx) => {
      const { workbook, role } = await openWorkbook(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      return json(201, await saveSet(app, workbook, null, ctx.object()));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sets/:id',
    body: 'json',
    handler: async (ctx) => {
      const id = ctx.params.id ?? '';
      const workbook = await editableOwner(app, ctx.user, 'sets', id);
      return json(200, await saveSet(app, workbook, id, ctx.object()));
    },
  });

  mountSheets(app);
  app.seedStep({ order: 65, run: seedWorkbooks });
};
