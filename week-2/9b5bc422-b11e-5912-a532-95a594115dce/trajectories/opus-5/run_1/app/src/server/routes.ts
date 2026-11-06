import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createAccount,
  listDevices,
  removeDevice,
  requireSession,
  sessionBody,
  sessionFor,
  sessionToken,
  signIn,
  signOut,
  type Session,
} from './accounts.ts';
import { FILE_BYTE_LIMIT, config } from './config.ts';
import { query } from './db.ts';
import { ApiError, apiError } from './errors.ts';
import { freshAvailability } from './health.ts';
import {
  clearedSessionCookie,
  readBody,
  readJson,
  requestOrigin,
  sendEmpty,
  sendJson,
  sessionCookie,
} from './http.ts';
import { attachmentKey, storage } from './s3.ts';
import { pull, push } from './sync.ts';
import { accountHoldsDocument, sharedDocument } from './workspace.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const token = sessionToken(request);
  if (!token) {
    sendJson(response, 200, {});
    return;
  }
  const session = await sessionFor(token);
  if (!session) {
    sendJson(response, 200, {});
    return;
  }
  sendJson(response, 200, sessionBody(session));
}

export async function postAccount(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const signedIn = await createAccount(String(body.email ?? ''), String(body.password ?? ''));
  response.setHeader('Set-Cookie', sessionCookie(signedIn.token));
  sendJson(response, 201, sessionBody(signedIn.session));
}

export async function postSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const signedIn = await signIn(String(body.email ?? ''), String(body.password ?? ''));
  response.setHeader('Set-Cookie', sessionCookie(signedIn.token));
  sendJson(response, 200, sessionBody(signedIn.session));
}

export async function deleteSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const token = sessionToken(request);
  if (token) {
    const session = await sessionFor(token);
    if (session) await signOut(session);
  }
  sendEmpty(response, 204, { 'Set-Cookie': clearedSessionCookie() });
}

export async function getDevices(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const session = await requireSession(request);
  sendJson(response, 200, { devices: await listDevices(session) });
}

export async function deleteDevice(
  request: IncomingMessage,
  response: ServerResponse,
  deviceId: string,
): Promise<void> {
  const session = await requireSession(request);
  await removeDevice(session, deviceId);
  sendEmpty(response, 204);
}

function unavailable(error: unknown): never {
  if (error instanceof ApiError) throw error;
  throw apiError.unavailable();
}

export async function putAttachment(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentId: string,
): Promise<void> {
  const session = await requireSession(request);
  const documentId = decodeURIComponent(String(request.headers['x-document-id'] ?? '')).trim();
  const name = decodeURIComponent(String(request.headers['x-file-name'] ?? '')) || 'file';
  const contentType = String(request.headers['content-type'] ?? 'application/octet-stream');

  let known: { account_id: string; digest: string; name: string; size: string; content_type: string } | null = null;
  if (UUID.test(attachmentId)) {
    const result = await query<{
      account_id: string;
      digest: string;
      name: string;
      size: string;
      content_type: string;
    }>('select account_id, digest, name, size, content_type from attachments where id = $1', [attachmentId]);
    known = result.rows[0] ?? null;
    if (known && known.account_id !== session.accountId) throw apiError.notFound();
  }

  const body = await readBody(request, FILE_BYTE_LIMIT, apiError.fileTooLarge());
  const digest = createHash('sha256').update(body).digest('hex');

  if (known) {
    if (known.digest === digest) {
      sendJson(response, 200, {
        id: attachmentId,
        name: known.name,
        size: Number(known.size),
        contentType: known.content_type,
        state: 'stored',
      });
      return;
    }
    throw apiError.attachmentIdUsed();
  }

  const used = await query<{ total: string | null }>('select sum(size) as total from attachments where account_id = $1', [
    session.accountId,
  ]);
  if (Number(used.rows[0]?.total ?? 0) + body.length > config.accountStorageBytes) throw apiError.storageFull();

  if (!UUID.test(attachmentId)) throw apiError.badAttachmentId();
  if (!documentId) throw apiError.missingDocumentId();

  await storage.put(attachmentKey(session.accountId, attachmentId), body, contentType).catch(unavailable);
  await query(
    `insert into attachments (id, account_id, document_id, name, size, content_type, digest)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [attachmentId, session.accountId, documentId, name, body.length, contentType, digest],
  );

  sendJson(response, 201, {
    id: attachmentId,
    name,
    size: body.length,
    contentType,
    state: 'stored',
  });
}

function sendFile(response: ServerResponse, bytes: Buffer, name: string, contentType: string): void {
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': bytes.length,
    'Content-Disposition': `attachment; filename="${name.replace(/["\\]/g, '')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  response.end(bytes);
}

export async function getAttachment(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentId: string,
): Promise<void> {
  const session = await requireSession(request);
  if (!UUID.test(attachmentId)) throw apiError.notFound();
  const result = await query<{ name: string; content_type: string }>(
    'select name, content_type from attachments where id = $1 and account_id = $2',
    [attachmentId, session.accountId],
  );
  const row = result.rows[0];
  if (!row) throw apiError.notFound();
  const bytes = await storage.get(attachmentKey(session.accountId, attachmentId)).catch(unavailable);
  if (!bytes) throw apiError.notFound();
  sendFile(response, bytes, row.name, row.content_type);
}

