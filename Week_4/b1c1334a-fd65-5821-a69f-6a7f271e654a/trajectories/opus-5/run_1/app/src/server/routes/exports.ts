import type { ExportJson } from '../../shared/api.js';
import { buildCsv, contentDisposition } from '../csv.js';
import { newId, withClient, type Client } from '../db.js';
import { evaluateDocument } from '../evaluate.js';
import { exportCorrupt, exportNotReady, notFound, storageUnavailable } from '../errors.js';
import { documentAccess, loadDocument } from '../load.js';
import type { Viewer } from '../model.js';
import {
  getObject,
  objectKey,
  putObject,
  sha256OfBuffer,
  StorageMissing,
} from '../storage.js';
import { requireTable } from './helpers.js';
import type { Reply, RouteContext } from './types.js';

type ExportRow = {
  id: string;
  document_id: string;
  table_id: string;
  file_name: string;
  status: 'writing' | 'ready' | 'failed';
  byte_size: string | null;
  sha256: string | null;
  created_by: string;
  document_revision: number;
  created_at: Date;
};

function exportJson(row: ExportRow): ExportJson {
  const ready = row.status === 'ready';
  return {
    id: row.id,
    table_id: row.table_id,
    file_name: row.file_name,
    status: row.status,
    byte_size: ready && row.byte_size !== null ? Number(row.byte_size) : null,
    sha256: ready ? row.sha256 : null,
    download_url: ready ? `/api/exports/${row.id}/download` : null,
    created_by: row.created_by,
    document_revision: row.document_revision,
    created_at: row.created_at.toISOString(),
  };
}

const EXPORT_COLUMNS = `id, document_id, table_id, file_name, status, byte_size, sha256,
  created_by, document_revision, created_at`;

async function readExport(client: Client, id: string): Promise<ExportRow | null> {
  const result = await client.query<ExportRow>(
    `select ${EXPORT_COLUMNS} from exports where id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createExport(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  const viewer: Viewer = {
    id: context.account.id,
    email: context.account.email,
    role: access.role,
    rowScope: access.rowScope,
  };

  const client = context.client;
  await client.query('begin isolation level repeatable read');
  let snapshotBytes: Buffer;
  let exportId: string;
  let fileName: string;
  let revision: number;
  let tableId: string;
  try {
    const doc = await loadDocument(client, documentId);
    if (doc === null) throw notFound();
    const table = requireTable(doc, context.params['table']);
    const snapshot = evaluateDocument(doc, viewer);
    snapshotBytes = buildCsv(snapshot, table);
    fileName = `${table.name}.csv`;
    revision = doc.revision;
    tableId = table.id;
    exportId = newId('exp');
    await client.query(
      `insert into exports (id, document_id, table_id, file_name, status, created_by, document_revision)
       values ($1, $2, $3, $4, 'writing', $5, $6)`,
      [exportId, documentId, tableId, fileName, context.account.id, revision],
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  }

  const key = objectKey(documentId, exportId);
  const sha256 = sha256OfBuffer(snapshotBytes);
  let stored = false;
  try {
    await putObject(key, snapshotBytes);
    const readBack = await getObject(key);
    stored = readBack.length === snapshotBytes.length && sha256OfBuffer(readBack) === sha256;
  } catch {
    stored = false;
  }

  const finished = await withClient((fresh) =>
    fresh.query<ExportRow>(
      `update exports set status = $2, byte_size = $3, sha256 = $4 where id = $1
       returning ${EXPORT_COLUMNS}`,
      [
        exportId,
        stored ? 'ready' : 'failed',
        stored ? snapshotBytes.length : null,
        stored ? sha256 : null,
      ],
    ),
  );
  return { status: 201, body: { export: exportJson(finished.rows[0] as ExportRow) } };
}

export async function listExports(context: RouteContext): Promise<Reply> {
  const documentId = context.params['doc'] as string;
  const access = await documentAccess(context.client, documentId, context.account);
  if (access === null) throw notFound();
  const result = await context.client.query<ExportRow>(
    `select ${EXPORT_COLUMNS} from exports
     where document_id = $1 and created_by = $2 order by created_at desc, id desc`,
    [documentId, context.account.id],
  );
  return { status: 200, body: { exports: result.rows.map(exportJson) } };
}

export async function readExportRecord(context: RouteContext): Promise<Reply> {
  const record = await readExport(context.client, context.params['export'] as string);
  if (record === null || record.created_by !== context.account.id) throw notFound();
  return { status: 200, body: { export: exportJson(record) } };
}

export async function downloadExport(context: RouteContext): Promise<Reply> {
  const record = await readExport(context.client, context.params['export'] as string);
  if (record === null || record.created_by !== context.account.id) throw notFound();
  if (record.status !== 'ready') throw exportNotReady();
  let bytes: Buffer;
  try {
    bytes = await getObject(objectKey(record.document_id, record.id));
  } catch (error) {
    if (error instanceof StorageMissing) throw exportCorrupt();
    throw storageUnavailable();
  }
  if (
    bytes.length !== Number(record.byte_size) ||
    sha256OfBuffer(bytes) !== record.sha256
  ) {
    throw exportCorrupt();
  }
  return {
    status: 200,
    bytes,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': contentDisposition(record.file_name),
    },
  };
}
