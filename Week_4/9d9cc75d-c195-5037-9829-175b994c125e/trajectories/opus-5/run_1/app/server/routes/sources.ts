import { projectAccess } from '../auth.js';
import { sourceAccess } from '../access.js';
import { config } from '../config.js';
import { id as newId, q, q1 } from '../db.js';
import { now } from '../clock.js';
import { arr, asObject, fail, int, requireUser, sendJson, str, type Ctx, type Router } from '../http.js';
import { inferType, parseCsv } from '../domain/csv.js';
import { setRelation, storeTable } from '../domain/ingest.js';
import { extractState, refreshSource } from '../domain/extract.js';
import { getObject, StorageUnavailable } from '../storage.js';
import { invalidateSource, loadSource } from '../domain/source.js';
import type { DerivedSpec, FieldKind, FieldType, ScheduleSpec, SourceDoc } from '../../shared/types.js';

async function readCsv(ctx: Ctx): Promise<Buffer> {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.includes('text/csv')) fail(415, 'unsupported_media_type');
  return ctx.raw();
}

function tooLarge(size: number): never {
  return fail(413, 'too_large', [
    { line: null, message: `File is ${size} bytes. The limit is ${config.csvMaxBytes}.` },
  ]);
}

async function sourceDoc(sourceId: string): Promise<SourceDoc | null> {
  const loaded = await loadSource(sourceId);
  if (loaded === null) return null;
  const schedule = await q1<{ schedule: ScheduleSpec | null }>('SELECT schedule FROM sources WHERE id = $1', [
    sourceId,
  ]);
  const state = await extractState(sourceId);
  return {
    id: loaded.id,
    name: loaded.name,
    project: loaded.projectId,
    version: loaded.version,
    tables: loaded.tables,
    relation: loaded.relation,
    fields: loaded.fields.map((f) => ({
      id: f.id,
      name: f.name,
      table: f.table,
      type: f.type,
      kind: f.kind,
      continuous: f.continuous,
      hidden: f.hidden,
      derived: f.derived ?? null,
    })),
    hierarchy: loaded.hierarchy,
    entitlements: loaded.entitlements,
    schedule:
      schedule?.schedule === null || schedule?.schedule === undefined
        ? null
        : { ...schedule.schedule, next_run_at: state.next_run_at },
    notices: loaded.joinNotice === null ? [] : [loaded.joinNotice],
  };
}

async function addDerivedField(
  sourceId: string,
  baseName: string,
  suffix: 'bin' | 'group',
  derived: DerivedSpec,
): Promise<Record<string, unknown>> {
  const loaded = await loadSource(sourceId);
  if (loaded === null) fail(404, 'not_found');
  const base = loaded.fields.find((f) => f.name === baseName);
  if (base === undefined) fail(422, 'invalid', { field: 'Name is required.' });
  const name = `${baseName} (${suffix})`;
  if (loaded.fields.some((f) => f.name === name)) {
    fail(422, 'invalid', { name: `A field named ${name} already exists.` });
  }
  const fieldId = newId();
  const ord = await q1<{ max: number | null }>('SELECT MAX(ord) AS max FROM fields WHERE source_id = $1', [sourceId]);
  await q1(
    `INSERT INTO fields (id, source_id, name, table_name, type, kind, continuous, ord, derived)
     VALUES ($1, $2, $3, $4, 'text', 'dimension', false, $5, $6)`,
    [fieldId, sourceId, name, base.table, (ord?.max ?? -1) + 1, JSON.stringify(derived)],
  );
  await q1('UPDATE sources SET version = version + 1 WHERE id = $1', [sourceId]);
  invalidateSource(sourceId);
  return {
    id: fieldId,
    name,
    table: base.table,
    type: 'text',
    kind: 'dimension',
    continuous: false,
    hidden: false,
    derived,
  };
}