export async function deleteAttachment(
  request: IncomingMessage,
  response: ServerResponse,
  attachmentId: string,
): Promise<void> {
  const session = await requireSession(request);
  if (!UUID.test(attachmentId)) throw apiError.notFound();
  const result = await query('select 1 from attachments where id = $1 and account_id = $2', [
    attachmentId,
    session.accountId,
  ]);
  if (!result.rowCount) throw apiError.notFound();
  await storage.remove(attachmentKey(session.accountId, attachmentId)).catch(unavailable);
  await query('delete from attachments where id = $1 and account_id = $2', [attachmentId, session.accountId]);
  sendEmpty(response, 204);
}

type ShareRow = { token: string; expires_at: Date };

async function activeShare(session: Session, documentId: string): Promise<ShareRow | null> {
  const result = await query<ShareRow>(
    `select token, expires_at from share_links
      where account_id = $1 and document_id = $2 and revoked = false and expires_at > now()
      order by created_at desc limit 1`,
    [session.accountId, documentId],
  );
  return result.rows[0] ?? null;
}

function shareBody(request: IncomingMessage, row: ShareRow): Record<string, unknown> {
  return {
    token: row.token,
    url: `${requestOrigin(request)}/s/${row.token}`,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export async function getShare(
  request: IncomingMessage,
  response: ServerResponse,
  documentId: string,
): Promise<void> {
  const session = await requireSession(request);
  if (!(await accountHoldsDocument(session.accountId, documentId))) throw apiError.notFound();
  const row = await activeShare(session, documentId);
  sendJson(response, 200, { share: row ? shareBody(request, row) : null });
}

export async function postShare(
  request: IncomingMessage,
  response: ServerResponse,
  documentId: string,
): Promise<void> {
  const session = await requireSession(request);
  await readJson(request);
  if (!(await accountHoldsDocument(session.accountId, documentId))) throw apiError.notFound();
  await query('update share_links set revoked = true where account_id = $1 and document_id = $2', [
    session.accountId,
    documentId,
  ]);
  const token = randomBytes(24).toString('base64url');
  const result = await query<ShareRow>(
    `insert into share_links (token, account_id, document_id, expires_at)
     values ($1, $2, $3, now() + ($4 || ' seconds')::interval)
     returning token, expires_at`,
    [token, session.accountId, documentId, String(config.shareLinkSeconds)],
  );
  sendJson(response, 201, shareBody(request, result.rows[0]));
}

export async function deleteShare(
  request: IncomingMessage,
  response: ServerResponse,
  documentId: string,
): Promise<void> {
  const session = await requireSession(request);
  if (!(await accountHoldsDocument(session.accountId, documentId))) throw apiError.notFound();
  const row = await activeShare(session, documentId);
  if (!row) throw apiError.notFound();
  await query('update share_links set revoked = true where token = $1', [row.token]);
  sendEmpty(response, 204);
}

async function shareTarget(token: string): Promise<{ accountId: string; documentId: string }> {
  const result = await query<{ account_id: string; document_id: string }>(
    `select account_id, document_id from share_links
      where token = $1 and revoked = false and expires_at > now()`,
    [token],
  );
  const row = result.rows[0];
  if (!row) throw apiError.deadLink();
  return { accountId: row.account_id, documentId: row.document_id };
}

export async function getShared(
  _request: IncomingMessage,
  response: ServerResponse,
  token: string,
): Promise<void> {
  const target = await shareTarget(token);
  const document = await sharedDocument(target.accountId, target.documentId);
  if (!document) throw apiError.deadLink();
  sendJson(response, 200, document);
}

export async function getSharedAttachment(
  _request: IncomingMessage,
  response: ServerResponse,
  token: string,
  attachmentId: string,
): Promise<void> {
  const target = await shareTarget(token);
  if (!UUID.test(attachmentId)) throw apiError.deadLink();
  const result = await query<{ name: string; content_type: string }>(
    'select name, content_type from attachments where id = $1 and account_id = $2 and document_id = $3',
    [attachmentId, target.accountId, target.documentId],
  );
  const row = result.rows[0];
  if (!row) throw apiError.deadLink();
  const bytes = await storage.get(attachmentKey(target.accountId, attachmentId)).catch(unavailable);
  if (!bytes) throw apiError.deadLink();
  sendFile(response, bytes, row.name, row.content_type);
}

export async function postSyncPush(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const session = await requireSession(request);
  const body = await readJson(request);
  sendJson(response, 200, await push(session, body));
}

export async function postSyncPull(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const session = await requireSession(request);
  const body = await readJson(request);
  sendJson(response, 200, await pull(session, Number(body.since ?? 0)));
}

export async function getStatus(_request: IncomingMessage, response: ServerResponse): Promise<void> {
  const available = await freshAvailability();
  sendJson(response, 200, {
    sync: available.sync ? 'ok' : 'unavailable',
    storage: available.storage ? 'ok' : 'unavailable',
  });
}

export async function getHealth(_request: IncomingMessage, response: ServerResponse): Promise<void> {
  const available = await freshAvailability();
  sendJson(response, 200, { status: available.sync && available.storage ? 'ok' : 'unavailable' });
}
