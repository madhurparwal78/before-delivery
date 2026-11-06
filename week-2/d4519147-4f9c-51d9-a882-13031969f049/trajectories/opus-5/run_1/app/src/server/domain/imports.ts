import { createHash } from 'node:crypto';
import { newId } from '../crypto';
import { query, queryOne, withTransaction } from '../db';
import { HttpError, errors } from '../http/errors';
import { StorageUnavailable, confirmObject, putObject } from '../services/storage';
import type { ImportRecord } from '../../shared/types';
import { writeDiagramEvent } from './audit';
import { ImportRejected, buildImportedPage, importFileName } from './importer';
import type { DiagramAccess } from './access';
import type { SessionUser } from './sessions';

interface ImportRow {
  id: string;
  page_id: string;
  file_name: string;
  size_bytes: number;
  sha256: string;
  object_key: string;
  created_at: Date;
}

function toRecord(row: ImportRow): ImportRecord {
  return {
    id: row.id,
    pageId: row.page_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listImports(diagramId: string): Promise<ImportRecord[]> {
  const rows = await query<ImportRow>(
    `select id, page_id, file_name, size_bytes, sha256, object_key, created_at
     from imports where diagram_id = $1 order by seq desc`,
    [diagramId],
  );
  return rows.map(toRecord);
}

export async function loadImport(diagramId: string, importId: string): Promise<(ImportRecord & { objectKey: string }) | null> {
  const row = await queryOne<ImportRow>(
    `select id, page_id, file_name, size_bytes, sha256, object_key, created_at
     from imports where diagram_id = $1 and id = $2`,
    [diagramId, importId],
  );
  return row ? { ...toRecord(row), objectKey: row.object_key } : null;
}

export function originalObjectKey(diagramId: string, importId: string): string {
  return `imports/${diagramId}/${importId}/original`;
}

export function modelObjectKey(diagramId: string, importId: string): string {
  return `imports/${diagramId}/${importId}/model.json`;
}

const REJECTION_STATUS: Record<string, { status: number; code: string; message: string }> = {
  unsupported_file_type: {
    status: 415,
    code: 'unsupported_file_type',
    message: 'Only diagram XML and SVG files can be imported.',
  },
  invalid_model: { status: 422, code: 'invalid_model', message: 'This file does not describe a valid diagram.' },
  unsafe_file: {
    status: 422,
    code: 'unsafe_file',
    message: 'This file contains scripts, external entities or unsafe links.',
  },
};

/**
 * Keeps the uploaded bytes and the sanitized model in storage, confirms both,
 * and only then commits the new page and the import record.
 */
export async function createImport(
  user: SessionUser,
  access: DiagramAccess,
  file: { fileName: string; bytes: Buffer },
): Promise<ImportRecord> {
  const fileName = importFileName(file.fileName);
  const importId = newId();
  const pageId = newId();

  let model;
  try {
    model = buildImportedPage(file.bytes, pageId, fileName);
  } catch (error) {
    if (error instanceof ImportRejected) {
      const mapped = REJECTION_STATUS[error.reason];
      if (!mapped) throw errors.internal();
      await writeDiagramEvent(undefined, access.diagramId, user.email, 'import.rejected', {
        fileName,
        error: error.reason,
      });
      throw new HttpError(mapped.status, mapped.code, mapped.message);
    }
    throw error;
  }

  const sha256 = createHash('sha256').update(file.bytes).digest('hex');
  const originalKey = originalObjectKey(access.diagramId, importId);
  const modelKey = modelObjectKey(access.diagramId, importId);
  const modelBytes = Buffer.from(JSON.stringify(model.doc), 'utf8');
  try {
    await putObject(originalKey, file.bytes, 'application/octet-stream');
    await putObject(modelKey, modelBytes, 'application/json');
    const originalConfirmed = await confirmObject(originalKey, { sizeBytes: file.bytes.length, sha256 });
    const modelConfirmed = await confirmObject(modelKey, {
      sizeBytes: modelBytes.length,
      sha256: createHash('sha256').update(modelBytes).digest('hex'),
    });
    if (!originalConfirmed || !modelConfirmed) throw new StorageUnavailable('storage did not confirm the import');
  } catch (error) {
    if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
    throw error;
  }

  return withTransaction(async (client) => {
    await client.query(
      'insert into pages (id, diagram_id, name, version, doc, derived) values ($1, $2, $3, 1, $4, $5)',
      [pageId, access.diagramId, model.doc.name, JSON.stringify(model.doc), JSON.stringify(model.derived)],
    );
    await client.query(
      `insert into imports (id, diagram_id, page_id, file_name, size_bytes, sha256, object_key, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [importId, access.diagramId, pageId, fileName, file.bytes.length, sha256, originalKey, user.id],
    );
    await client.query('update diagrams set updated_at = now() where id = $1', [access.diagramId]);
    await writeDiagramEvent(client, access.diagramId, user.email, 'import.created', { importId, fileName, sha256 });
    const row = await client.query<ImportRow>(
      `select id, page_id, file_name, size_bytes, sha256, object_key, created_at from imports where id = $1`,
      [importId],
    );
    const created = row.rows[0];
    if (!created) throw errors.internal();
    return toRecord(created);
  });
}
