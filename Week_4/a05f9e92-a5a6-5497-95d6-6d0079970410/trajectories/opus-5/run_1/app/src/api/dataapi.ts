/**
 * Filters, reports, dashboards, exports, imports, configuration sets and the
 * storage state.
 */

import { randomUUID } from 'node:crypto';

import { iso, now } from '../clock';
import { settings } from '../config';
import { query, transaction } from '../db';
import { ApiError, conflict, notFound, validation } from '../errors';
import {
  canonicalFilter,
  composeFilter,
  normaliseBuilder,
  parseFilter,
  writeCondition,
  type FilterBuilder,
  type FilterCondition,
  type FilterOperator,
} from '../expr/filter';
import { tableNames, type TableName } from '../domain/fields';
import { requireCaller, requireOperator, requireRoles, type RequestContext } from '../http/context';
import {
  backOutSet,
  commitSet,
  createSet,
  loadSet,
  loadSets,
  markExported,
  previewSet,
  setFileJson,
  setFromFile,
  setJson,
  type Choice,
} from '../services/configsets';
import { Engine, type Caller } from '../services/engine';
import { csvOf, exportRows, requireReadablePath, runAggregate, runList } from '../services/lists';
import { publish } from '../services/live';
import { loadSavedFilters } from '../services/store';
import {
  getObject,
  objectKeys,
  putObject,
  storageAvailable,
  StorageFailure,
} from '../services/storage';
import { commitImport, previewImport } from '../services/imports';
import { accepted, created, ok, route } from './router';

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  return { engine: await Engine.load(caller.workspace), caller };
}

function asTable(name: unknown): TableName {
  const text = String(name ?? '');
  if (!(tableNames as readonly string[]).includes(text)) {
    throw validation('Table is not a table.', { table: 'Table is not a table.' });
  }
  return text as TableName;
}

route('GET', '/api/filters', async (context) => {
  const caller = requireCaller(context);
  const filters = await loadSavedFilters();
  return ok({
    filters: filters
      .filter((f) => f.shared || f.owner === caller.username)
      .map((f) => ({
        id: f.id,
        name: f.name,
        table: f.table,
        filter: canonicalFilter(f.filter),
        shared: f.shared,
      })),
  });
});

route('POST', '/api/filters', async (context) => {
  const caller = requireCaller(context);
  const table = asTable(context.body.table);
  const filter = String(context.body.filter ?? '');
  parseFilter(filter);
  const name = String(context.body.name ?? '').trim();
  if (name === '') throw validation('Name is required.', { name: 'Name is required.' });
  const rows = await query<{ id: string }>(
    `INSERT INTO saved_filter (name, table_name, filter_text, shared, owner, queue_order)
     VALUES ($1, $2, $3, $4, $5, 100) RETURNING id`,
    [name, table, filter, context.body.shared === true, caller.username],
  );
  return created({
    filter: { id: Number(rows[0].id), name, table, filter: canonicalFilter(filter), shared: context.body.shared === true },
  });
});

function builderJson(builder: FilterBuilder): Record<string, unknown> {
  return {
    connector: builder.connector,
    groups: builder.groups.map((group) => ({
      connector: group.connector,
      conditions: group.conditions.map((c) => ({ path: c.path, op: c.op, value: valueJson(c.value) })),
    })),
  };
}

function valueJson(value: FilterCondition['value']): unknown {
  if (typeof value === 'symbol') return 'me()';
  if (Array.isArray(value)) return value.map(valueJson);
  return value;
}

route('POST', '/api/filters/parse', async (context) => {
  const { engine, caller } = await engineFor(context);
  const table = asTable(context.body.table);
  const text = String(context.body.filter ?? '');
  const builder = normaliseBuilder(parseFilter(text));
  for (const group of builder.groups) {
    for (const condition of group.conditions) {
      requireReadablePath(engine, caller, table, condition.path);
    }
  }
  return ok({ builder: builderJson(builder), filter: composeFilter(builder) });
});

