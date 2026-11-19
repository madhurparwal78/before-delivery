/**
 * Exports: one place builds the CSV, neutralises text, stores the snapshot
 * and verifies it again on download. The edit order is never held while
 * storage runs.
 */
import { createHash } from 'node:crypto';
import { PoolClient } from 'pg';
import { DocState, View, newId } from './docstate.js';
import { evaluateDoc, nodeKey } from './evaluator.js';
import { Storage, StorageError, objectKey } from './storage.js';
import { ApiError } from '../shared/errors.js';
import { Access, Person, viewFor } from './access.js';
import { Database } from './db.js';
import { apiColumns } from './names.js';

const CRLF = '\r\n';

/** RFC 4180 quoting: wrap fields containing comma, quote, CR or LF. */
export function csvField(text: string): string {
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Neutralise a text-origin value that could be read as a formula. */
export function neutralise(value: string): string {
  const first = value.codePointAt(0);
  if (
    first === 0x3d || // =
    first === 0x2b || // +
    first === 0x2d || // -
    first === 0x40 || // @
    first === 0x09 || // tab
    first === 0x0d // CR
  ) {
    return `'${value}`;
  }
  return value;
}

/** Whether a CSV value has text origin and needs neutralising. */
function textOriginCell(
  state: DocState,
  tableId: string,
  kind: string,
  display: string,
  value: unknown,
): boolean {
  if (kind === 'text') return true;
  if (kind === 'reference' && typeof value === 'string') {
    const target = state.rows.get(value);
    if (!target || target.deleted) return false;
    const disp = state.displayColumn(target.tableId);
    if (!disp) return false;
    return disp.type === 'text';
  }
  return false;
}

/** Build the CSV bytes for one table in one view, at one point in the order. */
export function buildCsv(state: DocState, view: View, tableId: string): Buffer {
  const ev = evaluateDoc(state, view);
  const table = state.tableById(tableId);
  if (!table) throw new ApiError(404, 'not_found', 'Not found.');
  const columns = apiColumns(state, tableId);
  const lines: string[] = [];
  lines.push(columns.map((c) => csvField(neutralise(c.name))).join(','));
  const rows: { id: string; cells: Map<string, { kind: string; display: string; value: unknown }> }[] = [];
  if (table.kind === 'summary') {
    for (const group of ev.groups.get(tableId) ?? []) {
      rows.push({
        id: group.rowId,
        cells: new Map(
          columns.map((c) => {
            const computed = group.cells.get(c.id);
            const sourceCol = table.sourceTableId ? state.columnOf(table.sourceTableId, c.id) : undefined;
            let kind = computed?.kind ?? 'blank';
            let value: unknown = null;
            if (sourceCol?.type === 'reference') {
              const part = group.key[table.groupBy.indexOf(c.id)];
              if (part && part.startsWith('ref\u0000')) {
                kind = 'reference';
                value = part.slice(4);
              }
            }
            return [c.id, { kind, display: computed?.display ?? '', value }];
          }),
        ),
      });
    }
  } else {
    for (const row of view.visibleRows(tableId, state)) {
      rows.push({
        id: row.id,
        cells: new Map(
          columns.map((c) => {
            if (c.type === 'formula' || c.type === 'reference') {
              const computed = ev.cells.get(nodeKey(row.id, c.id));
              const value = c.type === 'reference' ? state.cell(row.id, c.id)?.value ?? null : null;
              return [c.id, { kind: computed?.kind ?? 'blank', display: computed?.display ?? '', value }];
            }
            const cell = state.cell(row.id, c.id);
            const kind = cell?.value === null || cell === undefined ? 'blank' : c.type === 'text' ? 'text' : c.type === 'decimal' ? 'decimal' : c.type === 'date' ? 'date' : 'bool';
            return [c.id, { kind, display: cell?.value ?? '', value: cell?.value ?? null }];
          }),
        ),
      });
    }
  }
  for (const row of rows) {
    const fields = columns.map((c) => {
      const cell = row.cells.get(c.id)!;
      if (cell.display === '') return '';
      if (cell.kind === 'text' || textOriginCell(state, tableId, cell.kind, cell.display, cell.value)) {
        return csvField(neutralise(cell.display));
      }
      return csvField(cell.display);
    });
    lines.push(fields.join(','));
  }
  return Buffer.from(lines.join(CRLF) + CRLF, 'utf8');
}

export interface ExportRecord {
  id: string;
  table_id: string;
  file_name: string;
  status: 'writing' | 'ready' | 'failed';
  byte_size: number | null;
  sha256: string | null;
  download_url: string | null;
  created_by: string;
  document_revision: number;
  created_at: string;
}

interface ExportRow {
  id: string;
  table_id: string;
  file_name: string;
  status: string;
  byte_size: string | null;
  sha256: string | null;
  created_by: string;
  document_revision: number;
  created_at: Date;
}

const toRecord = (r: ExportRow): ExportRecord => ({
  id: r.id,
  table_id: r.table_id,
  file_name: r.file_name,
  status: r.status as ExportRecord['status'],
  byte_size: r.byte_size === null ? null : parseInt(r.byte_size, 10),
  sha256: r.sha256,
  download_url: r.status === 'ready' ? `/api/exports/${r.id}/download` : null,
  created_by: r.created_by,
  document_revision: r.document_revision,
  created_at: r.created_at.toISOString(),
});

async function insertExport(
  client: PoolClient,
  documentId: string,
  tableId: string,
  fileName: string,
  personId: string,
  documentRevision: number,
): Promise<string> {
  const id = newId();
  await client.query(
    `INSERT INTO exports (id, document_id, table_id, file_name, status, created_by, document_revision)
     VALUES ($1, $2, $3, $4, 'writing', $5, $6)`,
    [id, documentId, tableId, fileName, personId, documentRevision],
  );
  return id;
}

export async function getExport(client: PoolClient, exportId: string): Promise<ExportRecord | null> {
  const r = await client.query<ExportRow>(
    'SELECT id, table_id, file_name, status, byte_size, sha256, created_by, document_revision, created_at FROM exports WHERE id = $1',
    [exportId],
  );
  return r.rows[0] ? toRecord(r.rows[0]) : null;
}

export async function listExports(
  client: PoolClient,
  documentId: string,
  personId: string,
): Promise<ExportRecord[]> {
  const r = await client.query<ExportRow>(
    `SELECT id, table_id, file_name, status, byte_size, sha256, created_by, document_revision, created_at
     FROM exports WHERE document_id = $1 AND created_by = $2 ORDER BY created_at DESC, id DESC`,
    [documentId, personId],
  );
  return r.rows.map(toRecord);
}

/**
 * Run one export: read the table at one point in the edit order, store the
 * file, verify its byte size and SHA-256, then mark the record ready or
 * failed. Storage calls run outside every transaction.
 */
export async function runExport(
  db: Database,
  storage: Storage,
  documentId: string,
  tableId: string,
  fileName: string,
  person: Person,
  access: Access,
): Promise<ExportRecord> {
  const { csv, revision, exportId } = await db.snapshot(async (client) => {
    const state = await DocState.load(client, documentId);
    const view = viewFor(person.email, access, state);
    const csv = buildCsv(state, view, tableId);
    const exportId = await insertExport(client, documentId, tableId, fileName, person.id, state.revision);
    return { csv, revision: state.revision, exportId };
  });
  void revision;
  const key = objectKey(documentId, exportId);
  let ready = false;
  let byteSize: number | null = null;
  let sha256: string | null = null;
  try {
    await storage.putObject(key, csv, 'text/csv; charset=utf-8');
    const readBack = await storage.getObject(key);
    const hash = createHash('sha256').update(readBack).digest('hex');
    if (readBack.length === csv.length && hash === createHash('sha256').update(csv).digest('hex')) {
      ready = true;
      byteSize = readBack.length;
      sha256 = hash;
    }
  } catch {
    ready = false;
  }
  await db.withClient(async (client) => {
    await client.query(
      'UPDATE exports SET status = $1, byte_size = $2, sha256 = $3 WHERE id = $4 AND status = $5',
      [ready ? 'ready' : 'failed', byteSize, sha256, exportId, 'writing'],
    );
  });
  const record = await db.withClient((client) => getExport(client, exportId));
  return record!;
}

/**
 * Serve a download: re-verify the stored bytes against the record, then
 * hand back exactly those bytes. 502 on any mismatch or missing object.
 */
export async function downloadExport(
  storage: Storage,
  documentId: string,
  exportId: string,
  record: ExportRecord,
): Promise<Buffer> {
  const key = objectKey(documentId, exportId);
  let bytes: Buffer;
  try {
    bytes = await storage.getObject(key);
  } catch (err) {
    if (err instanceof StorageError && err.missing) {
      throw new ApiError(502, 'export_corrupt', 'This file no longer matches what was exported.');
    }
    throw new ApiError(503, 'storage_unavailable', 'The file store is unreachable.');
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== record.byte_size || hash !== record.sha256) {
    throw new ApiError(502, 'export_corrupt', 'This file no longer matches what was exported.');
  }
  return bytes;
}

/**
 * The download Content-Disposition, plain ASCII on one line, with both the
 * ASCII filename and the RFC 5987 encoded name.
 */
export function contentDisposition(fileName: string): string {
  const ascii = [...fileName]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      const printable = code >= 0x20 && code <= 0x7e;
      return printable && ch !== '"' && ch !== '\\' ? ch : '_';
    })
    .join('');
  const safe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&+-.^_`|~';
  const encoded = Buffer.from(fileName, 'utf8')
    .toString('binary')
    .split('')
    .map((ch) => (safe.includes(ch) ? ch : `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
