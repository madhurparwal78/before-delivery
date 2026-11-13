import { createHmac, timingSafeEqual } from 'node:crypto';
import Busboy from 'busboy';
import { limits } from '../config';
import { one, query } from '../db';
import { ApiError, notFound, validation } from '../errors';
import { FIELD } from '../../shared/copy';
import { publish } from '../bus';
import { readBucket, takeToken } from '../domain/bucket';
import { begin, complete, fingerprint, release } from '../domain/idempotency';
import { detectType, essenceOf, servedContentType, storedFilename, type DetectedType } from '../domain/uploads';
import { sanitise } from '../../shared/sanitiser';
import { createPlayerMessage } from '../data/messages';
import { findGameBySlug, type GameRow } from '../data/games';
import { ensurePlayer, type PlayerRow } from '../data/players';
import { buildThreadBody, findThread } from '../data/threads';
import { newId } from '../ids';
import { objectKey, putObject, headObjectSize } from '../storage';
import { contentTypeEssence, sendJson, sendJsonText, type Ctx, type Router } from '../http';
import { parseJson, readJsonRaw } from './body';
import { attachmentBody, sendAttachmentContent } from './staff';
import { TOPICS, type Topic } from '../../shared/types';

const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function invalidIdentity(): ApiError {
  return new ApiError(401, 'invalid_identity');
}

/** The widget signature is the hex HMAC-SHA256 of the player id under the game's widget secret. */
function widgetSignature(secret: string, playerId: string): string {
  return createHmac('sha256', Buffer.from(secret, 'utf8')).update(playerId, 'utf8').digest('hex');
}

interface Identity {
  game: GameRow;
  player: PlayerRow;
}

async function requireIdentity(ctx: Ctx): Promise<Identity> {
  const game = await findGameBySlug(ctx.params.game as string);
  if (!game) throw invalidIdentity();
  const playerId = ctx.req.headers['x-hushline-player'];
  const signature = ctx.req.headers['x-hushline-player-signature'];
  if (typeof playerId !== 'string' || !PLAYER_ID_PATTERN.test(playerId)) throw invalidIdentity();
  if (typeof signature !== 'string') throw invalidIdentity();
  const expected = widgetSignature(game.widget_secret, playerId);
  const given = Buffer.from(signature.toLowerCase(), 'utf8');
  const wanted = Buffer.from(expected, 'utf8');
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) throw invalidIdentity();
  const player = await ensurePlayer(game.id, playerId);
  return { game, player };
}

/**
 * Multipart senders escape line breaks and double quotes in a part's filename,
 * so those three sequences are read back before the name is cleaned.
 */
function submittedFilename(raw: string): string {
  return raw.replace(/%0A/gi, '\n').replace(/%0D/gi, '\r').replace(/%22/gi, '"');
}

interface UploadPart {
  filename: string;
  declaredType: string;
  bytes: Buffer;
  tooLarge: boolean;
}

function readUpload(ctx: Ctx): Promise<UploadPart | null> {
  return new Promise((resolve, reject) => {
    let busboy: ReturnType<typeof Busboy>;
    try {
      busboy = Busboy({
        headers: ctx.req.headers,
        defParamCharset: 'utf8',
        limits: { fileSize: limits.uploadBytes, files: 4, fields: 8 },
      });
    } catch {
      reject(new ApiError(415, 'unsupported_media_type'));
      return;
    }
    let part: UploadPart | null = null;
    const chunks: Buffer[] = [];
    let tooLarge = false;
    busboy.on('file', (name, stream, info) => {
      if (name !== 'file' || part !== null) {
        stream.resume();
        return;
      }
      part = {
        filename: info.filename ?? '',
        declaredType: info.mimeType ?? '',
        bytes: Buffer.alloc(0),
        tooLarge: false,
      };
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        tooLarge = true;
      });
      stream.on('end', () => {
        if (part) {
          part.bytes = Buffer.concat(chunks);
          part.tooLarge = tooLarge;
        }
      });
    });
    busboy.on('error', () => reject(new ApiError(413, 'too_large')));
    busboy.on('close', () => resolve(part));
    ctx.req.pipe(busboy);
  });
}

async function storeAttachment(args: {
  attachmentId: string;
  gameId: string;
  gameSlug: string;
  threadId: string;
  topic: Topic;
  playerName: string;
  bytes: Buffer;
  detected: DetectedType;
}): Promise<void> {
  let status: 'attached' | 'failed' = 'failed';
  try {
    await putObject(objectKey(args.gameSlug, args.attachmentId), args.bytes, servedContentType(args.detected));
    const size = await headObjectSize(objectKey(args.gameSlug, args.attachmentId));
    if (size === args.bytes.length) status = 'attached';
  } catch {
    status = 'failed';
  }
  await query(`UPDATE attachments SET status = $2 WHERE id = $1`, [args.attachmentId, status]);
  publish({
    kind: 'thread',
    gameId: args.gameId,
    threadId: args.threadId,
    topic: args.topic,
    status: 'waiting',
    playerName: args.playerName,
    reason: 'attachment',
    receiptRelated: false,
  });
}

