import { isoBrussels } from "../../shared/time";
import type { Message, Presence } from "../../shared/api";
import { now, nowMs } from "../clock";
import { config } from "../config";
import { newId, type Db, type TxHandle } from "../db";
import { apiErrors } from "../http/errors";
import { messageRateKey, presenceOf, restoreRate, takeFromWindow } from "../valkey";
import { emitMessage } from "./events";


const MINUTE_MS = 60_000;
export const MESSAGE_MAX = 1000;

export async function takeMessageSlot(memberId: string): Promise<void> {
  const verdict = await takeFromWindow(messageRateKey(memberId), nowMs(), MINUTE_MS, config.messageRatePerMinute, newId());
  if (!verdict.allowed) throw apiErrors.messageRateLimited(verdict.retryAfterSeconds);
}

export async function storeMessage(db: TxHandle, bookingId: string, authorId: string, body: string): Promise<Message> {
  const id = newId();
  const sentAt = now();
  await db.query("INSERT INTO messages (id, booking_id, author_id, body, sent_at) VALUES ($1, $2, $3, $4, $5)", [id, bookingId, authorId, body, sentAt]);
  db.afterCommit(() => emitMessage(bookingId, { id, author_id: authorId, body, sent_at: sentAt }));
  return { id, author_id: authorId, body, sent_at: isoBrussels(sentAt) };
}

export async function listMessages(db: Db, bookingId: string): Promise<Message[]> {
  const { rows } = await db.query<{ id: string; author_id: string; body: string; sent_at: Date }>(
    "SELECT id, author_id, body, sent_at FROM messages WHERE booking_id = $1 ORDER BY seq",
    [bookingId],
  );
  return rows.map((row) => ({ ...row, sent_at: isoBrussels(row.sent_at) }));
}

export async function presenceView(bookingId: string, memberId: string): Promise<Presence> {
  const seen = await presenceOf(bookingId, memberId);
  return { member_id: memberId, online: seen.online, last_seen_at: seen.lastSeen };
}

/** Rebuild the message counter from messages stored in the last 60 seconds. */
export async function restoreMessageRates(db: Db): Promise<void> {
  const { rows } = await db.query<{ id: string; author_id: string; sent_at: Date }>("SELECT id, author_id, sent_at FROM messages WHERE sent_at > $1", [new Date(nowMs() - MINUTE_MS)]);
  const byAuthor = new Map<string, { member: string; scoreMs: number }[]>();
  for (const row of rows) byAuthor.set(row.author_id, [...(byAuthor.get(row.author_id) ?? []), { member: row.id, scoreMs: row.sent_at.getTime() }]);
  for (const [author, entries] of byAuthor) await restoreRate(messageRateKey(author), entries);
}
