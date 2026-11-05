import { createHash } from 'node:crypto';
import { db, writeTx } from '../db.ts';
import { conflict, notFound, storageUnavailable, unsupportedMediaType } from '../http/errors.ts';
import { param, requireRole, type ApiResult, type RequestContext } from '../http/context.ts';
import { uploadsAllowed, effectiveStatus } from '../domain/cycleState.ts';
import {
  bytesMatchType,
  declaredUploadType,
  downloadFileName,
  kindAcceptsType,
  objectKeyFor,
  type DocumentKind,
} from '../domain/uploads.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import { getCycleRow } from '../store.ts';
import { StorageUnavailableError, deleteObject, getObject, putObject } from '../providers/storage.ts';

const LOCK_STALE_MS = 60_000;

interface DocumentRow {
  kind: DocumentKind;
  key: string;
  bytes: number;
  sha256: string;
  content_type: string;
  uploaded_at: string;
}

function documentKind(ctx: RequestContext): DocumentKind {
  const kind = param(ctx, 'kind');
  if (kind !== 'invoice' && kind !== 'packing-slip') throw notFound();
  return kind;
}

function acquireUploadLock(cycleId: string, kind: DocumentKind): void {
  writeTx(() => {
    const row = db
      .prepare('SELECT started_at FROM upload_locks WHERE cycle_id = ? AND kind = ?')
      .get(cycleId, kind) as { started_at: number } | undefined;
    if (row && Date.now() - row.started_at < LOCK_STALE_MS) {
      throw conflict('upload_in_progress', 'Another upload of this file is still running.');
    }
    db.prepare(
      'INSERT INTO upload_locks (cycle_id, kind, started_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT (cycle_id, kind) DO UPDATE SET started_at = excluded.started_at',
    ).run(cycleId, kind, Date.now());
  });
}

function releaseUploadLock(cycleId: string, kind: DocumentKind): void {
  writeTx(() => {
    db.prepare('DELETE FROM upload_locks WHERE cycle_id = ? AND kind = ?').run(cycleId, kind);
  });
}

export async function putDocument(ctx: RequestContext): Promise<ApiResult> {
  requireRole(ctx, ['coordinator']);
  const kind = documentKind(ctx);
  const declared = declaredUploadType(ctx.headers['content-type']);
  if (declared === null || !kindAcceptsType(kind, declared)) {
    throw unsupportedMediaType('That file type is not accepted here.');
  }
  if (!bytesMatchType(ctx.rawBody, declared)) {
    throw unsupportedMediaType('Those bytes are not the type they claim.');
  }
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const status = effectiveStatus(cycle.status, cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at), ctx.now);
  if (!uploadsAllowed(status)) throw conflict('wrong_cycle_state', 'Documents are uploaded after the order is placed.');

  acquireUploadLock(cycle.id, kind);
  try {
    const key = objectKeyFor(cycle.id, kind, declared);
    const sha256 = createHash('sha256').update(ctx.rawBody).digest('hex');
    try {
      await putObject(key, ctx.rawBody, declared);
    } catch (error) {
      if (error instanceof StorageUnavailableError) throw storageUnavailable();
      throw error;
    }
    const previous = writeTx(() => {
      const old = db
        .prepare('SELECT key FROM documents WHERE cycle_id = ? AND kind = ?')
        .get(cycle.id, kind) as { key: string } | undefined;
      db.prepare(
        `INSERT INTO documents (cycle_id, kind, key, bytes, sha256, content_type, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (cycle_id, kind) DO UPDATE SET key = excluded.key, bytes = excluded.bytes,
           sha256 = excluded.sha256, content_type = excluded.content_type, uploaded_at = excluded.uploaded_at`,
      ).run(cycle.id, kind, key, ctx.rawBody.length, sha256, declared, toIsoSeconds(new Date(ctx.now)));
      return old?.key ?? null;
    });
    if (previous !== null && previous !== key) await removeReplacedObject(previous);
    return { status: 201, body: { kind, key, bytes: ctx.rawBody.length, sha256 } };
  } finally {
    releaseUploadLock(cycle.id, kind);
  }
}

async function removeReplacedObject(key: string): Promise<void> {
  try {
    await deleteObject(key);
  } catch {
    writeTx(() => {
      db.prepare('INSERT OR IGNORE INTO pending_deletes (key, created_at) VALUES (?, ?)').run(
        key,
        toIsoSeconds(new Date()),
      );
    });
  }
}

export function listDocuments(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['coordinator']);
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const rows = db
    .prepare('SELECT kind, key, bytes, sha256, uploaded_at FROM documents WHERE cycle_id = ? ORDER BY kind')
    .all(cycle.id);
  return { status: 200, body: { documents: rows } };
}

export async function getDocument(ctx: RequestContext): Promise<ApiResult> {
  requireRole(ctx, ['coordinator']);
  const kind = documentKind(ctx);
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const row = db
    .prepare('SELECT kind, key, bytes, sha256, content_type, uploaded_at FROM documents WHERE cycle_id = ? AND kind = ?')
    .get(cycle.id, kind) as DocumentRow | undefined;
  if (!row) throw notFound();
  let bytes: Buffer | null;
  try {
    bytes = await getObject(row.key);
  } catch (error) {
    if (error instanceof StorageUnavailableError) throw storageUnavailable();
    throw error;
  }
  if (bytes === null) throw notFound();
  return {
    status: 200,
    rawBody: bytes,
    headers: {
      'Content-Type': row.content_type,
      'Content-Disposition': `attachment; filename="${downloadFileName(row.key)}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  };
}

export function startPendingDeletes(): void {
  setInterval(() => {
    const rows = db.prepare('SELECT key FROM pending_deletes ORDER BY key').all() as { key: string }[];
    void (async () => {
      for (const row of rows) {
        try {
          await deleteObject(row.key);
          writeTx(() => {
            db.prepare('DELETE FROM pending_deletes WHERE key = ?').run(row.key);
          });
        } catch {
          return;
        }
      }
    })();
  }, 30_000).unref();
}