export function registerWidgetRoutes(router: Router): void {
  router.add('GET', '/api/widget/:game/me', async (ctx) => {
    const { game, player } = await requireIdentity(ctx);
    const thread = await one<{ id: string }>(`SELECT id FROM threads WHERE player_row_id = $1`, [player.id]);
    const bucket = await readBucket(player.id);
    sendJson(ctx, 200, {
      player: { id: player.player_id, name: player.name },
      thread_id: thread?.id ?? null,
      bucket: {
        level: bucket.level,
        capacity: bucket.capacity,
        retry_after_seconds: bucket.retryAfterSeconds,
      },
    });
  });

  router.add('GET', '/api/widget/:game/threads/:id', async (ctx) => {
    const { game, player } = await requireIdentity(ctx);
    const thread = await findThread(game.id, ctx.params.id as string);
    if (!thread || thread.player_row_id !== player.id) throw notFound();
    const body = await buildThreadBody(thread, {
      includeRefused: false,
      includeReceipts: true,
      gameName: game.name,
      forWidget: true,
    });
    sendJson(ctx, 200, body);
  });

  router.add('POST', '/api/widget/:game/messages', async (ctx) => {
    const raw = await readJsonRaw(ctx);
    const { game, player } = await requireIdentity(ctx);
    const payload = parseJson(raw);
    const key = ctx.req.headers['idempotency-key'];
    const target = {
      scope: `player:${game.id}:${player.id}`,
      route: 'widget-message',
      key: typeof key === 'string' ? key : '',
    };
    const outcome = await begin(target, fingerprint('widget-message', null, payload));
    if (outcome.kind === 'replay') {
      sendJsonText(ctx, outcome.status, outcome.body, { 'Idempotent-Replay': 'true' });
      return;
    }
    try {
      const existing = await one<{ id: string; topic: Topic }>(
        `SELECT id, topic FROM threads WHERE player_row_id = $1`,
        [player.id],
      );
      const body = typeof payload.body === 'string' ? payload.body : '';
      const trimmed = body.trim();
      const fields: Record<string, string> = {};
      if (trimmed.length === 0) fields.body = FIELD.messageEmpty;
      else if (trimmed.length > 2_000) fields.body = FIELD.messageLong;
      let topic: Topic = existing?.topic ?? 'other';
      if (!existing) {
        const given = payload.topic;
        if (typeof given !== 'string' || !TOPICS.includes(given as Topic)) fields.topic = FIELD.topic;
        else topic = given as Topic;
      }
      if (Object.keys(fields).length > 0) throw validation(fields);

      const bucket = await takeToken(player.id);
      if (!bucket.taken) {
        throw new ApiError(429, 'rate_limited', {
          headers: { 'Retry-After': String(bucket.retryAfterSeconds ?? 1) },
        });
      }
      const created = await createPlayerMessage({
        game,
        player,
        topic,
        body,
        sanitised: sanitise(body),
        bucket: { previous: bucket.previous, level: bucket.level },
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

  router.add('POST', '/api/widget/:game/messages/:id/attachments', async (ctx) => {
    if (contentTypeEssence(ctx.req) !== 'multipart/form-data') {
      throw new ApiError(415, 'unsupported_media_type');
    }
    const part = await readUpload(ctx);
    if (part !== null && part.tooLarge) throw new ApiError(413, 'too_large');
    const { game, player } = await requireIdentity(ctx);
    const message = await one<{ id: string; thread_id: string | null }>(
      `SELECT id, thread_id FROM messages
        WHERE id = $1 AND game_id = $2 AND player_row_id = $3 AND kind = 'player'`,
      [ctx.params.id as string, game.id, player.id],
    );
    if (!message || message.thread_id === null) throw notFound();
    if (part === null) throw validation({ file: FIELD.fileType });

    const existing = await one<{ total: string }>(
      `SELECT count(*) AS total FROM attachments WHERE message_id = $1`,
      [message.id],
    );
    if (Number(existing?.total ?? 0) >= limits.maxAttachmentsPerMessage) {
      throw validation({ file: FIELD.fileCount });
    }
    const detected = detectType(part.bytes);
    if (detected === null || essenceOf(part.declaredType) !== detected) {
      throw validation({ file: FIELD.fileType });
    }
    const attachmentId = newId('att');
    const filename = storedFilename(submittedFilename(part.filename));
    await query(
      `INSERT INTO attachments (id, message_id, game_id, player_row_id, filename, content_type, size, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'uploading')`,
      [attachmentId, message.id, game.id, player.id, filename, detected, part.bytes.length],
    );
    const thread = await findThread(game.id, message.thread_id);
    sendJson(ctx, 202, {
      attachment: {
        id: attachmentId,
        message_id: message.id,
        filename,
        content_type: detected,
        size: part.bytes.length,
        status: 'uploading',
      },
    });
    if (thread) {
      void storeAttachment({
        attachmentId,
        gameId: game.id,
        gameSlug: game.slug,
        threadId: thread.id,
        topic: thread.topic,
        playerName: player.name,
        bytes: part.bytes,
        detected,
      });
    }
  });

  router.add('GET', '/api/widget/:game/attachments/:id', async (ctx) => {
    const { game, player } = await requireIdentity(ctx);
    const row = await one<{
      id: string;
      message_id: string;
      filename: string;
      content_type: DetectedType;
      size: string;
      status: string;
    }>(
      `SELECT id, message_id, filename, content_type, size, status FROM attachments
        WHERE id = $1 AND game_id = $2 AND player_row_id = $3`,
      [ctx.params.id as string, game.id, player.id],
    );
    if (!row) throw notFound();
    sendJson(ctx, 200, attachmentBody(row));
  });

  router.add('GET', '/api/widget/:game/attachments/:id/content', async (ctx) => {
    const { game, player } = await requireIdentity(ctx);
    const row = await one<{
      id: string;
      filename: string;
      content_type: DetectedType;
      status: string;
    }>(
      `SELECT id, filename, content_type, status FROM attachments
        WHERE id = $1 AND game_id = $2 AND player_row_id = $3`,
      [ctx.params.id as string, game.id, player.id],
    );
    if (!row) throw notFound();
    await sendAttachmentContent(ctx, { ...row, game_slug: game.slug });
  });
}
