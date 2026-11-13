import { one } from '../db';
import { ApiError, forbidden, notFound, validation } from '../errors';
import { FIELD } from '../../shared/copy';
import { loadRules, requireChangeToken, requireSession } from '../auth';
import { subscribe } from '../bus';
import { watchFamily } from '../familyWatch';
import { may, type Caller } from '../domain/permissions';
import { begin, complete, fingerprint, release } from '../domain/idempotency';
import { compareReceipts, lookupReceipts } from '../domain/receipts';
import { isSettled, STAGE_ORDER } from '../domain/verdicts';
import { contentDisposition, servedContentType, type DetectedType } from '../domain/uploads';
import { closeThread, createReply } from '../data/messages';
import { findGameById } from '../data/games';
import {
  buildThreadBody,
  isReceiptEvent,
  listInbox,
  loadPurchases,
  requireReadableThread,
  viewForCaller,
  type StoredEvent,
} from '../data/threads';
import { getObject, objectKey } from '../storage';
import { sendJson, sendJsonText, startStream, type Ctx, type Router } from '../http';
import { parseJson, readJsonRaw } from './body';
import type { ForensicsBody, ForensicsLine, ThreadStatus, Topic } from '../../shared/types';

function readStatus(ctx: Ctx): ThreadStatus {
  const raw = ctx.url.searchParams.get('status');
  if (raw === null || raw === '') return 'waiting';
  if (raw === 'waiting' || raw === 'answered' || raw === 'closed') return raw;
  throw validation({ status: FIELD.status });
}

function readLimit(ctx: Ctx): number {
  const raw = ctx.url.searchParams.get('limit');
  if (raw === null || raw === '') return 25;
  if (!/^\d+$/.test(raw)) throw validation({ limit: FIELD.limit });
  const value = Number(raw);
  if (value < 1 || value > 100) throw validation({ limit: FIELD.limit });
  return value;
}

interface MessageContext {
  id: string;
  thread_id: string;
  topic: Topic;
  event: StoredEvent | null;
  forensics: ForensicsLine[];
}

async function requireVisibleMessage(caller: Caller, messageId: string): Promise<MessageContext> {
  const row = await one<MessageContext>(
    `SELECT m.id, m.thread_id, m.event, m.forensics, t.topic
       FROM messages m JOIN threads t ON t.id = m.thread_id
      WHERE m.id = $1 AND m.game_id = $2`,
    [messageId, caller.gameId],
  );
  if (!row) throw notFound();
  if (!may(caller, 'read', row.topic)) throw notFound();
  if (isReceiptEvent(row.event) && !may(caller, 'receipts', row.topic)) throw notFound();
  return row;
}

function forensicsBody(row: MessageContext): ForensicsBody {
  return { message_id: row.id, settled: isSettled(row.forensics), lines: row.forensics };
}

interface AttachmentContext {
  id: string;
  message_id: string;
  filename: string;
  content_type: DetectedType;
  size: string | number;
  status: 'uploading' | 'attached' | 'failed';
  game_slug: string;
}

async function requireVisibleAttachment(caller: Caller, attachmentId: string): Promise<AttachmentContext> {
  const row = await one<AttachmentContext & { topic: Topic }>(
    `SELECT a.id, a.message_id, a.filename, a.content_type, a.size, a.status, g.slug AS game_slug, t.topic
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       JOIN threads t ON t.id = m.thread_id
       JOIN games g ON g.id = a.game_id
      WHERE a.id = $1 AND a.game_id = $2`,
    [attachmentId, caller.gameId],
  );
  if (!row) throw notFound();
  if (!may(caller, 'read', row.topic)) throw notFound();
  return row;
}

export function attachmentBody(row: {
  id: string;
  message_id: string;
  filename: string;
  content_type: string;
  size: string | number;
  status: string;
}): unknown {
  return {
    id: row.id,
    message_id: row.message_id,
    filename: row.filename,
    content_type: row.content_type,
    size: Number(row.size),
    status: row.status,
  };
}

export async function sendAttachmentContent(
  ctx: Ctx,
  row: { id: string; filename: string; content_type: DetectedType; status: string; game_slug: string },
): Promise<void> {
  if (row.status !== 'attached') throw new ApiError(409, 'not_attached');
  const bytes = await getObject(objectKey(row.game_slug, row.id));
  ctx.res.writeHead(200, {
    'Content-Type': servedContentType(row.content_type),
    'Content-Length': bytes.length,
    'Content-Disposition': contentDisposition(row.filename),
    'Cache-Control': 'no-store',
  });
  ctx.res.end(bytes);
}

