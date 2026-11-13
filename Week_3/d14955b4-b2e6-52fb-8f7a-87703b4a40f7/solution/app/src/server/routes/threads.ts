import { STAGES } from '../../shared/types.js';
import type { ForensicsBody, ForensicsLine, MessageBody, Stage, ThreadBody } from '../../shared/types.js';
import { readableThread, requireAction, staffAccess } from '../access.js';
import { attachmentBody, contentDisposition, readStoredAttachment, servedContentType } from '../attachments.js';
import type { AttachmentRow } from '../attachments.js';
import { pool, withTransaction } from '../db.js';
import { loadForensics } from '../forensics.js';
import { HttpError, STREAMED, contentSecurityPolicy, forbidden, notFound, route, startStream, validation } from '../http.js';
import { addStaffStream, publish, watchLink } from '../hub.js';
import { fingerprint, once, readKey, answerOf } from '../idempotency.js';
import { inbox, parseInboxQuery } from '../inbox.js';
import { can, canSee } from '../permissions.js';
import { lookupReceipts } from '../receipts.js';
import { recordClose, recordReply } from '../threads.js';
import { buildStaffThread, findMessage, isPurchaseEvent, loadPurchases } from '../thread-view.js';
import type { StaffAccess } from '../access.js';
import type { Topic } from '../../shared/types.js';

const REPLY_MAX_CHARS = 4000;
const LINK_WAIT_MS = 8000;

function replyText(submitted: unknown): string {
  const text = typeof submitted === 'string' ? submitted : '';
  const length = [...text.trim()].length;
  if (length === 0) throw validation({ body: 'Write a reply before sending.' });
  if (length > REPLY_MAX_CHARS) throw validation({ body: 'Replies can be up to 4,000 characters.' });
  return text.replaceAll('\u0000', '');
}

async function readableMessage(access: StaffAccess, messageId: string): Promise<NonNullable<Awaited<ReturnType<typeof findMessage>>>> {
  const message = await findMessage(pool, access.staff.gameId, messageId);
  if (!message?.thread_id) throw notFound();
  const topic = message.topic as Topic;
  if (!canSee(access.viewer, topic, isPurchaseEvent(message.type))) throw notFound();
  return message;
}

async function readableAttachment(access: StaffAccess, attachmentId: string): Promise<AttachmentRow & { topic: Topic }> {
  const { rows } = await pool.query<AttachmentRow & { topic: Topic }>(
    `select a.id, a.message_id, a.filename, a.content_type, a.size, a.status, t.topic
       from attachments a join threads t on t.game_id = a.game_id and t.player_id = a.player_id
      where a.id = $1 and a.game_id = $2`,
    [attachmentId, access.staff.gameId],
  );
  const attachment = rows[0];
  if (!attachment || !can(access.viewer, 'read', attachment.topic)) throw notFound();
  return attachment;
}

