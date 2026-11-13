import { Deps, inWriteTx, inReadTx, DocumentRow } from '../store.js';
import { ApiError, messages } from '../api/errors.js';
import { fieldCopy } from '../api/copy.js';
import { ObjectStore, StorageDown, detectContentType, extFor, DetectedType } from '../storage/s3.js';
import { sha256Hex, newId } from '../domain/crypto.js';

export const MAX_FILE_BYTES = 5_000_000;

export interface UploadInput {
  kind: 'insurance_certificate' | 'food_handler_card';
  expiresOn: string;
  perOccurrenceLimit: number | null;
  additionalInsured: boolean | null;
  bytes: Uint8Array;
}

export async function uploadDocument(
  deps: Deps, store: ObjectStore, tenantId: string, input: UploadInput,
): Promise<DocumentRow> {
  // The object is stored first; the document row is written only once the
  // object is stored.
  const type = detectContentType(input.bytes);
  if (type === null) throw new ApiError(422, 'validation_failed', fieldCopy.fileType, { file: fieldCopy.fileType });
  if (input.bytes.length > MAX_FILE_BYTES) throw new ApiError(422, 'validation_failed', fieldCopy.fileSize, { file: fieldCopy.fileSize });

  const docId = newId();
  const key = `tenants/${tenantId}/documents/${docId}.${extFor(type)}`;
  try {
    await store.put(key, input.bytes, type);
  } catch (e) {
    if (e instanceof StorageDown) throw new ApiError(503, 'storage_unavailable', 'Document storage is unreachable. Nothing was saved; try again shortly.');
    throw e;
  }

  return inWriteTx(deps, async (tx, now) => {
    const hash = sha256Hex(input.bytes);
    await tx.query(
      `INSERT INTO documents (id, tenant_id, kind, expires_on, per_occurrence_limit, additional_insured, content_type, size_bytes, sha256, has_file, uploaded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10)`,
      [docId, tenantId, input.kind, input.expiresOn, input.perOccurrenceLimit, input.additionalInsured, type, input.bytes.length, hash, now],
    );
    const r = await tx.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [docId]);
    return r.rows[0];
  });
}

export async function readDocumentFile(deps: Deps, store: ObjectStore, doc: DocumentRow): Promise<{ bytes: Uint8Array; contentType: string }> {
  const ext = doc.content_type === 'image/png' ? 'png' : doc.content_type === 'image/jpeg' ? 'jpg' : 'pdf';
  void deps;
  try {
    const bytes = await store.get(`tenants/${doc.tenant_id}/documents/${doc.id}.${ext}`);
    if (bytes === null) throw new ApiError(404, 'file_not_found', "That record isn't available.");
    return { bytes, contentType: doc.content_type ?? 'application/octet-stream' };
  } catch (e) {
    if (e instanceof StorageDown) throw new ApiError(503, 'storage_unavailable', messages.storageReadUnavailable);
    throw e;
  }
}

export function detectedTypeOf(bytes: Uint8Array): DetectedType | null {
  return detectContentType(bytes);
}

export async function loadDocumentForCaller(deps: Deps, callerTenantId: string | null, role: string, docId: string): Promise<DocumentRow | null> {
  return inReadTx(deps, async (tx) => {
    const r = await tx.query<DocumentRow>(`SELECT * FROM documents WHERE id=$1`, [docId]);
    const doc = r.rows[0];
    if (!doc) return null;
    if (role === 'tenant' && doc.tenant_id !== callerTenantId) return null;
    return doc;
  });
}
