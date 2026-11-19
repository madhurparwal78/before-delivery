import { Router } from 'express';
import { buildCsv, buildCsvRow, buildJsonLines, parseCsvRecords } from '../../shared/csv';
import { AppError, importFailed, invalidField, notFound, tooManyLines } from '../../shared/errors';
import {
  MISSING_HEADER_ROW,
  NOT_AN_OBJECT,
  NOT_VALID_JSON,
  cellCountMessage,
  conflictingHeaderMessage,
  documentMessage,
  duplicateHeaderMessage,
} from '../../shared/messages';
import { validateFilter } from '../../shared/filter';
import { validateSort } from '../../shared/sort';
import { runQueryAll } from '../../shared/queryRun';
import { DocObject, fromJson, isPlainObject } from '../../shared/values';
import { Validator } from '../../shared/validator';
import { collectionAccess, isUuid, projectAccess, requireUser, requireWriter } from '../access';
import {
  LineDocument,
  collectionValidator,
  insertDocumentBatch,
  listIndexes,
  loadDocuments,
  newId,
  prepareDocument,
} from '../collectionStore';
import { config } from '../config';
import { query, queryOne } from '../db';
import { body, handler, rawBody } from '../httpUtil';
import { getObject, putObject } from '../storage';
import { formatTime } from '../time';

export const fileRoutes = Router();

const PATH = '/projects/:pid/collections/:cid';

function describeError(validator: Validator | null): (error: AppError) => string {
  return (error) => documentMessage(error.code, error.extras, validator) ?? error.code;
}

function jsonLineEntries(text: string, validator: Validator | null): LineDocument[] {
  const describe = describeError(validator);
  const lines = text.split('\n');
  const entries: LineDocument[] = [];
  lines.forEach((rawLine, position) => {
    const line = position + 1;
    const content = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (content.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch {
      entries.push({ line, message: NOT_VALID_JSON });
      return;
    }
    const value = fromJson(parsed);
    if (!isPlainObject(value)) {
      entries.push({ line, message: NOT_AN_OBJECT });
      return;
    }
    try {
      entries.push({ line, doc: prepareDocument(value, validator, true) });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      entries.push({ line, message: describe(error) });
    }
  });
  return entries;
}

function headerProblem(headers: string[]): string | null {
  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) return duplicateHeaderMessage(header);
    seen.add(header);
  }
  for (const header of headers) {
    for (const other of headers) {
      if (other !== header && other.startsWith(`${header}.`)) return conflictingHeaderMessage(header);
    }
  }
  return null;
}

/** Data lines are the non-blank lines, without the CSV header. */
function dataLineCount(text: string, format: 'jsonl' | 'csv'): number {
  if (format === 'jsonl') return text.split('\n').filter((line) => line.trim().length > 0).length;
  return Math.max(0, parseCsvRecords(text).length - 1);
}

function csvEntries(text: string, validator: Validator | null): LineDocument[] {
  const describe = describeError(validator);
  const records = parseCsvRecords(text);
  if (records.length === 0) return [{ line: 1, message: MISSING_HEADER_ROW }];
  const headers = records[0].cells;
  const problem = headerProblem(headers);
  if (problem) return [{ line: records[0].line, message: problem }];
  const entries: LineDocument[] = [];
  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length) {
      entries.push({ line: record.line, message: cellCountMessage(record.cells.length, headers.length) });
      continue;
    }
    const doc = buildCsvRow({} as DocObject, headers, record.cells);
    try {
      entries.push({ line: record.line, doc: prepareDocument(doc, validator, true) });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      entries.push({ line: record.line, message: describe(error) });
    }
  }
  return entries;
}

interface ImportRow {
  id: string;
  file_name: string;
  format: string;
  state: string;
  bytes: number;
  inserted: number;
  errors: string;
  created_at: Date;
}

function importBody(row: ImportRow): Record<string, unknown> {
  return {
    id: row.id,
    file_name: row.file_name,
    format: row.format,
    state: row.state,
    bytes: row.bytes,
    inserted: row.inserted,
    errors: JSON.parse(row.errors) as unknown,
    created_at: formatTime(row.created_at),
  };
}

