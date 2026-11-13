// The one event verification order.
import { query, transaction } from './db';
import { loadConfig } from './config';
import { hmacSha256Hex, newId, timingSafeEqualHex } from './crypto';
import { ERRORS, HttpError } from './http';
import { currencyExponent } from './amounts';
import { insertVerdict, eventVerdict } from './forensics';
import { publish } from './live';
import { serialiseMessage, iso, type MessageRow } from './serialise';
import { purchaseViews } from './purchases';

export interface GameRecord {
  id: string;
  slug: string;
  name: string;
  server_secret: string;
  previous_server_secret: string | null;
  previous_secret_until: Date | null;
}

export async function loadGameBySlug(slug: string): Promise<GameRecord | null> {
  const result = await query<GameRecord>('SELECT id, slug, name, server_secret, previous_server_secret, previous_secret_until FROM games WHERE slug = $1', [slug]);
  return result.rows[0] ?? null;
}

export interface EventOutcome {
  status: 201 | 200;
  body: { status: 'accepted' | 'duplicate'; message_id: string };
}

interface EventFieldProblem {
  field: string;
}

export async function acceptEvent(game: GameRecord, rawBody: Buffer, timestamp: string | undefined, signature: string | undefined): Promise<EventOutcome> {
  if (rawBody.length > 65_536) throw ERRORS.tooLarge();
  const parsed = parseJson(rawBody);
  const problems: EventFieldProblem[] = [];
  const body = parsed ?? {};
  const usedPrevious = verifySignature(game, rawBody, timestamp ?? '', signature ?? '');
  if (usedPrevious === null) throw ERRORS.badSignature();
  if (!timestampWindowOk(timestamp ?? '')) throw ERRORS.staleTimestamp();
  const fields = validateEventFields(body);
  problems.push(...fields);
  if (fields.length > 0) {
    const fieldMap: Record<string, string> = {};
    for (const problem of fields) {
      fieldMap[problem.field] = problem.field === 'currency' ? 'Use one of the published currencies.' : 'This field is missing or not valid.';
    }
    throw new HttpError(422, 'validation', 'Some fields need attention.', fieldMap);
  }
  const nonce = String(body.nonce);
  const stored = await transaction(async (client) => {
    const insert = await client.query(
      'INSERT INTO nonces (game_id, nonce, expires_at) VALUES ($1,$2, now() + ($3 || \' seconds\')::interval) ON CONFLICT DO NOTHING',
      [game.id, nonce, String(loadConfig().webhookNonceTtlSeconds)],
    );
    return insert.rowCount === 1;
  });
  if (!stored) {
    await recordRefusal(game, body, 'signature refused: nonce already seen');
    throw ERRORS.nonceSeen();
  }
  const type = body.type as 'purchase.receipt' | 'purchase.refunded' | 'match.finished';
  if (type === 'purchase.receipt') {
    const existing = await query<{ message_id: string }>('SELECT message_id FROM purchases WHERE game_id=$1 AND receipt_id=$2', [game.id, body.receipt_id]);
    if (existing.rows.length > 0) return { status: 200, body: { status: 'duplicate', message_id: existing.rows[0].message_id } };
  }
  if (type === 'purchase.refunded') {
    const existing = await query<{ message_id: string }>('SELECT message_id FROM refunds WHERE game_id=$1 AND refund_id=$2', [game.id, body.refund_id]);
    if (existing.rows.length > 0) return { status: 200, body: { status: 'duplicate', message_id: existing.rows[0].message_id } };
  }
  const message = await storeAcceptedEvent(game, body, usedPrevious);
  return { status: 201, body: { status: 'accepted', message_id: message.id } };
}

export async function recordRefusal(game: GameRecord, body: Record<string, unknown>, verdict: string, secret: 'current' | 'previous' = 'current'): Promise<void> {
  const playerId = typeof body.player_id === 'string' ? body.player_id : null;
  if (!playerId) return;
  const player = await query<{ id: string; name: string }>('SELECT id, name FROM players WHERE game_id=$1 AND id=$2', [game.id, playerId]);
  if (player.rows.length === 0) return;
  const thread = await query<{ id: string }>('SELECT id FROM threads WHERE game_id=$1 AND player_id=$2', [game.id, playerId]);
  if (thread.rows.length === 0) return;
  const messageId = newId('msg');
  const type = typeof body.type === 'string' ? body.type : 'purchase.receipt';
  const eventBody = eventFieldsFromBody(body);
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at,
        event_type, event_verdict, event_receipt_id, event_refund_id, event_refund_applied, event_item, event_amount_minor, event_currency,
        event_match_id, event_mode, event_result, event_duration_seconds)
       VALUES ($1,$2,$3,'event','game_server',$4,NULL,now(),$5,'refused',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        messageId, thread.rows[0].id, game.id, game.name, type,
        eventBody.receipt_id, eventBody.refund_id, null, eventBody.item, eventBody.amount_minor, eventBody.currency,
        eventBody.match_id, eventBody.mode, eventBody.result, eventBody.duration_seconds,
      ],
    );
  });
  await insertVerdict(messageId, eventVerdict(verdict, secret));
  publish({
    event: 'message',
    gameId: game.id,
    threadId: thread.rows[0].id,
    payload: { message_id: messageId, refused: true, reason: verdict },
  });
}