route('POST', '/api/filters/compose', async (context) => {
  const { engine, caller } = await engineFor(context);
  const table = asTable(context.body.table);
  const raw = (context.body.builder ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(raw.groups) ? (raw.groups as Record<string, unknown>[]) : [];
  const builder: FilterBuilder = {
    connector: raw.connector === 'or' ? 'or' : 'and',
    groups: groups.map((group) => ({
      connector: group.connector === 'or' ? 'or' : 'and',
      conditions: (Array.isArray(group.conditions) ? (group.conditions as Record<string, unknown>[]) : []).map(
        (condition) => {
          const path = String(condition.path ?? '');
          requireReadablePath(engine, caller, table, path);
          return {
            path,
            op: String(condition.op ?? '=') as FilterOperator,
            value: readValue(condition.value),
          };
        },
      ),
    })),
  };
  const normalised = normaliseBuilder(builder);
  // Composing then parsing must give this very builder back.
  const text = composeFilter(normalised);
  parseFilter(text);
  return ok({ filter: text });
});

function readValue(value: unknown): FilterCondition['value'] {
  if (value === 'me()') return parseFilter('x = me()').groups[0].conditions[0].value;
  if (Array.isArray(value)) return value.map(readValue) as FilterCondition['value'];
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  return null;
}

route('POST', '/api/reports/aggregate', async (context) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const table = asTable(context.body.table);
  const bucket = context.body.bucket === 'day' || context.body.bucket === 'week' ? context.body.bucket : null;
  const result = runAggregate(engine, caller, {
    table,
    filter: context.body.filter === null || context.body.filter === undefined ? '' : String(context.body.filter),
    groupBy: context.body.group_by === null || context.body.group_by === undefined ? null : String(context.body.group_by),
    bucket,
    dateField: context.body.date_field === null || context.body.date_field === undefined ? null : String(context.body.date_field),
    timeZone: context.body.time_zone === null || context.body.time_zone === undefined ? null : String(context.body.time_zone),
  });
  return ok({
    groups: result.groups.map((g) => ({ key: g.value, label: g.label, count: g.count, filter: g.filter })),
    total: result.total,
  });
});

interface WidgetSpec {
  id: string;
  title: string;
  kind: 'count' | 'bar' | 'trend';
  table: string;
  filter: string;
  group_by: string | null;
  bucket: 'day' | 'week' | null;
  date_field: string | null;
}

route('GET', '/api/dashboards/:id', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const rows = await query<{ id: string; name: string; widgets: WidgetSpec[] }>(
    `SELECT id, name, widgets FROM dashboard WHERE id = $1`,
    [params.id],
  );
  if (!rows[0]) throw notFound();
  const widgets = await Promise.all(
    (rows[0].widgets ?? []).map(async (widget) => {
      const table = asTable(widget.table);
      const result = runAggregate(engine, caller, {
        table,
        filter: widget.filter ?? '',
        groupBy: widget.group_by,
        bucket: widget.bucket,
        dateField: widget.date_field,
        // Widgets compute in the viewer's time zone.
        timeZone: caller.timeZone,
      });
      return {
        id: widget.id,
        title: widget.title,
        kind: widget.kind,
        table: widget.table,
        filter: widget.filter ?? '',
        group_by: widget.group_by,
        bucket: widget.bucket,
        data: result.groups.map((g) => ({ key: g.value, label: g.label, count: g.count, filter: g.filter })),
        total: result.total,
      };
    }),
  );
  return ok({
    dashboard: { id: rows[0].id, name: rows[0].name, time_zone: caller.timeZone, widgets },
  });
});

interface ExportRow {
  id: string;
  owner: string;
  table_name: string;
  filter_text: string;
  columns: string[];
  status: string;
  rows_total: number;
  rows_done: number;
  error: string | null;
  object_key: string | null;
}

function exportJson(row: ExportRow): Record<string, unknown> {
  return {
    id: row.id,
    status: row.status,
    rows_total: row.rows_total,
    rows_done: row.rows_done,
    error: row.error,
    key: row.object_key,
  };
}