fileRoutes.post(
  `${PATH}/imports`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    requireWriter(access.role);
    const format = req.query['format'];
    if (format !== 'jsonl' && format !== 'csv') throw invalidField('format');
    const bytes = rawBody(req);
    const headerName = req.headers['x-file-name'];
    const fileName = typeof headerName === 'string' && headerName.length > 0 ? headerName : `upload.${format}`;
    const importId = newId();
    await query(
      "insert into imports (id, collection_id, file_name, format, state, bytes) values ($1, $2, $3, $4, 'uploading', $5)",
      [importId, access.collection.id, fileName, format, bytes.length],
    );
    try {
      await putObject(`imports/${importId}`, bytes, 'application/octet-stream');
    } catch (error) {
      await query("update imports set state = 'refused' where id = $1", [importId]);
      throw error;
    }
    await query("update imports set state = 'stored' where id = $1", [importId]);
    await query("update imports set state = 'parsing' where id = $1", [importId]);

    const validator = collectionValidator(access.collection);
    const text = bytes.toString('utf8');
    if (dataLineCount(text, format) > config.limits.importMaxLines) {
      await query("update imports set state = 'finished', inserted = 0, errors = '[]' where id = $1", [importId]);
      throw tooManyLines(config.limits.importMaxLines);
    }
    const entries = format === 'jsonl' ? jsonLineEntries(text, validator) : csvEntries(text, validator);
    const outcome = await insertDocumentBatch(access.collection, entries, describeError(validator));
    await query("update imports set state = 'finished', inserted = $2, errors = $3 where id = $1", [
      importId,
      outcome.inserted,
      JSON.stringify(outcome.errors),
    ]);
    if (outcome.errors.length > 0) throw importFailed(importId, outcome.errors);
    res.status(201).json({ import_id: importId, inserted: outcome.inserted });
  }),
);

fileRoutes.get(
  `${PATH}/imports`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const rows = await query<ImportRow>(
      `select id, file_name, format, state, bytes, inserted, errors, created_at
       from imports where collection_id = $1 order by created_at desc, id desc`,
      [access.collection.id],
    );
    res.json({ imports: rows.map(importBody) });
  }),
);

fileRoutes.get(
  `${PATH}/imports/:iid`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    if (!isUuid(req.params.iid)) throw notFound();
    const row = await queryOne<ImportRow>(
      `select id, file_name, format, state, bytes, inserted, errors, created_at
       from imports where id = $1 and collection_id = $2`,
      [req.params.iid, access.collection.id],
    );
    if (!row) throw notFound();
    res.json(importBody(row));
  }),
);

fileRoutes.get(
  `${PATH}/imports/:iid/original`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    if (!isUuid(req.params.iid)) throw notFound();
    const row = await queryOne<ImportRow>(
      `select id, file_name, format, state, bytes, inserted, errors, created_at
       from imports where id = $1 and collection_id = $2`,
      [req.params.iid, access.collection.id],
    );
    if (!row) throw notFound();
    const bytes = await getObject(`imports/${row.id}`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name.replace(/"/g, '')}"`);
    res.status(200).end(bytes);
  }),
);

fileRoutes.post(
  `${PATH}/exports`,
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await collectionAccess(user.id, req.params.pid, req.params.cid);
    const fields = body(req);
    const format = fields['format'];
    if (format !== 'jsonl' && format !== 'csv') throw invalidField('format');
    const filter = validateFilter(fields['filter'] === undefined ? {} : fromJson(fields['filter']));
    const sort = validateSort(fields['sort'] === undefined ? null : fromJson(fields['sort']));
    const docs = await loadDocuments(access.collection.id);
    const indexes = await listIndexes(access.collection.id);
    const matches = runQueryAll(docs, filter, sort, indexes, { scanLimit: config.limits.scanLimit });
    const text = format === 'jsonl' ? buildJsonLines(matches) : buildCsv(matches);
    const exportId = newId();
    const key = `exports/${exportId}.${format}`;
    await putObject(key, Buffer.from(text, 'utf8'), format === 'csv' ? 'text/csv' : 'application/x-ndjson');
    await query(
      'insert into exports (id, project_id, collection_id, format, file_name, object_key) values ($1, $2, $3, $4, $5, $6)',
      [exportId, access.project.id, access.collection.id, format, `${access.collection.name}.${format}`, key],
    );
    res.status(201).json({
      export_id: exportId,
      download_url: `/api/projects/${access.project.id}/exports/${exportId}`,
    });
  }),
);

fileRoutes.get(
  '/projects/:pid/exports/:eid',
  handler(async (req, res) => {
    const user = await requireUser(req);
    const access = await projectAccess(user.id, req.params.pid);
    if (!isUuid(req.params.eid)) throw notFound();
    const row = await queryOne<{ id: string; format: string; file_name: string; object_key: string }>(
      'select id, format, file_name, object_key from exports where id = $1 and project_id = $2',
      [req.params.eid, access.project.id],
    );
    if (!row) throw notFound();
    const bytes = await getObject(row.object_key);
    res.setHeader('Content-Type', row.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
    res.status(200).end(bytes);
  }),
);
