import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, limits } from '../config';
import { one, query, withTransaction } from '../db';
import { ApiError, validation } from '../errors';
import { publish } from '../bus';
import { FIELD } from '../../shared/copy';
import { isPublishedCurrency } from '../../shared/amount';
import type { EventType, Topic } from '../../shared/types';
import type { GameRow } from '../data/games';
import { ensurePlayer } from '../data/players';
import { insertEventMessage } from '../data/messages';
import type { StoredEvent } from '../data/threads';

/** The one place the game-server event checks are ordered and decided. */

export type SignatureSource = 'current' | 'previous';

export interface EventBody {
  nonce: string;
  type: EventType;
  player_id: string;
  occurred_at: Date;
  receipt_id?: string;
  refund_id?: string;
  item?: string;
  amount_minor?: number;
  currency?: string;
  match_id?: string;
  mode?: string;
  result?: string;
  duration_seconds?: number;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function signatureFor(secret: string, timestamp: string, rawBody: Buffer): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  return `v1=${mac}`;
}

export function verifyEventSignature(
  game: GameRow,
  timestamp: string,
  rawBody: Buffer,
  given: string,
): SignatureSource | null {
  if (constantTimeEqual(given, signatureFor(game.server_secret, timestamp, rawBody))) return 'current';
  if (
    game.previous_server_secret !== null &&
    game.previous_valid_until !== null &&
    game.previous_valid_until.getTime() > Date.now() &&
    constantTimeEqual(given, signatureFor(game.previous_server_secret, timestamp, rawBody))
  ) {
    return 'previous';
  }
  return null;
}

export function signatureVerdictFor(source: SignatureSource): string {
  return source === 'previous' ? 'signature valid: previous secret' : 'signature valid';
}

export function timestampInWindow(timestamp: string): boolean {
  if (!/^-?\d+$/.test(timestamp.trim())) return false;
  const seconds = Number(timestamp.trim());
  const difference = Math.abs(Date.now() / 1000 - seconds);
  return difference <= limits.eventWindowSeconds;
}