route('POST', '/api/exports', async (context) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const table = asTable(context.body.table);
  const columns = Array.isArray(context.body.columns) ? context.body.columns.map(String) : ['number', 'state'];
  const filter = context.body.filter === null || context.body.filter === undefined ? '' : String(context.body.filter);
  for (const column of columns) requireReadablePath(engine, caller, table, column);
  const built = exportRows(engine, caller, table, filter, columns);
  const id = randomUUID();
  await query(
    `INSERT INTO export_job (id, owner, table_name, filter_text, columns, status, rows_total, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'queued', $6, $7)`,
    [id, caller.username, table, filter, JSON.stringify(columns), built.rows.length, now()],
  );
  return accepted({
    export: { id, status: 'queued', rows_total: built.rows.length, rows_done: 0 },
  });
});

route('GET', '/api/exports', async (context) => {
  const caller = requireCaller(context);
  requireRoles(context, ['operator', 'technician', 'manager']);
  const rows = await query<ExportRow>(
    `SELECT * FROM export_job WHERE owner = $1 OR $2 ORDER BY created_at DESC`,
    [caller.username, caller.roles.includes('operator')],
  );
  return ok({ exports: rows.map(exportJson) });
});

async function requireExport(context: RequestContext, id: string): Promise<ExportRow> {
  const caller = requireCaller(context);
  const rows = await query<ExportRow>(`SELECT * FROM export_job WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) throw notFound();
  if (row.owner !== caller.username && !caller.roles.includes('operator')) throw notFound();
  return row;
}

route('GET', '/api/exports/:id', async (context, params) => {
  const row = await requireExport(context, params.id);
  return ok({ export: exportJson(row) });
});

route('POST', '/api/exports/:id/retry', async (context, params) => {
  const row = await requireExport(context, params.id);
  if (row.status !== 'failed') throw conflict('not_failed', 'That export has not failed.');
  if (!storageAvailable()) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  await query(`UPDATE export_job SET status = 'queued', rows_done = 0, error = NULL WHERE id = $1`, [
    params.id,
  ]);
  const after = await requireExport(context, params.id);
  return accepted({ export: exportJson(after) });
});

route('GET', '/api/exports/:id/file', async (context, params) => {
  const row = await requireExport(context, params.id);
  if (row.status !== 'complete') throw conflict('not_complete', 'That export is not complete.');
  try {
    const object = await getObject(row.object_key ?? objectKeys.exportFile(row.id));
    return { status: 200, bytes: object.body, contentType: 'text/csv' };
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
});

route('POST', '/api/imports', async (context) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const file = context.multipart;
  if (!file) throw validation('A file is required.', { file: 'A file is required.' });
  if (!storageAvailable()) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const table = file.fields.table ?? String(context.body.table ?? '');
  if (table !== 'people' && table !== 'configuration_items') {
    throw validation('Table must be people or configuration_items.', {
      table: 'Table must be people or configuration_items.',
    });
  }
  let mapping: Record<string, string> = {};
  if (file.fields.mapping) {
    try {
      mapping = JSON.parse(file.fields.mapping) as Record<string, string>;
    } catch {
      throw validation('Mapping is not JSON.', { mapping: 'Mapping is not JSON.' });
    }
  }
  const id = randomUUID();
  const key = objectKeys.importFile(id, file.fileName);
  try {
    await putObject(key, file.bytes, 'text/plain');
  } catch (e) {
    if (e instanceof StorageFailure) {
      throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
    }
    throw e;
  }
  const preview = await previewImport(engine, table, file.bytes.toString('utf8'), mapping);
  await query(
    `INSERT INTO import_job (id, owner, table_name, object_key, file_name, rows, counts, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      id,
      caller.username,
      table,
      key,
      file.fileName,
      JSON.stringify(preview.rows),
      JSON.stringify(preview.counts),
      now(),
    ],
  );
  return created({
    import: { id, table, key, rows: preview.rows, counts: preview.counts },
  });
});

