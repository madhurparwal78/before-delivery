import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import { isCurrency } from '../shared/amount.js';
import { EVENT_TYPES } from '../shared/types.js';
import type { EventType, Topic } from '../shared/types.js';
import { config } from './config.js';
import { withTransaction } from './db.js';
import { noLinkLine, noTextSanitiserLine, signatureLine, storeVerdict, unmeteredBucketLine } from './forensics.js';
import { HttpError, validation } from './http.js';
import { newId } from './ids.js';
import { PLAYER_ID_FORMAT, ensurePlayer } from './players.js';
import { publish } from './hub.js';
import type { HubEvent } from './hub.js';

const WINDOW_SECONDS = 300;

export interface GameSecrets {
  id: string;
  slug: string;
  server_secret: string;
  previous_server_secret: string | null;
  previous_valid_until: Date | null;
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/;
const INVALID = 'This field is missing or not valid.';
const isEventType = (value: string): value is EventType => (EVENT_TYPES as readonly string[]).includes(value);

type Body = Record<string, unknown>;

interface ValidEvent {
  nonce: string;
  type: EventType;
  player_id: string;
  occurred_at: string;
  receipt_id: string | null;
  refund_id: string | null;
  item: string | null;
  amount_minor: number | null;
  currency: string | null;
  match_id: string | null;
  mode: string | null;
  result: string | null;
  duration_seconds: number | null;
}

const text = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && !value.includes('\u0000');
const whole = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;

export function validateEvent(body: Body): ValidEvent {
  const fields: Record<string, string> = {};
  const check = (field: string, ok: boolean, sentence = INVALID): void => {
    if (!ok) fields[field] = sentence;
  };
  check('nonce', typeof body.nonce === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.nonce));
  check('type', typeof body.type === 'string' && isEventType(body.type));
  check('player_id', typeof body.player_id === 'string' && PLAYER_ID_FORMAT.test(body.player_id));
  check('occurred_at', typeof body.occurred_at === 'string' && ISO_TIME.test(body.occurred_at) && !Number.isNaN(Date.parse(body.occurred_at)));
  if (body.type === 'purchase.receipt') {
    check('receipt_id', text(body.receipt_id, 1, 64));
    check('item', text(body.item, 1, 80));
    check('amount_minor', whole(body.amount_minor, 0, 999_999_999));
    check('currency', isCurrency(body.currency), 'Use one of the published currencies.');
  } else if (body.type === 'purchase.refunded') {
    check('refund_id', text(body.refund_id, 1, 64));
    check('receipt_id', text(body.receipt_id, 1, 64));
    check('amount_minor', whole(body.amount_minor, 1, 999_999_999));
    check('currency', isCurrency(body.currency), 'Use one of the published currencies.');
  } else if (body.type === 'match.finished') {
    check('match_id', text(body.match_id, 1, 64));
    check('mode', text(body.mode, 1, 40));
    check('result', body.result === 'won' || body.result === 'lost' || body.result === 'abandoned');
    check('duration_seconds', whole(body.duration_seconds, 0, Number.MAX_SAFE_INTEGER));
  }
  if (Object.keys(fields).length > 0) throw validation(fields);
  const pick = <T>(value: unknown): T | null => (value === undefined ? null : (value as T));
  return {
    nonce: body.nonce as string, type: body.type as EventType, player_id: body.player_id as string, occurred_at: body.occurred_at as string,
    receipt_id: pick(body.receipt_id), refund_id: pick(body.refund_id), item: pick(body.item), amount_minor: pick(body.amount_minor),
    currency: pick(body.currency), match_id: pick(body.match_id), mode: pick(body.mode), result: pick(body.result), duration_seconds: pick(body.duration_seconds),
  };
}

function lenientFields(body: Body): Omit<ValidEvent, 'nonce' | 'player_id' | 'occurred_at' | 'type'> {
  const str = (value: unknown, max: number): string | null => (text(value, 0, max) ? value : null);
  const int = (value: unknown): number | null => (Number.isInteger(value) && Math.abs(value as number) <= 2_147_483_647 ? (value as number) : null);
  return {
    receipt_id: str(body.receipt_id, 64), refund_id: str(body.refund_id, 64), item: str(body.item, 80), amount_minor: int(body.amount_minor),
    currency: isCurrency(body.currency) ? body.currency : null, match_id: str(body.match_id, 64), mode: str(body.mode, 40),
    result: body.result === 'won' || body.result === 'lost' || body.result === 'abandoned' ? body.result : null, duration_seconds: int(body.duration_seconds),
  };
}

