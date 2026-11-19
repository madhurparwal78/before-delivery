import { getExtractRow } from '../extracts/state.ts';
import { scheduleOf } from '../extracts/schedule.ts';
import type { AuthUser, Module } from '../http/app.ts';
import { invalid } from '../http/errors.ts';
import { bytes, json } from '../http/reply.ts';
import { nonBlank } from '../http/validate.ts';
import { projectAccess, requireRole } from '../projects/access.ts';
import { NAME_REQUIRED } from '../projects/routes.ts';
import { sourceAccess } from './access.ts';
import { isNullText, readCsv, sizeMessage } from './csv.ts';
import {
  addBins,
  addGroups,
  entitlementsOf,
  fieldView,
  listedFields,
  patchField,
  setEntitlements,
  setHierarchy,
  setRelation,
} from './edits.ts';
import { addTable, createSource, replaceTable, sourceSummary, tableFile, tableList } from './ingest.ts';
import { loadSourceModel } from './load.ts';
import { joinNotices } from './notices.ts';
import { sourceSchema } from './repo.ts';

const PREVIEW_ROWS = 20;

export const mountSources: Module = (app) => {
  app.schema(sourceSchema);

  const sizeError = (size: number) => [{ line: null, message: sizeMessage(size, app.config.csvMaxBytes) }];

  /** The source for a creator-only route: 404, then 403. */
  const creatorSource = async (user: AuthUser, sourceId: string) => {
    const access = await sourceAccess(app, user, sourceId);
    requireRole(access.role, 'creator');
    return access.source;
  };

  const queryName = (value: string | null, key: string): string => {
    const name = nonBlank(value);
    if (name === null) throw invalid({ [key]: NAME_REQUIRED });
    return name.trim();
  };

  app.route({
    method: 'POST',
    path: '/api/projects/:id/sources/preview',
    body: 'csv',
    tooLarge: (size) => ({ error: 'too_large', columns: [], rows: [], row_count: 0, errors: sizeError(size) }),
    handler: async (ctx) => {
      const { role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const result = readCsv(ctx.raw, app.config);
      if (!result.ok) return json(200, { columns: [], rows: [], row_count: 0, errors: result.errors });
      const { columns, records } = result.table;
      return json(200, {
        columns,
        rows: records.slice(0, PREVIEW_ROWS).map((record) => record.map((text) => (isNullText(text) ? null : text))),
        row_count: records.length,
        errors: [],
      });
    },
  });

  app.route({
    method: 'POST',
    path: '/api/projects/:id/sources',
    body: 'csv',
    tooLarge: (size) => ({ error: 'too_large', errors: sizeError(size) }),
    handler: async (ctx) => {
      const { project, role } = await projectAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'creator');
      const name = queryName(ctx.url.searchParams.get('name'), 'name');
      const table = queryName(ctx.url.searchParams.get('table'), 'table');
      const id = await createSource(app, project.id, name, table, ctx.raw);
      return json(201, await sourceSummary(app.db, id));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sources/:id/tables',
    body: 'csv',
    tooLarge: (size) => ({ error: 'too_large', errors: sizeError(size) }),
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      const table = queryName(ctx.url.searchParams.get('table'), 'table');
      await addTable(app, source.id, table, ctx.raw);
      return json(201, await sourceSummary(app.db, source.id));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sources/:id/tables/:table',
    body: 'csv',
    tooLarge: (size) => ({ error: 'too_large', errors: sizeError(size) }),
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      await replaceTable(app, source.id, ctx.params.table ?? '', ctx.raw);
      return json(200, await sourceSummary(app.db, source.id));
    },
  });

  app.route({
    method: 'GET',
    path: '/api/sources/:id',
    handler: async (ctx) => {
      const { source, role } = await sourceAccess(app, ctx.user, ctx.params.id ?? '');
      requireRole(role, 'explorer');
      const model = await loadSourceModel(app, source.id);
      const extract = await getExtractRow(app, source.id);
      return json(200, {
        id: source.id,
        name: source.name,
        version: source.version,
        tables: await tableList(app.db, source.id),
        relation: model.relation,
        fields: listedFields(model.fields).map(fieldView),
        hierarchy: model.hierarchy,
        entitlements: await entitlementsOf(app, source.id),
        schedule: extract && (await scheduleOf(app, extract)),
        notices: joinNotices(model),
      });
    },
  });

  app.route({
    method: 'GET',
    path: '/api/sources/:id/tables/:table/file',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      const table = ctx.params.table ?? '';
      const file = await tableFile(app, source.id, table);
      return bytes(200, file, 'text/csv', {
        'Content-Disposition': `attachment; filename="${table.replace(/["\\\r\n]/g, '_')}.csv"`,
      });
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sources/:id/relation',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      const relation = await setRelation(app, source.id, ctx.object());
      return json(200, { relation, notices: joinNotices(await loadSourceModel(app, source.id)) });
    },
  });

  app.route({
    method: 'PATCH',
    path: '/api/sources/:id/fields/:field',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      return json(200, await patchField(app, source.id, ctx.params.field ?? '', ctx.object()));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sources/:id/bins',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      return json(201, await addBins(app, source.id, ctx.object()));
    },
  });

  app.route({
    method: 'POST',
    path: '/api/sources/:id/groups',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      return json(201, await addGroups(app, source.id, ctx.object()));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sources/:id/hierarchy',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      return json(200, await setHierarchy(app, source.id, ctx.object()));
    },
  });

  app.route({
    method: 'PUT',
    path: '/api/sources/:id/entitlements',
    body: 'json',
    handler: async (ctx) => {
      const source = await creatorSource(ctx.user, ctx.params.id ?? '');
      return json(200, await setEntitlements(app, source.id, ctx.object()));
    },
  });
};