export const threadRoutes = [
  route('GET', '/api/inbox', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const query = parseInboxQuery(ctx.searchParams);
    return { status: 200, body: await inbox(access.viewer, access.staff.gameId, query) };
  }),

  route('GET', '/api/threads/:id', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const thread = await readableThread(access, ctx.params.id as string);
    const body: ThreadBody = await buildStaffThread(pool, thread, can(access.viewer, 'receipts', thread.topic));
    return { status: 200, body };
  }),

  route('POST', '/api/threads/:id/replies', async (ctx) => {
    const access = await staffAccess(ctx, { change: true });
    const thread = await readableThread(access, ctx.params.id as string);
    requireAction(access, 'reply', thread);
    const key = readKey(ctx);
    const submitted = await ctx.json();
    const routeName = 'POST /api/threads/:id/replies';
    const stored = await once(
      { scope: access.staff.id, route: routeName, key, fingerprint: fingerprint(routeName, { threadId: thread.id, body: submitted.body }) },
      async () => {
        const now = new Date();
        const result = await withTransaction((tx) =>
          recordReply(tx, { threadId: thread.id, staffId: access.staff.id, readBody: () => replyText(submitted.body), now }),
        );
        if (!result.ok) throw new HttpError(409, result.code, 'This thread is closed. It reopens when the player writes again.');
        publish({ kind: 'thread', gameId: thread.game_id, threadId: thread.id, topic: thread.topic, reason: 'message', purchaseData: false });
        const message: MessageBody = {
          id: result.messageId,
          kind: 'reply',
          author: { role: access.staff.role, name: access.staff.name },
          body: result.body,
          created_at: now.toISOString(),
          attachments: [],
          unfurl: null,
          event: null,
        };
        return { status: 201, body: { message, thread: { id: thread.id, status: result.thread.status } } };
      },
    );
    return answerOf(stored);
  }),

  route('POST', '/api/threads/:id/close', async (ctx) => {
    const access = await staffAccess(ctx, { change: true });
    const thread = await readableThread(access, ctx.params.id as string);
    requireAction(access, 'close', thread);
    const result = await withTransaction((tx) => recordClose(tx, thread.id, new Date()));
    if (!result.ok) {
      throw new HttpError(409, result.code, result.code === 'not_answered' ? 'Answer the player before closing.' : 'This thread is already closed.');
    }
    publish({ kind: 'thread', gameId: thread.game_id, threadId: thread.id, topic: thread.topic, reason: 'status', purchaseData: false });
    return { status: 200, body: { thread: { id: thread.id, status: result.status } } };
  }),

  route('GET', '/api/threads/:id/receipt-lookup', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const thread = await readableThread(access, ctx.params.id as string);
    if (!can(access.viewer, 'receipts', thread.topic)) throw forbidden();
    const purchases = await loadPurchases(pool, thread);
    return { status: 200, body: await lookupReceipts(access.staff.gameSlug, thread.player_id, purchases) };
  }),

  route('GET', '/api/messages/:id/forensics', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const message = await readableMessage(access, ctx.params.id as string);
    return { status: 200, body: await loadForensics(pool, message.id, message.kind) };
  }),

  route('GET', '/api/messages/:id/forensics/stream', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const message = await readableMessage(access, ctx.params.id as string);
    startStream(ctx.res);
    const arrived: { link: ForensicsLine | null } = { link: null };
    let wake: (() => void) | null = null;
    const unwatch = watchLink(message.id, (line) => {
      arrived.link = line;
      wake?.();
    });
    ctx.res.on('close', () => wake?.());
    const sent = new Set<Stage>();
    const send = (forensics: ForensicsBody): void => {
      for (const line of forensics.lines) {
        if (line.state !== 'settled' || sent.has(line.stage)) continue;
        if (STAGES.slice(0, STAGES.indexOf(line.stage)).some((earlier) => !sent.has(earlier))) break;
        sent.add(line.stage);
        ctx.res.write(`event: stage\ndata: ${JSON.stringify(line)}\n\n`);
      }
      if (forensics.settled) ctx.res.write(`event: settled\ndata: ${JSON.stringify(forensics)}\n\n`);
    };
    try {
      const forensics = await loadForensics(pool, message.id, message.kind);
      send(forensics);
      if (!forensics.settled) {
        if (!arrived.link && !ctx.res.destroyed) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            setTimeout(resolve, LINK_WAIT_MS);
          });
        }
        const link = arrived.link;
        if (link) {
          const lines = forensics.lines.map((line) => (line.stage === 'link' ? link : line));
          send({ ...forensics, settled: lines.every((line) => line.state === 'settled'), lines });
        }
      }
    } finally {
      unwatch();
      ctx.res.end();
    }
    return STREAMED;
  }),

  route('GET', '/api/stream', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    startStream(ctx.res);
    addStaffStream(ctx.res, access.staff);
    return STREAMED;
  }),

  route('GET', '/api/attachments/:id', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    return { status: 200, body: attachmentBody(await readableAttachment(access, ctx.params.id as string)) };
  }),

  route('GET', '/api/attachments/:id/content', async (ctx) => {
    const access = await staffAccess(ctx, { change: false });
    const attachment = await readableAttachment(access, ctx.params.id as string);
    return attachmentContent(access.staff.gameSlug, attachment, ctx.nonce);
  }),
];

export async function attachmentContent(gameSlug: string, attachment: AttachmentRow, nonce: string): Promise<{ status: number; raw: Buffer; headers: Record<string, string> }> {
  if (attachment.status !== 'attached') throw new HttpError(409, 'not_attached', 'That attachment is not available.');
  let bytes: Buffer;
  try {
    bytes = await readStoredAttachment(gameSlug, attachment.id);
  } catch {
    throw new HttpError(502, 'store_unavailable', 'The file store is not answering.');
  }
  return {
    status: 200,
    raw: bytes,
    headers: {
      'Content-Type': servedContentType(attachment.content_type),
      'Content-Disposition': contentDisposition(attachment.filename),
      'Content-Security-Policy': contentSecurityPolicy(nonce, "'none'", true),
    },
  };
}