function signatureMatches(secret: string, timestamp: string, raw: Buffer, given: string): boolean {
  const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

type Verification =
  | { ok: true; verdict: 'signature valid' | 'signature valid: previous secret' }
  | { ok: false; code: 'bad_signature' | 'stale_timestamp'; reason: string; status: 401 };

export function verifyEvent(game: GameSecrets, headers: { timestamp: string; signature: string }, raw: Buffer, nowSeconds: number): Verification {
  const previousLive = game.previous_server_secret !== null && game.previous_valid_until !== null && game.previous_valid_until.getTime() > nowSeconds * 1000;
  const current = signatureMatches(game.server_secret, headers.timestamp, raw, headers.signature);
  const previous = !current && previousLive && signatureMatches(game.previous_server_secret as string, headers.timestamp, raw, headers.signature);
  if (!current && !previous) return { ok: false, code: 'bad_signature', reason: 'bad signature', status: 401 };
  const stamp = /^\d+$/.test(headers.timestamp) ? Number(headers.timestamp) : Number.NaN;
  if (!(Math.abs(nowSeconds - stamp) <= WINDOW_SECONDS)) return { ok: false, code: 'stale_timestamp', reason: 'outside the 300 s window', status: 401 };
  return { ok: true, verdict: previous ? 'signature valid: previous secret' : 'signature valid' };
}

async function storeEventMessage(tx: PoolClient, game: GameSecrets, event: Omit<ValidEvent, 'nonce'>, verdict: 'accepted' | 'refused', signature: string): Promise<string> {
  const messageId = newId();
  await tx.query('insert into messages (id, game_id, player_id, kind, created_at) values ($1, $2, $3, $4, $5)', [messageId, game.id, event.player_id, 'event', new Date()]);
  await tx.query(
    `insert into events (message_id, game_id, type, verdict, occurred_at, receipt_id, refund_id, item, amount_minor, currency, match_id, mode, result, duration_seconds)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [messageId, game.id, event.type, verdict, Number.isNaN(Date.parse(event.occurred_at)) ? null : new Date(Date.parse(event.occurred_at)), event.receipt_id, event.refund_id, event.item,
      event.amount_minor, event.currency, event.match_id, event.mode, event.result, event.duration_seconds],
  );
  await storeVerdict(tx, messageId, signatureLine(signature));
  await storeVerdict(tx, messageId, unmeteredBucketLine());
  await storeVerdict(tx, messageId, noTextSanitiserLine());
  await storeVerdict(tx, messageId, noLinkLine());
  return messageId;
}

async function announcement(tx: PoolClient, game: GameSecrets, playerId: string, type: EventType, refused: boolean): Promise<HubEvent | null> {
  const { rows } = await tx.query<{ id: string; topic: Topic }>('select id, topic from threads where game_id = $1 and player_id = $2', [game.id, playerId]);
  const thread = rows[0];
  if (!thread) return null;
  return { kind: 'thread', gameId: game.id, threadId: thread.id, topic: thread.topic, reason: refused ? 'refused' : 'event', purchaseData: type !== 'match.finished' };
}

export async function recordRefusal(game: GameSecrets, body: Body, reason: string): Promise<void> {
  const playerId = body.player_id;
  const type = body.type;
  if (typeof playerId !== 'string' || !PLAYER_ID_FORMAT.test(playerId) || typeof type !== 'string' || !isEventType(type)) return;
  const event = await withTransaction(async (tx) => {
    const known = await tx.query('select 1 from players where game_id = $1 and id = $2', [game.id, playerId]);
    if (!known.rowCount) return null;
    const occurred = typeof body.occurred_at === 'string' ? body.occurred_at : '';
    await storeEventMessage(tx, game, { type: type as EventType, player_id: playerId, occurred_at: occurred, ...lenientFields(body) }, 'refused', `signature refused: ${reason}`);
    return announcement(tx, game, playerId, type as EventType, true);
  });
  if (event) publish(event);
}

type Acceptance =
  | { status: 201 | 200; body: { status: 'accepted' | 'duplicate'; message_id: string }; event: HubEvent | null }
  | { refusedNonce: true };

export async function acceptEvent(game: GameSecrets, event: ValidEvent, signature: string, raw: Body): Promise<Acceptance> {
  const outcome = await withTransaction(async (tx): Promise<Acceptance> => {
    const claimed = await tx.query(
      `insert into nonces (game_id, nonce, expires_at) values ($1, $2, now() + make_interval(secs => $3))
       on conflict (game_id, nonce) do update set expires_at = excluded.expires_at where nonces.expires_at <= now() returning nonce`,
      [game.id, event.nonce, config.webhookNonceTtlSeconds],
    );
    if (claimed.rowCount === 0) return { refusedNonce: true };
    const uniqueId = event.type === 'purchase.receipt' ? event.receipt_id : event.type === 'purchase.refunded' ? event.refund_id : null;
    if (uniqueId !== null) {
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`${game.id}:${event.type}:${uniqueId}`]);
      const original = await tx.query<{ message_id: string }>(
        `select message_id from events where game_id = $1 and verdict = 'accepted' and type = $2 and ${event.type === 'purchase.receipt' ? 'receipt_id' : 'refund_id'} = $3`,
        [game.id, event.type, uniqueId],
      );
      if (original.rows[0]) return { status: 200, body: { status: 'duplicate', message_id: original.rows[0].message_id }, event: null };
    }
    await ensurePlayer(tx, game.id, event.player_id);
    const messageId = await storeEventMessage(tx, game, event, 'accepted', signature);
    return { status: 201, body: { status: 'accepted', message_id: messageId }, event: await announcement(tx, game, event.player_id, event.type, false) };
  });
  if ('refusedNonce' in outcome) await recordRefusal(game, raw, 'nonce already seen');
  else if (outcome.event) publish(outcome.event);
  return outcome;
}

export const eventRefusal = (code: 'bad_signature' | 'stale_timestamp' | 'nonce_seen'): HttpError => {
  const messages = { bad_signature: 'The signature did not match.', stale_timestamp: 'The timestamp is outside the 300 s window.', nonce_seen: 'That nonce was already used.' };
  return new HttpError(code === 'nonce_seen' ? 409 : 401, code, messages[code]);
};