export function registerSources(router: Router): void {
  router.post('/api/projects/:id/sources/preview', async (ctx) => {
    const bytes = await readCsv(ctx);
    if (bytes.length > config.csvMaxBytes) {
      fail(
        413,
        'too_large',
        undefined,
        {
          columns: [],
          rows: [],
          row_count: 0,
          errors: [{ line: null, message: `File is ${bytes.length} bytes. The limit is ${config.csvMaxBytes}.` }],
        },
      );
    }
    await projectAccess(ctx, ctx.params.id, 'creator');
    const parsed = parseCsv(bytes);
    const columns = parsed.header.map((name, index) => ({
      name,
      type: inferType(parsed.records.map((r) => r.cells[index])),
    }));
    sendJson(ctx.res, 200, {
      columns,
      rows: parsed.records.slice(0, 20).map((r) => r.cells),
      row_count: parsed.rowCount,
      errors: parsed.errors,
    });
  });

  router.post('/api/projects/:id/sources', async (ctx) => {
    const bytes = await readCsv(ctx);
    if (bytes.length > config.csvMaxBytes) tooLarge(bytes.length);
    await projectAccess(ctx, ctx.params.id, 'creator');
    const name = ctx.url.searchParams.get('name') ?? '';
    const table = ctx.url.searchParams.get('table') ?? '';
    if (name.trim() === '' || table.trim() === '') fail(422, 'invalid', { name: 'Name is required.' });
    const parsed = parseCsv(bytes);
    if (parsed.errors.length > 0) fail(422, 'invalid_csv', parsed.errors);
    const sourceId = newId();
    try {
      await storeTable({
        sourceId,
        projectId: ctx.params.id,
        sourceName: name,
        tableName: table,
        bytes,
        parsed,
        newSource: true,
      });
    } catch (err) {
      if (err instanceof StorageUnavailable) fail(503, 'storage_unavailable');
      throw err;
    }
    const doc = await sourceDoc(sourceId);
    sendJson(ctx.res, 201, { id: sourceId, name, version: doc?.version ?? 1, tables: doc?.tables ?? [] });
  });

  router.post('/api/sources/:id/tables', async (ctx) => {
    const bytes = await readCsv(ctx);
    if (bytes.length > config.csvMaxBytes) tooLarge(bytes.length);
    const access = await sourceAccess(ctx, ctx.params.id, 'creator');
    const table = ctx.url.searchParams.get('table') ?? '';
    if (table.trim() === '') fail(422, 'invalid', { table: 'Name is required.' });
    const loaded = await loadSource(ctx.params.id);
    if (loaded === null) fail(404, 'not_found');
    if (loaded.tables.length >= 2 && !loaded.tables.some((t) => t.name === table)) {
      fail(422, 'invalid', { table: 'A source holds at most 2 tables.' });
    }
    const parsed = parseCsv(bytes);
    if (parsed.errors.length > 0) fail(422, 'invalid_csv', parsed.errors);
    try {
      await storeTable({
        sourceId: ctx.params.id,
        projectId: access.projectId,
        sourceName: loaded.name,
        tableName: table,
        bytes,
        parsed,
        newSource: false,
      });
    } catch (err) {
      if (err instanceof StorageUnavailable) fail(503, 'storage_unavailable');
      throw err;
    }
    const doc = await sourceDoc(ctx.params.id);
    sendJson(ctx.res, 201, { id: ctx.params.id, name: loaded.name, version: doc?.version ?? 1, tables: doc?.tables ?? [] });
  });

  router.put('/api/sources/:id/tables/:table', async (ctx) => {
    const bytes = await readCsv(ctx);
    if (bytes.length > config.csvMaxBytes) tooLarge(bytes.length);
    const access = await sourceAccess(ctx, ctx.params.id, 'creator');
    const loaded = await loadSource(ctx.params.id);
    if (loaded === null || !loaded.tables.some((t) => t.name === ctx.params.table)) fail(404, 'not_found');
    const parsed = parseCsv(bytes);
    if (parsed.errors.length > 0) fail(422, 'invalid_csv', parsed.errors);
    try {
      await storeTable({
        sourceId: ctx.params.id,
        projectId: access.projectId,
        sourceName: loaded.name,
        tableName: ctx.params.table,
        bytes,
        parsed,
        newSource: false,
      });
    } catch (err) {
      if (err instanceof StorageUnavailable) fail(503, 'storage_unavailable');
      throw err;
    }
    const doc = await sourceDoc(ctx.params.id);
    sendJson(ctx.res, 200, { id: ctx.params.id, name: loaded.name, version: doc?.version ?? 1, tables: doc?.tables ?? [] });
  });

  router.get('/api/sources/:id', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'explorer');
    const doc = await sourceDoc(ctx.params.id);
    if (doc === null) fail(404, 'not_found');
    sendJson(ctx.res, 200, doc);
  });

  router.get('/api/sources/:id/tables/:table/file', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const table = await q1<{ object_key: string }>(
      'SELECT object_key FROM source_tables WHERE source_id = $1 AND name = $2',
      [ctx.params.id, ctx.params.table],
    );
    if (table === null) fail(404, 'not_found');
    try {
      const bytes = await getObject(table.object_key);
      ctx.res.writeHead(200, {
        'content-type': 'text/csv',
        'content-length': bytes.byteLength,
        'content-disposition': `attachment; filename="${ctx.params.table}.csv"`,
      });
      ctx.res.end(Buffer.from(bytes));
    } catch {
      fail(503, 'storage_unavailable');
    }
  });

  router.put('/api/sources/:id/relation', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const loaded = await loadSource(ctx.params.id);
    if (loaded === null) fail(404, 'not_found');
    const leftTable = str(body.left_table) ?? '';
    const rightTable = str(body.right_table) ?? '';
    const leftKey = str(body.left_key) ?? '';
    const rightKey = str(body.right_key) ?? '';
    const left = loaded.tables.find((t) => t.name === leftTable);
    const right = loaded.tables.find((t) => t.name === rightTable);
    if (left === undefined || right === undefined) fail(404, 'not_found');
    const leftColumn = left.columns.find((c) => c.name === leftKey);
    const rightColumn = right.columns.find((c) => c.name === rightKey);
    if (leftColumn === undefined || rightColumn === undefined) fail(422, 'invalid', { right_key: 'Name is required.' });
    if (leftColumn.type !== rightColumn.type) {
      fail(422, 'invalid', { right_key: 'Keys must have the same type.' });
    }
    await setRelation(ctx.params.id, {
      left_table: leftTable,
      left_key: leftKey,
      right_table: rightTable,
      right_key: rightKey,
    });
    const doc = await sourceDoc(ctx.params.id);
    sendJson(ctx.res, 200, { relation: doc?.relation ?? null, notices: doc?.notices ?? [] });
  });

  router.patch('/api/sources/:id/fields/:field', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const loaded = await loadSource(ctx.params.id);
    if (loaded === null) fail(404, 'not_found');
    const field = loaded.fields.find((f) => f.id === ctx.params.field);
    if (field === undefined) fail(404, 'not_found');
    const updates: { name?: string; hidden?: boolean; kind?: FieldKind } = {};
    if ('name' in body) {
      const name = (str(body.name) ?? '').trim();
      if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
      if (name !== field.name && loaded.fields.some((f) => f.name === name)) {
        fail(422, 'invalid', { name: `A field named ${name} already exists.` });
      }
      updates.name = name;
    }
    if ('hidden' in body) updates.hidden = body.hidden === true;
    if ('kind' in body) {
      const kind = str(body.kind);
      if (kind !== 'dimension' && kind !== 'measure') fail(422, 'invalid');
      updates.kind = kind;
    }
    const nextName = updates.name ?? field.name;
    const nextHidden = updates.hidden ?? field.hidden;
    const nextKind = updates.kind ?? field.kind;
    const continuous = field.type === 'date' ? true : field.type === 'number' ? nextKind === 'measure' : false;
    await q1('UPDATE fields SET name = $2, hidden = $3, kind = $4, continuous = $5 WHERE id = $1', [
      field.id,
      nextName,
      nextHidden,
      nextKind,
      continuous,
    ]);
    if (updates.name !== undefined && updates.name !== field.name) {
      await q(
        `UPDATE fields SET derived = jsonb_set(derived, '{base}', to_jsonb($3::text))
         WHERE source_id = $1 AND derived IS NOT NULL AND derived->>'base' = $2`,
        [ctx.params.id, field.name, updates.name],
      );
      await q1(
        `UPDATE sources SET hierarchy = (
           SELECT jsonb_build_object('name', hierarchy->'name', 'fields',
             (SELECT jsonb_agg(CASE WHEN value::text = to_jsonb($2::text)::text THEN to_jsonb($3::text) ELSE value END)
              FROM jsonb_array_elements(hierarchy->'fields')))
         ) WHERE id = $1 AND hierarchy IS NOT NULL`,
        [ctx.params.id, field.name, updates.name],
      );
      await q1(
        `UPDATE sources SET entitlements = jsonb_set(entitlements, '{field}', to_jsonb($3::text))
         WHERE id = $1 AND entitlements->>'field' = $2`,
        [ctx.params.id, field.name, updates.name],
      );
    }
    await q1('UPDATE sources SET version = version + 1 WHERE id = $1', [ctx.params.id]);
    invalidateSource(ctx.params.id);
    sendJson(ctx.res, 200, {
      id: field.id,
      name: nextName,
      table: field.table,
      type: field.type,
      kind: nextKind,
      continuous,
      hidden: nextHidden,
      derived: field.derived ?? null,
    });
  });

  router.post('/api/sources/:id/bins', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const field = str(body.field) ?? '';
    const size = int(body.size);
    if (size === null || !Number.isInteger(size) || size < 1) {
      fail(422, 'invalid', { size: 'Bin size must be a whole number of at least 1.' });
    }
    const created = await addDerivedField(ctx.params.id, field, 'bin', { kind: 'bin', base: field, size });
    sendJson(ctx.res, 201, created);
  });

  router.post('/api/sources/:id/groups', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const field = str(body.field) ?? '';
    const groups = arr(body.groups).map((g) => {
      const group = asObject(g);
      return { name: (str(group.name) ?? '').trim(), members: arr(group.members) as string[] };
    });
    if (groups.length === 0 || groups.some((g) => g.name === '')) {
      fail(422, 'invalid', { name: 'Name is required.' });
    }
    const created = await addDerivedField(ctx.params.id, field, 'group', { kind: 'group', base: field, groups });
    sendJson(ctx.res, 201, created);
  });

  router.put('/api/sources/:id/hierarchy', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const name = (str(body.name) ?? '').trim();
    const fields = arr(body.fields).filter((f): f is string => typeof f === 'string');
    if (name === '') fail(422, 'invalid', { name: 'Name is required.' });
    await q1('UPDATE sources SET hierarchy = $2, version = version + 1 WHERE id = $1', [
      ctx.params.id,
      JSON.stringify({ name, fields }),
    ]);
    invalidateSource(ctx.params.id);
    sendJson(ctx.res, 200, { name, fields });
  });

  router.put('/api/sources/:id/entitlements', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'creator');
    const body = asObject(await ctx.body());
    const field = str(body.field);
    const users: Record<string, unknown[]> = {};
    for (const [username, values] of Object.entries(asObject(body.users))) {
      users[username.toLowerCase()] = arr(values);
    }
    const entitlements = { field: field ?? null, users };
    await q1('UPDATE sources SET entitlements = $2 WHERE id = $1', [ctx.params.id, JSON.stringify(entitlements)]);
    invalidateSource(ctx.params.id);
    sendJson(ctx.res, 200, entitlements);
  });

  router.put('/api/sources/:id/schedule', async (ctx) => {
    const access = await sourceAccess(ctx, ctx.params.id, 'explorer');
    const project = await q1<{ explorers_schedule: boolean }>('SELECT explorers_schedule FROM projects WHERE id = $1', [
      access.projectId,
    ]);
    if (access.role !== 'creator' && project?.explorers_schedule !== true) fail(403, 'forbidden');
    const body = asObject(await ctx.body());
    const every = int(body.every_minutes);
    const kind = str(body.kind) ?? 'full';
    const key = str(body.key);
    if (every === null || !Number.isInteger(every) || every < 1 || every > 10080) {
      fail(422, 'invalid', { every_minutes: 'Every minutes must be a whole number from 1 to 10080.' });
    }
    if (kind !== 'full' && kind !== 'incremental') fail(422, 'invalid');
    const loaded = await loadSource(ctx.params.id);
    if (loaded === null) fail(404, 'not_found');
    if (kind === 'incremental') {
      const field = loaded.fields.find((f) => f.name === key);
      const type: FieldType | undefined = field?.type;
      if (field === undefined || (type !== 'number' && type !== 'date')) {
        fail(422, 'invalid', { key: 'Incremental refresh needs a number or date key.' });
      }
    }
    const schedule: ScheduleSpec = { every_minutes: every, kind, key: key ?? null };
    await q1('UPDATE sources SET schedule = $2 WHERE id = $1', [ctx.params.id, JSON.stringify(schedule)]);
    await q1(
      `INSERT INTO extracts (source_id, state, last_run_at) VALUES ($1, 'live', $2)
       ON CONFLICT (source_id) DO UPDATE SET last_run_at = $2`,
      [ctx.params.id, now()],
    );
    const state = await extractState(ctx.params.id);
    sendJson(ctx.res, 200, { ...schedule, next_run_at: state.next_run_at });
  });

  router.delete('/api/sources/:id/schedule', async (ctx) => {
    await sourceAccess(ctx, ctx.params.id, 'explorer');
    await q1('UPDATE sources SET schedule = NULL WHERE id = $1', [ctx.params.id]);
    ctx.res.writeHead(204);
    ctx.res.end();
  });

  router.post('/api/sources/:id/refresh', async (ctx) => {
    const access = await sourceAccess(ctx, ctx.params.id, 'explorer');
    const project = await q1<{ explorers_schedule: boolean }>('SELECT explorers_schedule FROM projects WHERE id = $1', [
      access.projectId,
    ]);
    if (access.role !== 'creator' && project?.explorers_schedule !== true) fail(403, 'forbidden');
    const state = await refreshSource(ctx.params.id);
    sendJson(ctx.res, 200, state);
  });

  router.get('/api/sources/:id/extract', async (ctx) => {
    requireUser(ctx);
    await sourceAccess(ctx, ctx.params.id, 'viewer');
    sendJson(ctx.res, 200, await extractState(ctx.params.id));
  });
}