route('POST', '/api/imports/:id/commit', async (context, params) => {
  const { engine } = await engineFor(context);
  requireOperator(context);
  const rows = await query<{
    id: string;
    table_name: string;
    rows: unknown[];
    counts: Record<string, number>;
    committed: boolean;
  }>(`SELECT id, table_name, rows, counts, committed FROM import_job WHERE id = $1`, [params.id]);
  const job = rows[0];
  if (!job) throw notFound();
  if (job.committed) throw conflict('already_committed', 'That import is already committed.');
  const results = await commitImport(job.table_name, job.rows as never);
  await query(`UPDATE import_job SET committed = TRUE, results = $2::jsonb WHERE id = $1`, [
    params.id,
    JSON.stringify(results),
  ]);
  return ok({
    import: { id: job.id, table: job.table_name, rows: job.rows, counts: job.counts, results },
  });
});

route('GET', '/api/config-sets', async (context) => {
  requireOperator(context);
  const sets = await loadSets();
  return ok({ sets: sets.map(setJson) });
});

route('POST', '/api/config-sets', async (context) => {
  requireOperator(context);
  const set = await createSet(String(context.body.name ?? 'Set'));
  return created({ set: setJson(set) });
});

route('POST', '/api/config-sets/:id/export', async (context, params) => {
  requireOperator(context);
  const set = await loadSet(params.id);
  if (!set) throw notFound();
  const key = objectKeys.configSet(set.number);
  try {
    await putObject(key, Buffer.from(setFileJson(set), 'utf8'), 'application/json');
  } catch (e) {
    if (e instanceof StorageFailure) {
      throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
    }
    throw e;
  }
  const after = await markExported(set.id, key);
  return created({ set: setJson(after) });
});

route('POST', '/api/config-sets/:id/preview', async (context, params) => {
  requireOperator(context);
  const set = await loadSet(params.id);
  if (!set) throw notFound();
  if (set.state !== 'exported' && set.state !== 'committed') {
    throw conflict('not_exported', 'Export the set before previewing it.');
  }
  try {
    await getObject(set.objectKey ?? objectKeys.configSet(set.number));
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  return ok({ items: await previewSet(set) });
});

route('POST', '/api/config-sets/upload', async (context) => {
  requireOperator(context);
  const file = context.multipart;
  if (!file) throw validation('A file is required.', { file: 'A file is required.' });
  if (!storageAvailable()) {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
  const set = await setFromFile(file.bytes.toString('utf8'));
  await putObject(objectKeys.configSet(set.number), file.bytes, 'application/json');
  return created({ set: setJson(set) });
});

route('POST', '/api/config-sets/:id/commit', async (context, params) => {
  requireOperator(context);
  const set = await loadSet(params.id);
  if (!set) throw notFound();
  const choices = (context.body.choices ?? {}) as Record<string, Choice>;
  const outcome = await commitSet(set, choices);
  publish({ topic: 'config-sets', event: 'committed', data: { number: set.number, applied: outcome.applied } });
  return ok({ set: setJson(outcome.set), applied: outcome.applied });
});

route('POST', '/api/config-sets/:id/backout', async (context, params) => {
  requireOperator(context);
  const set = await loadSet(params.id);
  if (!set) throw notFound();
  const after = await backOutSet(set);
  publish({ topic: 'config-sets', event: 'backed_out', data: { number: set.number } });
  return ok({ set: setJson(after) });
});

route('GET', '/api/storage', async (context) => {
  requireCaller(context);
  const rows = await query<{ n: string }>(
    `SELECT count(*) AS n FROM attachment WHERE status = 'queued'`,
  );
  return ok({
    storage: storageAvailable() ? 'available' : 'unavailable',
    queued_uploads: Number(rows[0]?.n ?? 0),
  });
});

export { csvOf, runList, writeCondition, settings, iso, transaction };
