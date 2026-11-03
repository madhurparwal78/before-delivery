import type { Pool } from "pg";
import type { PoolClient } from "pg";
import { ApiError, err, FIELD_MESSAGES } from "../http.js";
import { areFriends, blockedBetween } from "../db/users.js";
import { normalizeMessageBody } from "../validate.js";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 5000;

export type MessageRow = {
  id: number;
  channel: "party" | "dm";
  party_id: number | null;
  from_user: number;
  to_user: number | null;
  body: string;
  sent_at: Date;
};

export type MessageView = {
  id: number;
  channel: "party" | "dm";
  partyId: number | null;
  fromUserId: number;
  toUserId: number | null;
  body: string;
  sentAt: string;
};

function view(row: MessageRow): MessageView {
  return {
    id: row.id,
    channel: row.channel,
    partyId: row.party_id,
    fromUserId: row.from_user,
    toUserId: row.to_user,
    body: row.body,
    sentAt: row.sent_at.toISOString()
  };
}

async function partyIdOf(pool: Pool, userId: number): Promise<number> {
  const found = await pool.query<{ id: number }>(
    "SELECT p.id FROM parties p JOIN party_members m ON m.party_id = p.id WHERE m.user_id = $1",
    [userId]
  );
  const row = found.rows[0];
  if (!row) throw err("server_error");
  return row.id;
}

/** Each sender may send at most 5 messages in any rolling 5 seconds. */
async function checkRate(pool: Pool, userId: number): Promise<number> {
  const recent = await pool.query<{ sent_at: Date }>(
    "SELECT sent_at FROM messages WHERE from_user = $1 AND sent_at > $2 ORDER BY sent_at DESC",
    [userId, new Date(Date.now() - RATE_WINDOW_MS)]
  );
  if (recent.rows.length >= RATE_LIMIT) {
    const oldest = recent.rows[recent.rows.length - 1] as { sent_at: Date };
    const retryAfter = Math.max(1, Math.ceil((oldest.sent_at.getTime() + RATE_WINDOW_MS - Date.now()) / 1000));
    throw new ApiError(429, "rate_limited", "Slow down — you can send again in a few seconds.", undefined, { retryAfter });
  }
  return 0;
}

export async function listPartyMessages(pool: Pool, userId: number): Promise<MessageView[]> {
  const partyId = await partyIdOf(pool, userId);
  const rows = await pool.query<MessageRow>(
    "SELECT id, channel, party_id, from_user, to_user, body, sent_at FROM messages WHERE channel = 'party' AND party_id = $1 ORDER BY id DESC LIMIT 50",
    [partyId]
  );
  return rows.rows.reverse().map(view);
}

export async function sendPartyMessage(
  pool: Pool,
  userId: number,
  rawBody: string
): Promise<{ message: MessageView; memberIds: number[] }> {
  const body = normalizeMessageBody(rawBody);
  if (body === null) {
    throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { body: FIELD_MESSAGES.bodyInvalid });
  }
  await checkRate(pool, userId);
  const partyId = await partyIdOf(pool, userId);
  const inserted = await pool.query<MessageRow>(
    "INSERT INTO messages (channel, party_id, from_user, body) VALUES ('party', $1, $2, $3) RETURNING id, channel, party_id, from_user, to_user, body, sent_at",
    [partyId, userId, body]
  );
  const row = inserted.rows[0];
  if (!row) throw err("server_error");
  const members = await pool.query<{ user_id: number }>("SELECT user_id FROM party_members WHERE party_id = $1", [partyId]);
  return { message: view(row), memberIds: members.rows.map((m) => m.user_id) };
}

export async function listDmMessages(pool: Pool, userId: number, otherUserId: number): Promise<MessageView[]> {
  const rows = await pool.query<MessageRow>(
    `SELECT id, channel, party_id, from_user, to_user, body, sent_at FROM messages
      WHERE channel = 'dm'
        AND ((from_user = $1 AND to_user = $2) OR (from_user = $2 AND to_user = $1))
      ORDER BY id DESC LIMIT 50`,
    [userId, otherUserId]
  );
  return rows.rows.reverse().map(view);
}

export async function sendDmMessage(
  pool: Pool,
  userId: number,
  otherUserId: number,
  rawBody: string
): Promise<MessageView> {
  const body = normalizeMessageBody(rawBody);
  if (body === null) {
    throw new ApiError(422, "validation_failed", "Check the highlighted fields.", { body: FIELD_MESSAGES.bodyInvalid });
  }
  const blocked = await blockedBetween(pool, userId, otherUserId);
  if (blocked) throw new ApiError(403, "blocked", "You can't message this player.");
  const friends = await areFriends(pool, userId, otherUserId);
  if (!friends) throw new ApiError(403, "not_friends", "You can only message friends.");
  await checkRate(pool, userId);
  const inserted = await pool.query<MessageRow>(
    "INSERT INTO messages (channel, from_user, to_user, body) VALUES ('dm', $1, $2, $3) RETURNING id, channel, party_id, from_user, to_user, body, sent_at",
    [userId, otherUserId, body]
  );
  const row = inserted.rows[0];
  if (!row) throw err("server_error");
  return view(row);
}

/** Conversation partners, newest message first, for the Messages tab. */
export async function listConversations(pool: Pool, userId: number): Promise<number[]> {
  const rows = await pool.query<{ other: number }>(
    `SELECT DISTINCT ON (other) CASE WHEN from_user = $1 THEN to_user ELSE from_user END AS other
       FROM messages
      WHERE channel = 'dm' AND (from_user = $1 OR to_user = $1)
      ORDER BY other, id DESC`,
    [userId]
  );
  const latest = await pool.query<{ other: number; id: number }>(
    `SELECT CASE WHEN from_user = $1 THEN to_user ELSE from_user END AS other, max(id) AS id
       FROM messages
      WHERE channel = 'dm' AND (from_user = $1 OR to_user = $1)
      GROUP BY other
      ORDER BY id DESC`,
    [userId]
  );
  void rows;
  return latest.rows.map((row) => row.other);
}

export async function storeMessageForSeed(client: PoolClient, message: Omit<MessageRow, "id" | "sent_at">): Promise<void> {
  await client.query(
    "INSERT INTO messages (channel, party_id, from_user, to_user, body, sent_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [message.channel, message.party_id, message.from_user, message.to_user, message.body, new Date()]
  );
}
