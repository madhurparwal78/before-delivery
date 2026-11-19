/**
 * Record endpoints: lists, create, read, save, transition, notes, activity,
 * audit, bulk, priority override, assignment, attachments and search.
 */

import { randomUUID } from 'node:crypto';

import { iso, now, nowMs } from '../clock';
import { settings, withThousands } from '../config';
import { query, transaction } from '../db';
import { ApiError, forbidden, notFound, operatorOnly, validation } from '../errors';
import { canReadField } from '../domain/access';
import { fieldSpec, tableFields, tableNames, type TableName } from '../domain/fields';
import { inAudience, rankArticles } from '../domain/knowledge';
import { localDate } from '../domain/zone';
import {
  requireCaller,
  requireOperator,
  requireRoles,
  type RequestContext,
} from '../http/context';
import { Engine, type Caller } from '../services/engine';
import { exportRows, requireReadablePath, runList } from '../services/lists';
import { publish } from '../services/live';
import { slaJson } from '../services/slaservice';
import {
  addEntry,
  createRecord,
  patchRecord,
  recordJson,
  recordSummary,
  transitionRecord,
  applyAssignmentRules,
  type FieldSave,
} from '../services/recordops';
import { loadArticles, loadRecord, type RecordRow } from '../services/store';
import {
  getObject,
  objectKeys,
  putObject,
  storageAvailable,
  StorageFailure,
} from '../services/storage';
import { created, noContent, ok, route, type RouteResult } from './router';

function asTable(name: string): TableName {
  if (!(tableNames as readonly string[]).includes(name)) throw notFound();
  return name as TableName;
}

async function engineFor(context: RequestContext): Promise<{ engine: Engine; caller: Caller }> {
  const caller = requireCaller(context);
  const engine = await Engine.load(caller.workspace);
  return { engine, caller };
}

/** Reads `{"<field>":{"value":..,"version":..}}`. */
function readFieldSaves(raw: unknown): Record<string, FieldSave> {
  const out: Record<string, FieldSave> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)) {
      const entry = value as { value: unknown; version?: unknown };
      out[name] = { value: entry.value, version: Number(entry.version ?? 1) };
    } else {
      out[name] = { value, version: 1 };
    }
  }
  return out;
}

route('GET', '/api/tables/:table/records', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const table = asTable(params.table);
  const search = context.url.searchParams;
  const columns = search.get('columns');
  const result = runList(engine, caller, {
    table,
    filter: search.get('filter') ?? undefined,
    q: search.get('q') ?? undefined,
    sort: search.get('sort') ?? undefined,
    dir: search.get('dir') === 'desc' ? 'desc' : 'asc',
    page: Number(search.get('page') ?? 1),
    groupBy: search.get('group_by') ?? undefined,
    columns: columns ? columns.split(',').filter((c) => c.length > 0) : undefined,
  });
  const summaries = await Promise.all(
    result.records.map(async (record) => recordSummary(engine, caller, record, await engine.slasOf(record))),
  );
  const body: Record<string, unknown> = {
    records: summaries,
    total: result.total,
    page: result.page,
    page_size: result.pageSize,
  };
  if (result.groups) body.groups = result.groups;
  return ok(body);
});

