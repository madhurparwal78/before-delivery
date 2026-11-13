import { blobReadableBy } from './access.js';
import { now } from './clock.js';
import { config } from './config.js';
import { one, pool, query, type Queryable } from './db.js';
import { ApiError, authed, authedRaw, invalid, notFound, readBody } from './http.js';
import { blobRecord } from './records.js';
import type { BlobRow } from './rows.js';
import { getObject, objectKey, objectSize, putObject, removeObject, StorageUnavailable } from './s3.js';
import { isUuid, jsonBody } from './validate.js';

const KINDS: readonly string[] = ['image', 'file', 'photo'];

const unavailable = (): ApiError => new ApiError(503, 'storage_unavailable');

async function withStorage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof StorageUnavailable) throw unavailable();
    throw error;
  }
}

export function liveBlob(db: Queryable, id: string): Promise<BlobRow | null> {
  return one<BlobRow>(db, 'SELECT * FROM blobs WHERE id = $1 AND discarded_at IS NULL', [id]);
}

/** Marks blobs discarded and deletes their objects now; the sweep retries when storage is unreachable. */
export async function discardBlobs(db: Queryable, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await query(db, 'UPDATE blobs SET discarded_at = $2 WHERE id = ANY($1) AND discarded_at IS NULL', [ids, at]);
  await removeDiscardedObjects(db);
}

export async function removeDiscardedObjects(db: Queryable): Promise<void> {
  for (const blob of await query<BlobRow>(db, 'SELECT * FROM blobs WHERE discarded_at IS NOT NULL AND object_removed = false')) {
    try {
      await removeObject(objectKey(blob.owner_id, blob.id));
      await query(db, 'UPDATE blobs SET object_removed = true WHERE id = $1', [blob.id]);
    } catch (error) {
      if (error instanceof StorageUnavailable) return;
      throw error;
    }
  }
}

/** True when the stored object's size equals the declared size right now. Answers 503 when storage is unreachable. */
export function objectConfirmed(blob: BlobRow): Promise<boolean> {
  return withStorage(async () => (await objectSize(objectKey(blob.owner_id, blob.id))) === blob.size);
}

export function registerBlobRoutes(): void {
  authed('POST', '/api/blobs', async ({ account, body }) => {
    const input = jsonBody(body);
    const { id, kind, size } = input;
    if (!isUuid(id)) throw invalid({ id: 'invalid' });
    const existing = await one<BlobRow>(pool, 'SELECT * FROM blobs WHERE id = $1', [id]);
    const replay = (row: BlobRow) => {
      if (row.owner_id !== account.id || row.kind !== kind || row.size !== size) throw new ApiError(409, 'blob_id_conflict');
      return { status: 200, body: blobRecord(row) };
    };
    if (existing) return replay(existing);
    const fields: Record<string, string> = {};
    if (typeof kind !== 'string' || !KINDS.includes(kind)) fields.kind = 'unsupported';
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 1) fields.size = 'invalid';
    if (Object.keys(fields).length > 0) throw invalid(fields);
    if ((size as number) > config.attachmentMaxBytes) throw new ApiError(413, 'too_large');
    const [inserted] = await query<BlobRow>(
      pool,
      `INSERT INTO blobs (id, owner_id, kind, size, state, created_at) VALUES ($1, $2, $3, $4, 'uploading', $5)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [id, account.id, kind, size, now()],
    );
    if (inserted) return { status: 201, body: blobRecord(inserted) };
    return replay((await one<BlobRow>(pool, 'SELECT * FROM blobs WHERE id = $1', [id]))!);
  });

  authedRaw('PUT', '/api/blobs/:id/content', async ({ account, params, req }) => {
    if (!isUuid(params.id)) throw notFound();
    const blob = await one<BlobRow>(pool, 'SELECT * FROM blobs WHERE id = $1 AND owner_id = $2 AND discarded_at IS NULL', [params.id, account.id]);
    if (!blob) throw notFound();
    if (blob.state === 'stored') throw new ApiError(409, 'already_stored');
    const bytes = await readBody(req, blob.size);
    if (bytes.length < blob.size) throw new ApiError(422, 'size_mismatch');
    const key = objectKey(blob.owner_id, blob.id);
    await withStorage(async () => {
      await putObject(key, bytes);
      if ((await objectSize(key)) !== blob.size) {
        await removeObject(key);
        throw new StorageUnavailable();
      }
    });
    const [stored] = await query<BlobRow>(pool, `UPDATE blobs SET state = 'stored' WHERE id = $1 AND state = 'uploading' RETURNING *`, [blob.id]);
    if (!stored) throw new ApiError(409, 'already_stored');
    return { status: 200, body: blobRecord(stored) };
  });

  authed('GET', '/api/blobs/:id', async ({ account, params, res }) => {
    const blob = isUuid(params.id) ? await liveBlob(pool, params.id) : null;
    if (!blob || blob.state !== 'stored' || !(await blobReadableBy(pool, account.id, blob))) throw notFound();
    const stream = await withStorage(() => getObject(objectKey(blob.owner_id, blob.id)));
    if (!stream) throw notFound();
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment',
      'Content-Length': String(blob.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
    return 'handled';
  });
}
