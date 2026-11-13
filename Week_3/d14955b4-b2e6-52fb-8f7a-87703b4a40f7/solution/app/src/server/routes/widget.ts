import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { BUCKET_CAPACITY, TOPICS } from '../../shared/types.js';
import type { MessageBody, Topic, WidgetMe } from '../../shared/types.js';
import { FILE_LIMIT_BYTES, FILES_PER_MESSAGE } from '../../shared/attachments.js';
import { attachmentBody, createAttachment, detectType, storedFilename, storeAttachment } from '../attachments.js';
import type { AttachmentRow } from '../attachments.js';
import { refill, retryAfterSeconds, take, wholeTokens } from '../bucket.js';
import type { BucketState } from '../bucket.js';
import { pool, withTransaction } from '../db.js';
import { bucketLine, linkLine, sanitiserLine, signatureLine, storeVerdict } from '../forensics.js';
import { HttpError, UPLOAD_LIMIT, changeRefused, notFound, route, sameOrigin, validation } from '../http.js';
import type { Ctx } from '../http.js';
import { publish, publishLink } from '../hub.js';
import { fingerprint, once, readKey, answerOf } from '../idempotency.js';
import { PLAYER_ID_FORMAT, ensurePlayer } from '../players.js';
import { sanitise } from '../../shared/sanitiser.js';
import { lockThreadByPlayer, recordPlayerMessage } from '../threads.js';
import { buildWidgetThread, findThread } from '../thread-view.js';
import { checkLink } from '../link-preview.js';
import { parseFileParts } from '../multipart.js';
import { attachmentContent } from './threads.js';

interface Identity {
  gameId: string;
  gameSlug: string;
  gameName: string;
  playerId: string;
  playerName: string;
}

const MESSAGE_MAX_CHARS = 2000;

const invalidIdentity = (): HttpError => new HttpError(401, 'invalid_identity', 'This help window could not confirm who you are.');

async function identify(ctx: Ctx): Promise<Identity> {
  const header = (name: string): string => String(ctx.req.headers[name] ?? '');
  const { rows } = await pool.query<{ id: string; slug: string; name: string; widget_secret: string }>(
    'select id, slug, name, widget_secret from games where slug = $1',
    [ctx.params.game],
  );
  const game = rows[0];
  const playerId = header('x-hushline-player');
  const signature = header('x-hushline-player-signature');
  if (!game || !PLAYER_ID_FORMAT.test(playerId)) throw invalidIdentity();
  const expected = Buffer.from(createHmac('sha256', game.widget_secret).update(playerId, 'utf8').digest('hex'));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalidIdentity();
  await ensurePlayer(pool, game.id, playerId);
  return { gameId: game.id, gameSlug: game.slug, gameName: game.name, playerId, playerName: playerId };
}

async function identifyForChange(ctx: Ctx): Promise<Identity> {
  const identity = await identify(ctx);
  if (!sameOrigin(ctx.req)) throw changeRefused();
  return identity;
}

async function loadBucket(db: PoolClient | typeof pool, identity: Identity, lock: boolean): Promise<BucketState> {
  const { rows } = await db.query<{ credit_ms: number; refilled_at: Date }>(
    `select credit_ms, refilled_at from buckets where game_id = $1 and player_id = $2${lock ? ' for update' : ''}`,
    [identity.gameId, identity.playerId],
  );
  const row = rows[0] as { credit_ms: number; refilled_at: Date };
  return { creditMs: row.credit_ms, refilledAt: row.refilled_at.getTime() };
}

function messageFields(submitted: Record<string, unknown>, hasThread: boolean): { body: string; topic: Topic } {
  const fields: Record<string, string> = {};
  const text = typeof submitted.body === 'string' ? submitted.body : '';
  const length = [...text.trim()].length;
  if (length === 0) fields.body = 'Write a message before sending.';
  else if (length > MESSAGE_MAX_CHARS) fields.body = 'Messages can be up to 2,000 characters.';
  const topic = submitted.topic;
  if (!hasThread && !TOPICS.includes(topic as Topic)) fields.topic = 'Choose what this is about.';
  if (Object.keys(fields).length > 0) throw validation(fields);
  return { body: text.replaceAll('\u0000', ''), topic: topic as Topic };
}

