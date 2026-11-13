// The operations of a version's latest OpenAPI import.

import { db, one } from '../db';
import { parseOpenApi, type Operation } from './openapi';

interface ImportRow {
  id: string;
  fileName: string;
  bytes: number;
  sha256: string;
  s3Key: string;
  document: string;
  importedAt: Date;
}

export const latestImport = (versionId: string): Promise<ImportRow | null> =>
  one<ImportRow>(
    db,
    'select id, file_name, bytes, sha256, s3_key, document, imported_at from openapi_imports where version_id = $1 order by imported_at desc, id desc limit 1',
    [versionId],
  );

export async function findOperation(versionId: string, operationId: string): Promise<Operation | null> {
  const row = await latestImport(versionId);
  return row === null ? null : (parseOpenApi(row.document).find((operation) => operation.operationId === operationId) ?? null);
}
