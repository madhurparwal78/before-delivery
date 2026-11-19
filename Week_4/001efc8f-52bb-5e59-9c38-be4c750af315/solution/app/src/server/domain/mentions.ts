import { randomUUID } from "node:crypto";
import type pg from "pg";
import { rows } from "../db.js";

// Mention tokens: "@" not preceded by a letter or digit, then the longest run of letters, digits,
// dots, dashes and underscores, with trailing dots and dashes dropped; compared to handles
// ignoring case.
const TOKEN = /(?<![\p{L}\p{N}])@([\p{L}\p{N}._-]+)/gu;

function mentionedHandles(text: string): string[] {
  const handles = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    const handle = (match[1] ?? "").replace(/[.-]+$/, "").toLowerCase();
    if (handle) handles.add(handle);
  }
  return [...handles];
}

// One mention per mentioned current member other than the author, from the text as sent.
export async function recordMentions(client: pg.PoolClient, message: { id: string; channelId: string; authorId: string; text: string }): Promise<void> {
  const handles = mentionedHandles(message.text);
  if (handles.length === 0) return;
  const people = await rows<{ user_id: string }>(
    client,
    `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.channel_id = $1 AND m.user_id <> $2 AND lower(u.handle) = ANY($3::text[])`,
    [message.channelId, message.authorId, handles],
  );
  for (const person of people) {
    await client.query("INSERT INTO mentions (id, message_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", [
      randomUUID(), message.id, person.user_id,
    ]);
  }
}

// A mention (alias mn, its message m) is answered when, right now, the mentioned person has a
// surviving message in the same thread sent after it. Worked out at each digest run.
export const ANSWERED = `EXISTS (
  SELECT 1 FROM messages ans
   WHERE ans.author_id = mn.user_id AND ans.deleted_at IS NULL
     AND ans.thread_root_id = COALESCE(m.thread_root_id, m.id)
     AND ans.sent_at > m.sent_at)`;