export function registerStaffRoutes(router: Router): void {
  router.add('GET', '/api/inbox', async (ctx) => {
    const session = await requireSession(ctx);
    const status = readStatus(ctx);
    const limit = readLimit(ctx);
    const q = ctx.url.searchParams.get('q') ?? '';
    const cursor = ctx.url.searchParams.get('cursor');
    const body = await listInbox(session.caller, {
      status,
      q,
      limit,
      cursor: cursor === null || cursor === '' ? null : cursor,
    });
    sendJson(ctx, 200, body);
  });

  router.add('GET', '/api/threads/:id', async (ctx) => {
    const session = await requireSession(ctx);
    const thread = await requireReadableThread(session.caller, ctx.params.id as string);
    const game = await findGameById(session.caller.gameId);
    const body = await buildThreadBody(thread, viewForCaller(session.caller, thread, game?.name ?? ''));
    sendJson(ctx, 200, body);
  });

  router.add('POST', '/api/threads/:id/replies', async (ctx) => {
    const raw = await readJsonRaw(ctx);
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    const thread = await requireReadableThread(session.caller, ctx.params.id as string);
    if (!may(session.caller, 'reply', thread.topic)) throw forbidden();
    const payload = parseJson(raw);
    const key = ctx.req.headers['idempotency-key'];
    const target = {
      scope: `staff:${session.caller.staffId}`,
      route: 'reply',
      key: typeof key === 'string' ? key : '',
    };
    const print = fingerprint('reply', thread.id, payload);
    const outcome = await begin(target, print);
    if (outcome.kind === 'replay') {
      sendJsonText(ctx, outcome.status, outcome.body, { 'Idempotent-Replay': 'true' });
      return;
    }
    try {
      const body = typeof payload.body === 'string' ? payload.body : '';
      const trimmed = body.trim();
      if (trimmed.length === 0) throw validation({ body: FIELD.replyEmpty });
      if (trimmed.length > 4_000) throw validation({ body: FIELD.replyLong });
      const created = await createReply({
        gameId: session.caller.gameId,
        threadId: thread.id,
        authorRole: session.caller.role,
        authorName: session.caller.name,
        body,
      });
      const response = {
        message: created.message,
        thread: { id: created.threadId, status: created.status },
      };
      await complete(target, 201, response);
      sendJson(ctx, 201, response);
    } catch (error) {
      await release(target);
      throw error;
    }
  });

  router.add('POST', '/api/threads/:id/close', async (ctx) => {
    await readJsonRaw(ctx);
    const session = await requireSession(ctx);
    requireChangeToken(ctx, session);
    const thread = await requireReadableThread(session.caller, ctx.params.id as string);
    if (!may(session.caller, 'close', thread.topic)) throw forbidden();
    await closeThread({
      gameId: session.caller.gameId,
      threadId: thread.id,
      topic: thread.topic,
      playerName: thread.player_name,
    });
    sendJson(ctx, 200, { thread: { id: thread.id, status: 'closed' } });
  });

  router.add('GET', '/api/threads/:id/receipt-lookup', async (ctx) => {
    const session = await requireSession(ctx);
    const thread = await requireReadableThread(session.caller, ctx.params.id as string);
    if (!may(session.caller, 'receipts', thread.topic)) throw forbidden();
    const game = await findGameById(session.caller.gameId);
    const purchases = await loadPurchases(thread.game_id, thread.player_row_id);
    const lookup = await lookupReceipts(game?.slug ?? '', thread.player_public_id);
    sendJson(ctx, 200, {
      available: lookup.available,
      receipts: lookup.receipts,
      purchases: compareReceipts(purchases, lookup),
    });
  });

  router.add('GET', '/api/messages/:id/forensics', async (ctx) => {
    const session = await requireSession(ctx);
    const row = await requireVisibleMessage(session.caller, ctx.params.id as string);
    sendJson(ctx, 200, forensicsBody(row));
  });

  router.add('GET', '/api/messages/:id/forensics/stream', async (ctx) => {
    const session = await requireSession(ctx);
    const row = await requireVisibleMessage(session.caller, ctx.params.id as string);
    const stream = startStream(ctx);
    const sent = new Set<string>();
    let done = false;
    const evaluate = (body: ForensicsBody): void => {
      if (done) return;
      for (const stage of STAGE_ORDER) {
        const line = body.lines.find((entry) => entry.stage === stage);
        if (!line || line.state !== 'settled' || sent.has(stage)) continue;
        sent.add(stage);
        stream.send('stage', line);
      }
      if (body.settled) {
        done = true;
        stream.send('settled', body);
        stream.close();
      }
    };
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'forensics' && event.messageId === row.id) evaluate(event.body);
    });
    stream.onClose(unsubscribe);
    evaluate(forensicsBody(row));
  });

  router.add('GET', '/api/attachments/:id', async (ctx) => {
    const session = await requireSession(ctx);
    const row = await requireVisibleAttachment(session.caller, ctx.params.id as string);
    sendJson(ctx, 200, attachmentBody(row));
  });

  router.add('GET', '/api/attachments/:id/content', async (ctx) => {
    const session = await requireSession(ctx);
    const row = await requireVisibleAttachment(session.caller, ctx.params.id as string);
    await sendAttachmentContent(ctx, row);
  });

  router.add('GET', '/api/stream', async (ctx) => {
    const session = await requireSession(ctx);
    let caller = session.caller;
    const stream = startStream(ctx);
    stream.comment('open');
    const unsubscribe = subscribe((event) => {
      if (event.kind === 'forensics') return;
      if (event.gameId !== caller.gameId) return;
      if (event.kind === 'rules') {
        if (event.moderatorId !== caller.staffId) return;
        void loadRules(caller.staffId).then((rules) => {
          caller = { ...caller, rules };
          stream.send('permissions', {});
        });
        return;
      }
      if (!may(caller, 'read', event.topic)) return;
      if (event.receiptRelated && !may(caller, 'receipts', event.topic)) return;
      if (event.kind === 'thread') {
        stream.send('thread', {
          thread_id: event.threadId,
          status: event.status,
          topic: event.topic,
          player_name: event.playerName,
          reason: event.reason,
        });
        return;
      }
      stream.send('refused', {
        thread_id: event.threadId,
        player_name: event.playerName,
        reason_words: event.reasonWords,
      });
    });
    const stopWatching = watchFamily(session.familyId, () => stream.close());
    const keepalive = setInterval(() => stream.comment('keepalive'), 20_000);
    keepalive.unref();
    stream.onClose(() => {
      unsubscribe();
      stopWatching();
      clearInterval(keepalive);
    });
  });
}
