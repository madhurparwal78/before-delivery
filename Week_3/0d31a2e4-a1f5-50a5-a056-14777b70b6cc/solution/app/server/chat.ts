// Party chat and direct messages, with the shared send-rate limit.
import type pg from "pg";
import { emit, LOCK, lockKey, one, query, type Row, transaction } from "./db.js";
import { ApiError, FIELD_COPY, fieldError } from "./errors.js";
import { route } from "./http.js";
import { positiveId } from "./matches.js";
import { partyIdOf } from "./party.js";
import { areFriends, blockBetween, iso } from "./users.js";
import type { Message } from "../shared/api.js";
import { HISTORY_SIZE, MESSAGE_MAX, RATE_COUNT, RATE_WINDOW_MS } from "../shared/rules.js";


const COLUMNS = "id, channel, party_id, from_user_id, to_user_id, body, sent_at";

function toMessage(row: Row): Message {
  return {
    id: Number(row["id"]),
    channel: row["channel"] === "dm" ? "dm" : "party",
    partyId: row["party_id"] === null ? null : Number(row["party_id"]),
    fromUserId: Number(row["from_user_id"]),
    toUserId: row["to_user_id"] === null ? null : Number(row["to_user_id"]),
    body: String(row["body"]),
    sentAt: iso(row["sent_at"]),
  };
}

export async function loadMessage(id: number): Promise<Message | null> {
  const row = await one(`SELECT ${COLUMNS} FROM messages WHERE id = $1`, [id]);
  return row === undefined ? null : toMessage(row);
}

function messageBody(value: unknown): string {
  const body = typeof value === "string" ? value.trim() : "";
  if (body.length < 1 || body.length > MESSAGE_MAX) throw fieldError({ body: FIELD_COPY.body });
  return body;
}

// At most five messages per sender in any rolling five seconds, across every channel.
async function checkRate(client: pg.PoolClient, userId: number): Promise<Date> {
  await lockKey(client, LOCK.sender, userId);
  const now = new Date();
  const recent = await query<{ sent_at: Date }>(
    "SELECT sent_at FROM messages WHERE from_user_id = $1 AND sent_at > $2 ORDER BY sent_at", [userId, new Date(now.getTime() - RATE_WINDOW_MS)], client);
  const oldest = recent[0];
  if (recent.length >= RATE_COUNT && oldest !== undefined) {
    const wait = Math.max(1, Math.ceil((oldest.sent_at.getTime() + RATE_WINDOW_MS - now.getTime()) / 1000));
    throw new ApiError("rate_limited", {}, { "Retry-After": String(wait) });
  }
  return now;
}

async function store(fields: { channel: "party" | "dm"; partyId: number | null; from: number; to: number | null; body: string }): Promise<Message> {
  return transaction(async (client) => {
    const now = await checkRate(client, fields.from);
    const row = await one(
      `INSERT INTO messages (channel, party_id, from_user_id, to_user_id, body, sent_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [fields.channel, fields.partyId, fields.from, fields.to, fields.body, now], client);
    if (row === undefined) throw new Error("message not stored");
    await emit(client, { kind: "chat", messageId: Number(row["id"]) });
    return toMessage(row);
  });
}

async function newest(where: string, values: unknown[]): Promise<Message[]> {
  const rows = await query(`SELECT * FROM (SELECT ${COLUMNS} FROM messages WHERE ${where} ORDER BY id DESC LIMIT ${HISTORY_SIZE}) recent ORDER BY id`, values);
  return rows.map(toMessage);
}

route("GET", "/api/party/messages", "verified", async ({ me }) => ({
  status: 200,
  body: { messages: await newest("channel = 'party' AND party_id = $1", [await partyIdOf(me.id)]) },
}));

route("POST", "/api/party/messages", "verified", async ({ me, body }) => {
  const text = messageBody(body["body"]);
  const message = await store({ channel: "party", partyId: await partyIdOf(me.id), from: me.id, to: null, body: text });
  return { status: 201, body: { message } };
});

route("GET", "/api/dms/:userId/messages", "verified", async ({ me, params }) => ({
  status: 200,
  body: {
    messages: await newest(
      "channel = 'dm' AND ((from_user_id = $1 AND to_user_id = $2) OR (from_user_id = $2 AND to_user_id = $1))", [me.id, positiveId(params[0])]),
  },
}));

route("POST", "/api/dms/:userId/messages", "verified", async ({ me, params, body }) => {
  const other = positiveId(params[0]);
  if (await blockBetween(me.id, other)) throw new ApiError("blocked");
  if (!(await areFriends(me.id, other))) throw new ApiError("not_friends");
  const message = await store({ channel: "dm", partyId: null, from: me.id, to: other, body: messageBody(body["body"]) });
  return { status: 201, body: { message } };
});