route('POST', '/api/tables/:table/records', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const table = asTable(params.table);
  const fields = (context.body.fields ?? {}) as Record<string, unknown>;
  const result = await createRecord(engine, caller, { table, fields });
  return created({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('GET', '/api/records/:number', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  return ok({ record: await recordJson(engine, caller, record, await engine.slasOf(record)) });
});

route('PATCH', '/api/records/:number', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  engine.requireVisible(caller, params.number);
  const result = await patchRecord(engine, caller, params.number, {
    fields: readFieldSaves(context.body.fields),
  });
  return ok({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('POST', '/api/records/:number/transition', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  engine.requireVisible(caller, params.number);
  const to = String(context.body.to ?? '');
  const result = await transitionRecord(engine, caller, params.number, to, readFieldSaves(context.body.fields));
  return ok({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('POST', '/api/records/:number/work-notes', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  // Work notes are for desk roles only.
  if (!caller.roles.includes('operator') && !caller.roles.includes('technician')) throw forbidden();
  engine.requireVisible(caller, params.number);
  const text = String(context.body.text ?? '');
  if (text.length < 1 || text.length > 10_000) {
    throw validation('A note needs 1 to 10,000 characters.', { text: 'A note needs 1 to 10,000 characters.' });
  }
  const entry = await addEntry(engine, caller, params.number, 'work_note', text);
  return created({ entry: { ...entry, kind: 'work_note', text } });
});

route('POST', '/api/records/:number/comments', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  const text = String(context.body.text ?? '');
  if (text.length < 1 || text.length > 10_000) {
    throw validation('A comment needs 1 to 10,000 characters.', {
      text: 'A comment needs 1 to 10,000 characters.',
    });
  }
  const entry = await addEntry(engine, caller, params.number, 'comment', text);
  // A comment from the caller on an incident awaiting them resumes the work.
  if (
    record.table === 'incident' &&
    record.state === 'on_hold' &&
    record.fields.hold_reason === 'awaiting_requester' &&
    record.fields.caller === caller.username
  ) {
    await transitionRecord(engine, { ...caller, roles: ['operator'] }, params.number, 'in_progress');
  }
  return created({ entry: { ...entry, kind: 'comment', text } });
});

route('GET', '/api/records/:number/activity', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  const deskRole = caller.roles.includes('operator') || caller.roles.includes('technician');
  const rows = await query<{
    at: Date;
    actor: string | null;
    acting_for: string | null;
    kind: string;
    text: string;
  }>(`SELECT at, actor, acting_for, kind, text FROM record_activity WHERE number = $1 ORDER BY id DESC`, [
    record.number,
  ]);
  const readable = new Set(engine.readableFieldNames(caller, record));
  return ok({
    entries: rows
      .filter((r) => deskRole || r.kind !== 'work_note')
      // An activity line about a denied field is left out.
      .filter((r) => r.kind !== 'field' || readable.has(r.text.split(' ')[0]))
      .map((r) => ({
        at: iso(r.at),
        actor: r.actor,
        acting_for: r.acting_for,
        kind: r.kind,
        text: r.text,
      })),
  });
});

route('GET', '/api/records/:number/audit', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const record = engine.requireVisible(caller, params.number);
  const readable = new Set([...engine.readableFieldNames(caller, record), 'state']);
  const rows = await query<{
    at: Date;
    actor: string | null;
    acting_for: string | null;
    field: string;
    before_value: unknown;
    after_value: unknown;
    reason: string | null;
  }>(
    `SELECT at, actor, acting_for, field, before_value, after_value, reason
     FROM record_audit WHERE number = $1 ORDER BY id DESC`,
    [record.number],
  );
  return ok({
    entries: rows
      .filter((r) => readable.has(r.field))
      .map((r) => ({
        at: iso(r.at),
        actor: r.actor,
        acting_for: r.acting_for,
        field: r.field,
        before: r.before_value,
        after: r.after_value,
        reason: r.reason,
      })),
  });
});

route('POST', '/api/records/bulk', async (context) => {
  const { engine, caller } = await engineFor(context);
  const numbers = Array.isArray(context.body.numbers) ? context.body.numbers.map(String) : [];
  const fields = (context.body.fields ?? {}) as Record<string, unknown>;
  const results: { number: string; ok: boolean; message?: string }[] = [];
  for (const number of numbers) {
    try {
      const record = engine.records.get(number);
      if (!record) throw notFound();
      const saves: Record<string, FieldSave> = {};
      for (const [name, value] of Object.entries(fields)) {
        saves[name] = { value, version: record.versions[name] ?? 1 };
      }
      await patchRecord(engine, caller, number, { fields: saves });
      results.push({ number, ok: true });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Something went wrong.';
      results.push({ number, ok: false, message });
    }
  }
  return ok({ results });
});

route('POST', '/api/records/:number/priority-override', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const record = engine.requireVisible(caller, params.number);
  const priority = Number(context.body.priority ?? 0);
  const reason = String(context.body.reason ?? '');
  if (!Number.isInteger(priority) || priority < 1 || priority > 5) {
    throw validation('Priority must be 1 to 5.', { priority: 'Priority must be 1 to 5.' });
  }
  if (reason.length < 1 || reason.length > 500) {
    throw validation('A reason needs 1 to 500 characters.', { reason: 'A reason needs 1 to 500 characters.' });
  }
  const result = await patchRecord(engine, caller, record.number, {
    fields: {
      priority: { value: priority, version: record.versions.priority ?? 1 },
      priority_overridden: { value: true, version: record.versions.priority_overridden ?? 1 },
    },
    reason,
  });
  return ok({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('DELETE', '/api/records/:number/priority-override', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireOperator(context);
  const record = engine.requireVisible(caller, params.number);
  const result = await patchRecord(engine, caller, record.number, {
    fields: {
      priority_overridden: { value: false, version: record.versions.priority_overridden ?? 1 },
    },
  });
  return ok({ record: await recordJson(engine, caller, result.record, result.slas) });
});

route('POST', '/api/records/:number/assign-by-rules', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  requireRoles(context, ['operator', 'technician']);
  const record = engine.requireVisible(caller, params.number);
  const updated = await transaction((client) => applyAssignmentRules(client, engine, record));
  return ok({ record: await recordJson(engine, caller, updated, await engine.slasOf(updated)) });
});

route('GET', '/api/records/:number/sla', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  const slas = await engine.slasOf(record);
  return ok({ slas: slas.map(slaJson) });
});

const allowedTypes: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  pdf: 'application/pdf',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
};

route('POST', '/api/records/:number/attachments', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const record = engine.requireVisible(caller, params.number);
  const file = context.multipart;
  if (!file) throw validation('A file is required.', { file: 'A file is required.' });

  const extension = (file.fileName.split('.').pop() ?? '').toLowerCase();
  const expected = allowedTypes[extension];
  if (!expected || (file.contentType !== expected && file.contentType !== 'application/octet-stream')) {
    throw new ApiError(
      422,
      'bad_type',
      'Switchyard accepts PNG, JPEG, PDF, TXT, LOG and CSV files.',
    );
  }
  const max = settings().ATTACHMENT_MAX_BYTES;
  if (file.bytes.length > max) {
    throw new ApiError(413, 'too_large', `Files can be at most ${withThousands(max)} bytes.`);
  }
  const quota = settings().ATTACHMENT_QUOTA_BYTES;
  const used = Number(
    (
      await query<{ total: string }>(
        `SELECT coalesce(sum(bytes), 0) AS total FROM attachment WHERE uploaded_by = $1`,
        [caller.username],
      )
    )[0]?.total ?? 0,
  );
  if (used + file.bytes.length > quota) {
    throw new ApiError(
      422,
      'over_quota',
      `This upload would take you past your ${withThousands(quota)}-byte attachment quota.`,
    );
  }

  const id = randomUUID();
  const key = objectKeys.attachment(record.number, id, file.fileName);
  let status: 'stored' | 'queued' = 'stored';
  if (!storageAvailable()) {
    status = 'queued';
  } else {
    try {
      await putObject(key, file.bytes, expected);
    } catch (e) {
      if (!(e instanceof StorageFailure)) throw e;
      status = 'queued';
    }
  }
  await query(
    `INSERT INTO attachment (id, number, name, bytes, content_type, status, object_key,
                             uploaded_by, queued_bytes, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      record.number,
      file.fileName,
      file.bytes.length,
      expected,
      status,
      key,
      caller.username,
      status === 'queued' ? file.bytes : null,
      now(),
    ],
  );
  publish({
    topic: `record:${record.number}`,
    event: 'attachment',
    data: { id, name: file.fileName, status },
  });
  const body = {
    attachment: { id, name: file.fileName, bytes: file.bytes.length, type: expected, status },
  };
  return status === 'stored' ? created(body) : { status: 202, body };
});

route('GET', '/api/attachments/:id', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  const row = (
    await query<{ number: string; name: string; content_type: string; status: string; object_key: string }>(
      `SELECT number, name, content_type, status, object_key FROM attachment WHERE id = $1`,
      [params.id],
    )
  )[0];
  if (!row) throw notFound();
  engine.requireVisible(caller, row.number);
  if (row.status !== 'stored') {
    throw new ApiError(409, 'not_stored', 'This file is still waiting for storage.');
  }
  try {
    const object = await getObject(row.object_key);
    return { status: 200, bytes: object.body, contentType: row.content_type };
  } catch {
    throw new ApiError(503, 'storage_unavailable', 'File storage is unreachable. Try again when it returns.');
  }
});

route('GET', '/api/search', async (context) => {
  const { engine, caller } = await engineFor(context);
  const q = (context.url.searchParams.get('q') ?? '').trim();
  const records: RecordRow[] = [];
  for (const table of tableNames) {
    const result = runList(engine, caller, { table, q, page: 1 });
    records.push(...result.records);
    for (let page = 2; records.length < 40 && (page - 1) * result.pageSize < result.total; page += 1) {
      records.push(...runList(engine, caller, { table, q, page }).records);
    }
  }
  const summaries = await Promise.all(
    records
      .sort((a, b) => (a.number < b.number ? -1 : 1))
      .slice(0, 20)
      .map(async (record) => recordSummary(engine, caller, record, await engine.slasOf(record))),
  );
  const today = localDate(engine.businessZone, engine.at);
  const articles = (await loadArticles())
    .filter((a) => a.state === 'published')
    .filter((a) => inAudience(a, caller.roles, caller.department))
    .filter((a) => a.validUntil === null || a.validUntil >= today);
  return ok({
    records: summaries,
    articles: rankArticles(articles, q)
      .slice(0, 10)
      .map(({ article, score }) => ({
        number: article.number,
        title: article.title,
        score,
        valid_until: article.validUntil,
      })),
  });
});

route('GET', '/api/presence/:number', async (context, params) => {
  const { engine, caller } = await engineFor(context);
  engine.requireVisible(caller, params.number);
  const cutoff = new Date(nowMs() - settings().PRESENCE_TIMEOUT_SECONDS * 1000);
  const rows = await query<{ username: string }>(
    `SELECT username FROM presence WHERE number = $1 AND seen_at > $2 ORDER BY username`,
    [params.number, cutoff],
  );
  return ok({
    viewing: rows
      .filter((r) => r.username !== caller.username)
      .map((r) => ({ username: r.username, display_name: engine.displayName(r.username) })),
  });
});

export { exportRows, requireReadablePath, tableFields, fieldSpec, canReadField };