async function settleLink(messageId: string, after: string, thread: { id: string; game_id: string; topic: Topic }): Promise<void> {
  const outcome = await checkLink(after);
  const line = linkLine(outcome);
  await storeVerdict(pool, messageId, line);
  if (outcome.preview) {
    await pool.query('insert into link_previews (message_id, url, title, description) values ($1, $2, $3, $4) on conflict do nothing', [
      messageId, outcome.url, outcome.preview.title, outcome.preview.description,
    ]);
  }
  publish({ kind: 'thread', gameId: thread.game_id, threadId: thread.id, topic: thread.topic, reason: 'link', purchaseData: false });
  publishLink(messageId, line);
}

export const widgetRoutes = [
  route('GET', '/api/widget/:game/me', async (ctx) => {
    const identity = await identify(ctx);
    const bucket = refill(await loadBucket(pool, identity, false), Date.now());
    const thread = await pool.query<{ id: string }>('select id from threads where game_id = $1 and player_id = $2', [identity.gameId, identity.playerId]);
    const body: WidgetMe = {
      game: { slug: identity.gameSlug, name: identity.gameName },
      player: { id: identity.playerId, name: identity.playerName },
      thread_id: thread.rows[0]?.id ?? null,
      bucket: { level: wholeTokens(bucket), capacity: BUCKET_CAPACITY, retry_after_seconds: retryAfterSeconds(bucket) },
    };
    return { status: 200, body };
  }),

  route('GET', '/api/widget/:game/threads/:id', async (ctx) => {
    const identity = await identify(ctx);
    const thread = await findThread(pool, identity.gameId, ctx.params.id as string);
    if (!thread || thread.player_id !== identity.playerId) throw notFound();
    return { status: 200, body: await buildWidgetThread(pool, thread, identity.gameName) };
  }),

  route('POST', '/api/widget/:game/messages', async (ctx) => {
    const identity = await identifyForChange(ctx);
    const key = readKey(ctx);
    const submitted = await ctx.json();
    const routeName = 'POST /api/widget/:game/messages';
    const stored = await once(
      { scope: `${identity.gameId}:${identity.playerId}`, route: routeName, key, fingerprint: fingerprint(routeName, { body: submitted.body, topic: submitted.topic }) },
      async () => {
        const now = new Date();
        const sent = await withTransaction(async (tx) => {
          const state = await loadBucket(tx, identity, true);
          const existing = await lockThreadByPlayer(tx, identity.gameId, identity.playerId);
          const { body, topic } = messageFields(submitted, existing !== null);
          const taken = take(state, now.getTime());
          if (!taken.allowed) {
            throw new HttpError(429, 'rate_limited', `You're writing faster than the inbox can read. Try again in ${taken.retryAfter} seconds.`, undefined, {
              'Retry-After': String(taken.retryAfter),
            });
          }
          await tx.query('update buckets set credit_ms = $3, refilled_at = $4 where game_id = $1 and player_id = $2', [
            identity.gameId, identity.playerId, taken.state.creditMs, new Date(taken.state.refilledAt),
          ]);
          const recorded = await recordPlayerMessage(tx, { gameId: identity.gameId, playerId: identity.playerId, topic, body, now, existing });
          const sanitised = sanitise(body);
          await storeVerdict(tx, recorded.messageId, signatureLine('signature valid'));
          await storeVerdict(tx, recorded.messageId, bucketLine(taken.previous, taken.level));
          await storeVerdict(tx, recorded.messageId, sanitiserLine(sanitised));
          return { ...recorded, body, topic: existing?.topic ?? topic, after: sanitised.after };
        });
        const thread = { id: sent.threadId, game_id: identity.gameId, topic: sent.topic };
        publish({ kind: 'thread', gameId: identity.gameId, threadId: sent.threadId, topic: sent.topic, reason: 'message', purchaseData: false });
        void settleLink(sent.messageId, sent.after, thread).catch(() => undefined);
        const message: MessageBody = {
          id: sent.messageId,
          kind: 'player',
          author: { role: 'player', name: identity.playerName },
          body: sent.body,
          created_at: now.toISOString(),
          attachments: [],
          unfurl: null,
          event: null,
        };
        return { status: 201, body: { message, thread: { id: sent.threadId, status: sent.status } } };
      },
    );
    return answerOf(stored);
  }),

  route(
    'POST',
    '/api/widget/:game/messages/:id/attachments',
    async (ctx) => {
      const identity = await identifyForChange(ctx);
      const found = await pool.query<{ topic: Topic; thread_id: string }>(
        `select t.topic, t.id as thread_id from messages m join threads t on t.game_id = m.game_id and t.player_id = m.player_id
          where m.id = $1 and m.game_id = $2 and m.player_id = $3 and m.kind = 'player'`,
        [ctx.params.id, identity.gameId, identity.playerId],
      );
      const owner = found.rows[0];
      if (!owner) throw notFound();
      const raw = await ctx.rawBody();
      const file = parseFileParts(raw, ctx.req.headers['content-type'] ?? '').find((part) => part.name === 'file');
      if (file && file.bytes.length > FILE_LIMIT_BYTES) throw new HttpError(413, 'too_large', 'That is too large.');
      const detected = file ? detectType(file.bytes) : null;
      const declared = (file?.contentType ?? '').split(';')[0]?.trim().toLowerCase();
      if (!file || detected === null || declared !== detected) throw validation({ file: 'Attach a PNG, JPEG or plain-text file.' });
      const attachment = await withTransaction(async (tx) => {
        await tx.query('select 1 from messages where id = $1 for update', [ctx.params.id]);
        const count = await tx.query<{ n: number }>('select count(*)::int as n from attachments where message_id = $1', [ctx.params.id]);
        if ((count.rows[0] as { n: number }).n >= FILES_PER_MESSAGE) throw validation({ file: 'Three files per message at most.' });
        return createAttachment(tx, {
          gameId: identity.gameId, playerId: identity.playerId, messageId: ctx.params.id as string,
          filename: storedFilename(file.filename), contentType: detected, size: file.bytes.length,
        });
      });
      void storeAttachment(identity.gameSlug, attachment, file.bytes).then(() =>
        publish({ kind: 'thread', gameId: identity.gameId, threadId: owner.thread_id, topic: owner.topic, reason: 'attachment', purchaseData: false }),
      ).catch(() => undefined);
      return { status: 202, body: { attachment: attachmentBody(attachment) } };
    },
    { limit: UPLOAD_LIMIT, kind: 'multipart' },
  ),

  route('GET', '/api/widget/:game/attachments/:id', async (ctx) => {
    const identity = await identify(ctx);
    return { status: 200, body: attachmentBody(await ownAttachment(identity, ctx.params.id as string)) };
  }),

  route('GET', '/api/widget/:game/attachments/:id/content', async (ctx) => {
    const identity = await identify(ctx);
    return attachmentContent(identity.gameSlug, await ownAttachment(identity, ctx.params.id as string), ctx.nonce);
  }),
];

async function ownAttachment(identity: Identity, attachmentId: string): Promise<AttachmentRow> {
  const { rows } = await pool.query<AttachmentRow>(
    'select id, message_id, filename, content_type, size, status from attachments where id = $1 and game_id = $2 and player_id = $3',
    [attachmentId, identity.gameId, identity.playerId],
  );
  if (!rows[0]) throw notFound();
  return rows[0];
}
