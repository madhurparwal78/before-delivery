import type { BlobKind, BlobRecord } from '../../shared/types.js';
import { serverNow } from '../clock.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { loadBlob, loadReadableBlob, type BlobRow } from '../domain/access.js';
import {
  ApiError,
  conflict,
  invalidField,
  isUuidV4,
  notFound,
  readBody,
  sendJson,
  storageUnavailableError,
  type RequestContext,
} from '../http.js';
import {
  deleteObject,
  getObject,
  objectSize,
  putObject,
  StorageUnavailable,
} from '../storage.js';

const KINDS: BlobKind[] = ['image', 'file', 'photo'];

function blobRecord(row: BlobRow): BlobRecord {
  return { id: row.id, kind: row.kind, size: Number(row.size), state: row.state };
}

/**
 * Object storage must confirm the stored object at its declared size before a blob
 * may carry a letter or a profile.
 */
export async function confirmStoredBlob(ownerId: string, blobId: string): Promise<void> {
  const blob = await loadBlob(pool, blobId);
  let size: number | null;
  try {
    size = await objectSize(ownerId, blobId);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailableError();
    throw error;
  }
  if (size !== Number(blob.size)) throw conflict('attachment_not_stored');
}

export async function postBlob(ctx: RequestContext): Promise<void> {
  const id = ctx.body['id'];
  if (isUuidV4(id)) {
    const existing = await pool.query<BlobRow>('select * from blobs where id = $1', [id]);
    const row = existing.rows[0];
    if (row !== undefined) {
      const same =
        row.owner_id === ctx.accountId &&
        row.kind === ctx.body['kind'] &&
        Number(row.size) === ctx.body['size'];
      if (!same) throw conflict('blob_id_conflict');
      sendJson(ctx.res, 200, blobRecord(row));
      return;
    }
  }

  if (!isUuidV4(id)) throw invalidField('id', 'invalid');
  const kind = ctx.body['kind'];
  if (!KINDS.includes(kind as BlobKind)) throw invalidField('kind', 'unsupported');
  const size = ctx.body['size'];
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
    throw invalidField('size', 'invalid');
  }
  if (size > config.attachmentMaxBytes) throw new ApiError(413, 'too_large');

  await pool.query(
    `insert into blobs (id, owner_id, kind, size, state, created_at)
     values ($1, $2, $3, $4, 'uploading', $5)`,
    [id, ctx.accountId, kind, size, serverNow()],
  );
  sendJson(ctx.res, 201, {
    id,
    kind: kind as BlobKind,
    size,
    state: 'uploading',
  } satisfies BlobRecord);
}

export async function putBlobContent(ctx: RequestContext): Promise<void> {
  const blobId = ctx.params['id'] ?? '';
  if (!isUuidV4(blobId)) throw notFound();
  const blob = await loadBlob(pool, blobId);
  if (blob.owner_id !== ctx.accountId) throw notFound();
  if (blob.state === 'stored') throw conflict('already_stored');

  const declared = Number(blob.size);
  const body = await readBody(ctx.req, declared);
  if (body.length < declared) throw new ApiError(422, 'size_mismatch');

  try {
    await putObject(ctx.accountId, blobId, body);
    const stored = await objectSize(ctx.accountId, blobId);
    if (stored !== declared) {
      await deleteObject(ctx.accountId, blobId);
      throw storageUnavailableError();
    }
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailableError();
    throw error;
  }

  await pool.query("update blobs set state = 'stored' where id = $1", [blobId]);
  sendJson(ctx.res, 200, { id: blobId, kind: blob.kind, size: declared, state: 'stored' });
}

export async function getBlobContent(ctx: RequestContext): Promise<void> {
  const blobId = ctx.params['id'] ?? '';
  if (!isUuidV4(blobId)) throw notFound();
  const blob = await loadReadableBlob(pool, blobId, ctx.accountId);

  let bytes: Buffer | null;
  try {
    bytes = await getObject(blob.owner_id, blob.id);
  } catch (error) {
    if (error instanceof StorageUnavailable) throw storageUnavailableError();
    throw error;
  }
  if (bytes === null) throw notFound();

  ctx.res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Length': bytes.length,
  });
  ctx.res.end(bytes);
}