function wholeNumber(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function boundedText(value: unknown, min: number, max: number): boolean {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

export function validateEventBody(raw: Record<string, unknown>): EventBody {
  const fields: Record<string, string> = {};
  const nonce = raw.nonce;
  if (!boundedText(nonce, 8, 64) || !ID_PATTERN.test(nonce as string)) fields.nonce = FIELD.eventField;
  const type = raw.type;
  if (type !== 'purchase.receipt' && type !== 'purchase.refunded' && type !== 'match.finished') {
    fields.type = FIELD.eventField;
  }
  const playerId = raw.player_id;
  if (!boundedText(playerId, 1, 64) || !ID_PATTERN.test(playerId as string)) {
    fields.player_id = FIELD.eventField;
  }
  const occurredAt = raw.occurred_at;
  const occurred = typeof occurredAt === 'string' ? new Date(occurredAt) : new Date(Number.NaN);
  if (Number.isNaN(occurred.getTime())) fields.occurred_at = FIELD.eventField;

  if (type === 'purchase.receipt') {
    if (!boundedText(raw.receipt_id, 1, 64)) fields.receipt_id = FIELD.eventField;
    if (!boundedText(raw.item, 1, 80)) fields.item = FIELD.eventField;
    if (!wholeNumber(raw.amount_minor, 0, 999_999_999)) fields.amount_minor = FIELD.eventField;
    if (!isPublishedCurrency(raw.currency)) fields.currency = FIELD.currency;
  } else if (type === 'purchase.refunded') {
    if (!boundedText(raw.refund_id, 1, 64)) fields.refund_id = FIELD.eventField;
    if (!boundedText(raw.receipt_id, 1, 64)) fields.receipt_id = FIELD.eventField;
    if (!wholeNumber(raw.amount_minor, 1, 999_999_999)) fields.amount_minor = FIELD.eventField;
    if (!isPublishedCurrency(raw.currency)) fields.currency = FIELD.currency;
  } else if (type === 'match.finished') {
    if (!boundedText(raw.match_id, 1, 64)) fields.match_id = FIELD.eventField;
    if (!boundedText(raw.mode, 1, 40)) fields.mode = FIELD.eventField;
    if (raw.result !== 'won' && raw.result !== 'lost' && raw.result !== 'abandoned') {
      fields.result = FIELD.eventField;
    }
    if (!wholeNumber(raw.duration_seconds, 0, Number.MAX_SAFE_INTEGER)) {
      fields.duration_seconds = FIELD.eventField;
    }
  }

  if (Object.keys(fields).length > 0) throw validation(fields);
  const body: EventBody = {
    nonce: nonce as string,
    type: type as EventType,
    player_id: playerId as string,
    occurred_at: occurred,
  };
  if (type === 'purchase.receipt') {
    body.receipt_id = raw.receipt_id as string;
    body.item = raw.item as string;
    body.amount_minor = raw.amount_minor as number;
    body.currency = raw.currency as string;
  } else if (type === 'purchase.refunded') {
    body.refund_id = raw.refund_id as string;
    body.receipt_id = raw.receipt_id as string;
    body.amount_minor = raw.amount_minor as number;
    body.currency = raw.currency as string;
  } else {
    body.match_id = raw.match_id as string;
    body.mode = raw.mode as string;
    body.result = raw.result as string;
    body.duration_seconds = raw.duration_seconds as number;
  }
  return body;
}

/** Of N simultaneous deliveries with the same nonce, exactly one gets past this check. */
export async function claimNonce(gameId: string, nonce: string): Promise<boolean> {
  const claimed = await one<{ nonce: string }>(
    `INSERT INTO webhook_nonces (game_id, nonce, expires_at)
       VALUES ($1, $2, now() + ($3 || ' seconds')::interval)
       ON CONFLICT (game_id, nonce) DO UPDATE SET expires_at = now() + ($3 || ' seconds')::interval
         WHERE webhook_nonces.expires_at < now()
       RETURNING nonce`,
    [gameId, nonce, String(config.webhookNonceTtlSeconds)],
  );
  return claimed !== null;
}

function storedEvent(body: EventBody, verdict: 'accepted' | 'refused'): StoredEvent {
  const event: StoredEvent = { type: body.type, verdict };
  if (body.receipt_id !== undefined) event.receipt_id = body.receipt_id;
  if (body.refund_id !== undefined) event.refund_id = body.refund_id;
  if (body.item !== undefined) event.item = body.item;
  if (body.amount_minor !== undefined) event.amount_minor = body.amount_minor;
  if (body.currency !== undefined) event.currency = body.currency;
  if (body.match_id !== undefined) event.match_id = body.match_id;
  if (body.mode !== undefined) event.mode = body.mode;
  if (body.result !== undefined) event.result = body.result;
  if (body.duration_seconds !== undefined) event.duration_seconds = body.duration_seconds;
  return event;
}

class DuplicateDelivery extends Error {}

export interface AcceptOutcome {
  status: 200 | 201;
  messageId: string;
}

async function originalMessageId(game: GameRow, body: EventBody): Promise<string | null> {
  if (body.type === 'purchase.receipt') {
    const row = await one<{ message_id: string }>(
      `SELECT message_id FROM purchases WHERE game_id = $1 AND receipt_id = $2`,
      [game.id, body.receipt_id],
    );
    return row?.message_id ?? null;
  }
  if (body.type === 'purchase.refunded') {
    const row = await one<{ message_id: string }>(
      `SELECT message_id FROM refunds WHERE game_id = $1 AND refund_id = $2`,
      [game.id, body.refund_id],
    );
    return row?.message_id ?? null;
  }
  return null;
}

export async function acceptEvent(
  game: GameRow,
  body: EventBody,
  signature: SignatureSource,
): Promise<AcceptOutcome> {
  const existing = await originalMessageId(game, body);
  if (existing !== null) return { status: 200, messageId: existing };

  try {
    const outcome = await withTransaction(async (client) => {
      const player = await ensurePlayer(game.id, body.player_id, client);
      const thread = await client.query<{ id: string; topic: Topic }>(
        `SELECT id, topic FROM threads WHERE player_row_id = $1`,
        [player.id],
      );
      const threadRow = thread.rows[0] ?? null;
      const messageId = await insertEventMessage({
        client,
        gameId: game.id,
        threadId: threadRow?.id ?? null,
        playerRowId: player.id,
        event: storedEvent(body, 'accepted'),
        signatureVerdict: signatureVerdictFor(signature),
        occurredAt: body.occurred_at,
      });
      if (body.type === 'purchase.receipt') {
        const inserted = await client.query<{ receipt_id: string }>(
          `INSERT INTO purchases (game_id, receipt_id, item, amount_minor, currency, player_row_id,
              message_id, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (game_id, receipt_id) DO NOTHING RETURNING receipt_id`,
          [
            game.id,
            body.receipt_id,
            body.item,
            body.amount_minor,
            body.currency,
            player.id,
            messageId,
            body.occurred_at,
          ],
        );
        if (inserted.rows.length === 0) throw new DuplicateDelivery();
      } else if (body.type === 'purchase.refunded') {
        const inserted = await client.query<{ refund_id: string }>(
          `INSERT INTO refunds (game_id, refund_id, receipt_id, amount_minor, currency, player_row_id,
              message_id, occurred_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (game_id, refund_id) DO NOTHING RETURNING refund_id`,
          [
            game.id,
            body.refund_id,
            body.receipt_id,
            body.amount_minor,
            body.currency,
            player.id,
            messageId,
            body.occurred_at,
          ],
        );
        if (inserted.rows.length === 0) throw new DuplicateDelivery();
      }
      return { messageId, thread: threadRow, playerName: player.name };
    });

    if (outcome.thread !== null) {
      publish({
        kind: 'thread',
        gameId: game.id,
        threadId: outcome.thread.id,
        topic: outcome.thread.topic,
        status: 'waiting',
        playerName: outcome.playerName,
        reason: 'event',
        receiptRelated: body.type !== 'match.finished',
      });
    }
    return { status: 201, messageId: outcome.messageId };
  } catch (error) {
    if (error instanceof DuplicateDelivery) {
      const original = await originalMessageId(game, body);
      if (original !== null) return { status: 200, messageId: original };
      throw new ApiError(409, 'nonce_seen');
    }
    throw error;
  }
}

export type RefusalReason = 'bad signature' | 'outside the 300 s window' | 'nonce already seen';

/**
 * A refusal naming a known player stays on that player's record, for staff only.
 */
export async function recordRefusedEvent(
  game: GameRow,
  raw: Record<string, unknown> | null,
  reason: RefusalReason,
): Promise<void> {
  if (raw === null) return;
  const playerId = raw.player_id;
  if (typeof playerId !== 'string' || playerId === '') return;
  const player = await one<{ id: string; name: string }>(
    `SELECT id, name FROM players WHERE game_id = $1 AND player_id = $2`,
    [game.id, playerId],
  );
  if (!player) return;
  const type = typeof raw.type === 'string' ? raw.type : 'unknown';
  const occurredRaw = typeof raw.occurred_at === 'string' ? new Date(raw.occurred_at) : new Date();
  const occurredAt = Number.isNaN(occurredRaw.getTime()) ? new Date() : occurredRaw;
  const thread = await one<{ id: string; topic: Topic }>(
    `SELECT id, topic FROM threads WHERE player_row_id = $1`,
    [player.id],
  );
  const event: StoredEvent = { type, verdict: 'refused' };
  if (typeof raw.receipt_id === 'string') event.receipt_id = raw.receipt_id;
  if (typeof raw.refund_id === 'string') event.refund_id = raw.refund_id;
  if (typeof raw.item === 'string') event.item = raw.item;
  if (typeof raw.amount_minor === 'number') event.amount_minor = raw.amount_minor;
  if (typeof raw.currency === 'string') event.currency = raw.currency;
  if (typeof raw.match_id === 'string') event.match_id = raw.match_id;
  if (typeof raw.mode === 'string') event.mode = raw.mode;
  if (typeof raw.result === 'string') event.result = raw.result;
  if (typeof raw.duration_seconds === 'number') event.duration_seconds = raw.duration_seconds;

  await insertEventMessage({
    client: { query },
    gameId: game.id,
    threadId: thread?.id ?? null,
    playerRowId: player.id,
    event,
    signatureVerdict: `signature refused: ${reason}`,
    occurredAt,
  });

  if (thread) {
    publish({
      kind: 'refused_event',
      gameId: game.id,
      threadId: thread.id,
      topic: thread.topic,
      playerName: player.name,
      reasonWords: reason,
      receiptRelated: type === 'purchase.receipt' || type === 'purchase.refunded',
    });
  }
}
