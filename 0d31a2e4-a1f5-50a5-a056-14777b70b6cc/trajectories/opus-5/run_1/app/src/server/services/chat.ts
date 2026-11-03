import type { Message } from '../../shared/types.js';
import { query, queryOne } from '../db.js';
import { fail, validationFailed } from '../errors.js';
import { hub } from '../ws/hub.js';
import type { UserRow } from './accounts.js';
import { areFriends, blockExists } from './friends.js';
import { memberIds, partyIdOf } from './parties.js';

const MESSAGE_LIMIT = 500;
const RATE_LIMIT = 5;
const RATE_WINDOW_SECONDS = 5;

interface MessageRow {
  id: number;
  channel: 'party' | 'dm';
  party_id: number | null;
  from_user_id: number;
  to_user_id: number | null;
  body: string;
  sent_at: Date;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    channel: row.channel,
    partyId: row.party_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    body: row.body,
    sentAt: row.sent_at.toISOString(),
  };
}

function checkBody(value: unknown): string {
  const body = typeof value === 'string' ? value.trim() : '';
  if (body.length < 1 || body.length > MESSAGE_LIMIT) {
    throw validationFailed({ body: `Messages are 1 to ${MESSAGE_LIMIT} characters.` });
  }
  return body;
}

/** At most five messages in any rolling five seconds, across all channels. */
async function checkRate(userId: number): Promise<void> {
  const row = await queryOne<{ sent: number; retry: number }>(
    `SELECT count(*)::int AS sent,
            ceil(extract(epoch from (min(sent_at) + interval '${RATE_WINDOW_SECONDS} seconds' - now())))::int AS retry
     FROM messages
     WHERE from_user_id = $1 AND sent_at > now() - interval '${RATE_WINDOW_SECONDS} seconds'`,
    [userId],
  );
  if (row !== null && row.sent >= RATE_LIMIT) {
    throw fail.rateLimited(Math.max(1, row.retry));
  }
}

export async function partyMessages(userId: number): Promise<Message[]> {
  const partyId = await partyIdOf(userId);
  const rows = await query<MessageRow>(
    `SELECT * FROM (
       SELECT id, channel, party_id, from_user_id, to_user_id, body, sent_at
       FROM messages WHERE channel = 'party' AND party_id = $1
       ORDER BY id DESC LIMIT 50
     ) recent ORDER BY id`,
    [partyId],
  );
  return rows.map(toMessage);
}

export async function sendPartyMessage(me: UserRow, rawBody: unknown): Promise<Message> {
  const body = checkBody(rawBody);
  await checkRate(me.id);
  const partyId = await partyIdOf(me.id);
  const row = await queryOne<MessageRow>(
    `INSERT INTO messages (channel, party_id, from_user_id, body) VALUES ('party', $1, $2, $3)
     RETURNING id, channel, party_id, to_user_id, from_user_id, body, sent_at`,
    [partyId, me.id, body],
  );
  if (row === null) throw fail.internal();
  const message = toMessage(row);
  hub.broadcast(await memberIds(partyId), { type: 'chat', message });
  return message;
}

export async function dmMessages(userId: number, otherId: number): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `SELECT * FROM (
       SELECT id, channel, party_id, from_user_id, to_user_id, body, sent_at
       FROM messages WHERE channel = 'dm'
         AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))
       ORDER BY id DESC LIMIT 50
     ) recent ORDER BY id`,
    [userId, otherId],
  );
  return rows.map(toMessage);
}

export async function sendDirectMessage(
  me: UserRow,
  otherId: number,
  rawBody: unknown,
): Promise<Message> {
  const body = checkBody(rawBody);
  if (await blockExists(me.id, otherId)) throw fail.blocked();
  if (!(await areFriends(me.id, otherId))) throw fail.notFriendsForbidden();
  await checkRate(me.id);
  const row = await queryOne<MessageRow>(
    `INSERT INTO messages (channel, from_user_id, to_user_id, body) VALUES ('dm', $1, $2, $3)
     RETURNING id, channel, party_id, from_user_id, to_user_id, body, sent_at`,
    [me.id, otherId, body],
  );
  if (row === null) throw fail.internal();
  const message = toMessage(row);
  hub.broadcast([me.id, otherId], { type: 'chat', message });
  return message;
}