function eventFieldsFromBody(body: Record<string, unknown>): {
  receipt_id: string | null; refund_id: string | null; item: string | null; amount_minor: number | null; currency: string | null;
  match_id: string | null; mode: string | null; result: string | null; duration_seconds: number | null;
} {
  const type = body.type;
  if (type === 'purchase.receipt') {
    return {
      receipt_id: body.receipt_id as string, refund_id: null, item: body.item as string,
      amount_minor: body.amount_minor as number, currency: body.currency as string,
      match_id: null, mode: null, result: null, duration_seconds: null,
    };
  }
  if (type === 'purchase.refunded') {
    return {
      receipt_id: body.receipt_id as string, refund_id: body.refund_id as string, item: null,
      amount_minor: body.amount_minor as number, currency: body.currency as string,
      match_id: null, mode: null, result: null, duration_seconds: null,
    };
  }
  return {
    receipt_id: null, refund_id: null, item: null, amount_minor: null, currency: null,
    match_id: body.match_id as string, mode: body.mode as string, result: body.result as string, duration_seconds: body.duration_seconds as number,
  };
}

async function storeAcceptedEvent(game: GameRecord, body: Record<string, unknown>, usedPrevious: 'current' | 'previous'): Promise<{ id: string; threadId: string }> {
  const playerId = body.player_id as string;
  let threadId: string;
  const player = await query<{ id: string }>('SELECT id FROM players WHERE game_id=$1 AND id=$2', [game.id, playerId]);
  if (player.rows.length === 0) {
    await query('INSERT INTO players (id, game_id, name) VALUES ($1,$2,$1)', [playerId, game.id]);
    await query('INSERT INTO buckets (game_id, player_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [game.id, playerId]);
  }
  const thread = await query<{ id: string }>('SELECT id FROM threads WHERE game_id=$1 AND player_id=$2', [game.id, playerId]);
  if (thread.rows.length === 0) {
    const created = await query<{ id: string }>(
      'INSERT INTO threads (id, game_id, player_id, topic, status) VALUES ($1,$2,$3,\'other\',\'answered\') ON CONFLICT (game_id, player_id) DO UPDATE SET game_id = EXCLUDED.game_id RETURNING id',
      [newId('thr'), game.id, playerId],
    );
    threadId = created.rows[0].id;
  } else {
    threadId = thread.rows[0].id;
  }
  const messageId = newId('msg');
  const eventBody = eventFieldsFromBody(body);
  const type = body.type as string;
  let refundApplied: boolean | null = null;
  if (type === 'purchase.refunded') {
    const purchase = await query<{ amount_minor: string; currency: string }>('SELECT amount_minor, currency FROM purchases WHERE game_id=$1 AND receipt_id=$2', [game.id, body.receipt_id]);
    refundApplied = purchase.rows.length === 0 ? null : purchase.rows[0].currency === body.currency;
  }
  await transaction(async (client) => {
    await client.query(
      `INSERT INTO messages (id, thread_id, game_id, kind, author_role, author_name, body, created_at,
        event_type, event_verdict, event_receipt_id, event_refund_id, event_refund_applied, event_item, event_amount_minor, event_currency,
        event_match_id, event_mode, event_result, event_duration_seconds)
       VALUES ($1,$2,$3,'event','game_server',$4,NULL,$5,$6,'accepted',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        messageId, threadId, game.id, game.name, new Date(body.occurred_at as string), type,
        eventBody.receipt_id, eventBody.refund_id, refundApplied, eventBody.item, eventBody.amount_minor, eventBody.currency,
        eventBody.match_id, eventBody.mode, eventBody.result, eventBody.duration_seconds,
      ],
    );
  });
  const verdictText = usedPrevious === 'previous' ? 'signature valid: previous secret' : 'signature valid';
  await insertVerdict(messageId, eventVerdict(verdictText, usedPrevious));
  if (type === 'purchase.receipt') {
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO purchases (game_id, receipt_id, message_id, item, amount_minor, currency, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (game_id, receipt_id) DO NOTHING`,
        [game.id, body.receipt_id, messageId, body.item, body.amount_minor, body.currency, new Date(body.occurred_at as string)],
      );
    });
  }
  if (type === 'purchase.refunded') {
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO refunds (game_id, refund_id, message_id, receipt_id, amount_minor, currency, applied, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (game_id, refund_id) DO NOTHING`,
        [game.id, body.refund_id, messageId, body.receipt_id, body.amount_minor, body.currency, refundApplied ?? false, new Date(body.occurred_at as string)],
      );
    });
  }
  publish({ event: 'message', gameId: game.id, threadId, payload: { message_id: messageId, refused: false } });
  return { id: messageId, threadId };
}

function parseJson(raw: Buffer): Record<string, unknown> | null {
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function verifySignature(game: GameRecord, rawBody: Buffer, timestamp: string, signature: string): 'current' | 'previous' | null {
  if (!signature.startsWith('v1=')) return null;
  const provided = signature.slice(3);
  const material = `${timestamp}.${rawBody.toString('utf8')}`;
  const current = hmacSha256Hex(game.server_secret, material);
  if (timingSafeEqualHex(current, provided)) return 'current';
  if (game.previous_server_secret && game.previous_secret_until && game.previous_secret_until.getTime() > Date.now()) {
    const previous = hmacSha256Hex(game.previous_server_secret, material);
    if (timingSafeEqualHex(previous, provided)) return 'previous';
  }
  return null;
}

export function timestampWindowOk(timestamp: string): boolean {
  if (!/^\d+$/.test(timestamp)) return false;
  const value = Number.parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - value) <= 300;
}

function validateEventFields(body: Record<string, unknown>): EventFieldProblem[] {
  const problems: EventFieldProblem[] = [];
  const nonce = body.nonce;
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(nonce)) problems.push({ field: 'nonce' });
  const type = body.type;
  if (type !== 'purchase.receipt' && type !== 'purchase.refunded' && type !== 'match.finished') problems.push({ field: 'type' });
  const playerId = body.player_id;
  if (typeof playerId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(playerId)) problems.push({ field: 'player_id' });
  const occurred = body.occurred_at;
  if (typeof occurred !== 'string' || Number.isNaN(Date.parse(occurred))) problems.push({ field: 'occurred_at' });
  if (type === 'purchase.receipt') {
    if (typeof body.receipt_id !== 'string' || body.receipt_id.length < 1 || body.receipt_id.length > 64) problems.push({ field: 'receipt_id' });
    if (typeof body.item !== 'string' || body.item.length < 1 || body.item.length > 80) problems.push({ field: 'item' });
    if (typeof body.amount_minor !== 'number' || !Number.isInteger(body.amount_minor) || body.amount_minor < 0 || body.amount_minor > 999_999_999) problems.push({ field: 'amount_minor' });
    if (typeof body.currency !== 'string' || currencyExponent(body.currency) === null) problems.push({ field: 'currency' });
  }
  if (type === 'purchase.refunded') {
    if (typeof body.refund_id !== 'string' || body.refund_id.length < 1 || body.refund_id.length > 64) problems.push({ field: 'refund_id' });
    if (typeof body.receipt_id !== 'string' || body.receipt_id.length < 1 || body.receipt_id.length > 64) problems.push({ field: 'receipt_id' });
    if (typeof body.amount_minor !== 'number' || !Number.isInteger(body.amount_minor) || body.amount_minor < 1 || body.amount_minor > 999_999_999) problems.push({ field: 'amount_minor' });
    if (typeof body.currency !== 'string' || currencyExponent(body.currency) === null) problems.push({ field: 'currency' });
  }
  if (type === 'match.finished') {
    if (typeof body.match_id !== 'string' || body.match_id.length < 1 || body.match_id.length > 64) problems.push({ field: 'match_id' });
    if (typeof body.mode !== 'string' || body.mode.length < 1 || body.mode.length > 40) problems.push({ field: 'mode' });
    if (body.result !== 'won' && body.result !== 'lost' && body.result !== 'abandoned') problems.push({ field: 'result' });
    if (typeof body.duration_seconds !== 'number' || !Number.isInteger(body.duration_seconds) || body.duration_seconds < 0) problems.push({ field: 'duration_seconds' });
  }
  return problems;
}

export async function threadEventMessage(gameId: string, threadId: string, messageId: string): Promise<Record<string, unknown> | null> {
  const result = await query<MessageRow>('SELECT * FROM messages WHERE id=$1 AND thread_id=$2 AND game_id=$3', [messageId, threadId, gameId]);
  if (result.rows.length === 0) return null;
  return serialiseMessage(result.rows[0], [], null, true);
}

export function eventTime(value: Date): string {
  return iso(value) ?? new Date().toISOString();
}

export async function threadPurchases(gameId: string, receiptIds: string[]) {
  return purchaseViews(gameId, receiptIds);
}
