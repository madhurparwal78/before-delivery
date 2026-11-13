import type { FastifyPluginAsync } from 'fastify';
import { fail, failures, isValidOpaqueId } from './errors.js';
import { loadSession, requireAuth } from './sessions.js';
import type { WorkerRuntime } from '../worker-runtime.js';
import { codePointLength, contentDispositionFor, hasControlChar, matchesDeclaredType } from '../rules.js';
import { newId } from '../ids.js';
import { UPLOAD_LIMIT } from './sessions.js';

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

export const attachmentRoutes: FastifyPluginAsync<{ runtime: WorkerRuntime }> = async (app, opts) => {
  const { runtime } = opts;

  app.post('/api/cards/:cardId/attachments', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { cardId } = request.params as { cardId: string };
    if (!isValidOpaqueId(cardId)) fail(failures.notFound());
    const card = await runtime.store.cardById(cardId);
    if (!card) fail(failures.notFound());
    const access = await runtime.store.boardAccess(card.boardId, authed.session.userId);
    if (!access) fail(failures.notFound());
    if (access.role === 'observer') fail(failures.notFound());
    if (!(await runtime.store.canSeeCard(access, authed.session.userId, cardId))) fail(failures.notFound());
    const contentType = request.headers['content-type'] ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      fail(failures.unsupportedMediaType());
    }
    const contentTypeHeader = request.headers['content-type'] ?? '';
    const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
    if (!boundaryMatch) fail(failures.unsupportedMediaType());
    const boundary = boundaryMatch[1] ?? boundaryMatch[2];
    const body = (request.body as { raw?: Buffer } | undefined)?.raw ?? request.body;
    const raw = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''), 'binary');
    const parsed = parseMultipart(raw, boundary);
    if (!parsed) fail(failures.validation({ file: 'Choose a file.' }));
    const { filename, contentType: declared, bytes } = parsed;
    if (codePointLength(filename) < 1 || codePointLength(filename) > 200 || hasControlChar(filename)) {
      fail(failures.validation({ file: 'That file name cannot be stored.' }));
    }
    if (bytes.length > UPLOAD_LIMIT) fail(failures.tooLarge());
    if (!ACCEPTED_TYPES.includes(declared) || !matchesDeclaredType(declared, bytes)) {
      fail(failures.unsupportedMediaType());
    }
    if (!runtime.storage.isUp()) fail(failures.storageUnavailable());
    const attachmentId = newId('att');
    const key = `attachments/${access.board.workspaceId}/${cardId}/${attachmentId}`;
    try {
      await runtime.storage.putObject(key, bytes, declared);
      const readBack = await runtime.storage.getObject(key);
      if (readBack.body.length !== bytes.length) {
        await runtime.storage.removeObjects([key]).catch(() => undefined);
        fail(failures.storageUnavailable());
      }
    } catch {
      fail(failures.storageUnavailable());
    }
    const size = bytes.length;
    await runtime.store.pool.query(
      `INSERT INTO kinfold_attachments (attachment_id, card_id, filename, content_type, size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [attachmentId, cardId, filename, declared, size, authed.session.userId],
    );
    await runtime.relay.publishBoard(card.boardId, {
      boardId: card.boardId,
      kind: 'card.changed',
      cardId,
      fromListId: card.listId,
    });
    const uploader = await runtime.store.userById(authed.session.userId);
    reply.status(201).send({
      attachment: {
        id: attachmentId,
        filename,
        contentType: declared,
        size,
        uploadedAt: new Date().toISOString(),
        uploadedBy: { displayName: uploader?.displayName ?? '' },
      },
    });
  });

  app.get('/api/attachments/:attachmentId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { attachmentId } = request.params as { attachmentId: string };
    if (!isValidOpaqueId(attachmentId)) fail(failures.notFound());
    const row = await runtime.store.pool.query(
      `SELECT a.attachment_id, a.filename, a.content_type, a.card_id, c.board_id FROM kinfold_attachments a
       JOIN kinfold_cards c ON c.card_id = a.card_id WHERE a.attachment_id = $1`,
      [attachmentId],
    );
    const att = row.rows[0] as
      | { attachment_id: string; filename: string; content_type: string; card_id: string; board_id: string }
      | undefined;
    if (!att) fail(failures.notFound());
    const access = await runtime.store.boardAccess(att.board_id, authed.session.userId);
    if (!access || access.role === 'observer') fail(failures.notFound());
    if (!(await runtime.store.canSeeCard(access, authed.session.userId, att.card_id))) fail(failures.notFound());
    if (!runtime.storage.isUp()) fail(failures.storageUnavailable());
    const key = `attachments/${access.board.workspaceId}/${att.card_id}/${att.attachment_id}`;
    let stored: { body: Buffer; contentType: string; size: number };
    try {
      stored = await runtime.storage.getObject(key);
    } catch {
      fail(failures.storageUnavailable());
    }
    reply
      .status(200)
      .header('Content-Type', att.content_type)
      .header('Content-Length', String(stored.body.length))
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', contentDispositionFor(att.filename))
      .send(stored.body);
  });

  app.delete('/api/attachments/:attachmentId', async (request, reply) => {
    const authed = requireAuth(await loadSession(request, runtime));
    const { attachmentId } = request.params as { attachmentId: string };
    if (!isValidOpaqueId(attachmentId)) fail(failures.notFound());
    const row = await runtime.store.pool.query(
      `SELECT a.attachment_id, a.card_id, c.board_id FROM kinfold_attachments a
       JOIN kinfold_cards c ON c.card_id = a.card_id WHERE a.attachment_id = $1`,
      [attachmentId],
    );
    const att = row.rows[0] as { attachment_id: string; card_id: string; board_id: string } | undefined;
    if (!att) fail(failures.notFound());
    const access = await runtime.store.boardAccess(att.board_id, authed.session.userId);
    if (!access || access.role === 'observer') fail(failures.notFound());
    if (!(await runtime.store.canSeeCard(access, authed.session.userId, att.card_id))) fail(failures.notFound());
    const key = `attachments/${access.board.workspaceId}/${att.card_id}/${att.attachment_id}`;
    if (!runtime.storage.isUp()) fail(failures.storageUnavailable());
    try {
      await runtime.storage.removeObjects([key]);
    } catch {
      fail(failures.storageUnavailable());
    }
    await runtime.store.pool.query(`DELETE FROM kinfold_attachments WHERE attachment_id = $1`, [attachmentId]);
    await runtime.relay.publishBoard(att.board_id, {
      boardId: att.board_id,
      kind: 'card.changed',
      cardId: att.card_id,
    });
    reply.status(204).send();
  });
};

interface ParsedPart {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** A minimal multipart reader: the app only ever receives one file field. */
function parseMultipart(body: Buffer, boundary: string): ParsedPart | null {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let index = body.indexOf(boundaryBuffer);
  while (index !== -1) {
    const next = body.indexOf(boundaryBuffer, index + boundaryBuffer.length);
    if (next === -1) break;
    const part = body.subarray(index + boundaryBuffer.length + 2, next - 2);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      index = next;
      continue;
    }
    const headers = part.subarray(0, headerEnd).toString('utf8');
    const content = part.subarray(headerEnd + 4);
    const disposition = /content-disposition:\s*form-data;([^\r\n]*)/i.exec(headers);
    if (!disposition) {
      index = next;
      continue;
    }
    const nameMatch = /name="([^"]*)"/.exec(disposition[1] ?? '');
    const fileMatch = /filename="([^"]*)"/.exec(disposition[1] ?? '');
    if (!nameMatch || nameMatch[1] !== 'file') {
      index = next;
      continue;
    }
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(headers);
    const rawFilename = fileMatch?.[1] ?? '';
    const filename = decodeFilename(rawFilename);
    return { filename, contentType: (typeMatch?.[1] ?? 'application/octet-stream').trim(), bytes: content };
  }
  return null;
}

function decodeFilename(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
