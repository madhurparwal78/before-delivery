import { SOMEONE, type ChatMessage } from "../shared/protocol.js";
import { worldNow } from "./clock.js";
import { config } from "./config.js";
import { invalid, notFound, reply, Router, text, textLength, type Reply } from "./http.js";
import { query } from "./db.js";
import { notifySession } from "./notify.js";
import { newId, type Person } from "./people.js";
import { blockedWith, namesFor } from "./blocks.js";
import { readRoom } from "./projection.js";
import { withinReach } from "./room.js";
import { isInside, loadSession } from "./sessiondata.js";
import { live } from "./valkey.js";


/** Who hears a message: within reach, no block between the pair, and not muting the speaker. */
async function recipientsOf(sessionId: string, speakerId: string): Promise<string[]> {
  const room = await readRoom(sessionId);
  const speaker = room.stances.get(speakerId);
  if (!speaker) return [];
  const members = await query<{ person_id: string }>("SELECT person_id FROM session_members WHERE session_id = $1 AND NOT gone AND person_id <> $2", [
    sessionId,
    speakerId,
  ]);
  const muting = await query<{ id: string }>("SELECT from_id AS id FROM mutes WHERE to_id = $1", [speakerId]);
  const refused = new Set([...(await blockedWith(speakerId)), ...muting.map((row) => row.id)]);
  return members
    .map((member) => member.person_id)
    .filter((id) => {
      const stance = room.stances.get(id);
      return stance !== undefined && withinReach(speaker, stance) && !refused.has(id);
    });
}

export function chatRoutes(router: Router<Person>): void {
  router.add("POST", "/api/sessions/:id/chat", async (ctx, person): Promise<Reply> => {
    const session = await loadSession(ctx.params.id ?? "", person.worldId);
    if (!session || !(await isInside(session.id, person.id))) throw notFound();
    const body = text(ctx.json().text);
    if (body === null || body.trim() === "") throw invalid("Write something to send.");
    if (textLength(body) > config.chatMaxChars) throw invalid(`Messages can be at most ${config.chatMaxChars} characters.`);
    live();
    const recipients = await recipientsOf(session.id, person.id);
    const id = newId();
    const sentAt = await worldNow(person.worldId);
    await query("INSERT INTO chat_messages (id, session_id, from_id, text, sent_at, recipients) VALUES ($1, $2, $3, $4, $5, $6)", [
      id,
      session.id,
      person.id,
      body,
      sentAt,
      recipients,
    ]);
    await notifySession(session.id, { kind: "chat", message: { id, fromId: person.id, text: body, sentAt: sentAt.toISOString() }, recipients });
    return reply(201, { id, heardBy: recipients.length });
  });

  router.add("GET", "/api/sessions/:id/chat", async (ctx, person): Promise<Reply> => {
    const session = await loadSession(ctx.params.id ?? "", person.worldId);
    if (!session || !(await isInside(session.id, person.id))) throw notFound();
    const rows = await query<{ id: string; from_id: string; text: string; sent_at: Date }>(
      `SELECT c.id, c.from_id, c.text, c.sent_at FROM chat_messages c
       WHERE c.session_id = $1 AND (c.from_id = $2 OR $2 = ANY(c.recipients)) ORDER BY c.sent_at, c.id`,
      [session.id, person.id],
    );
    const names = await namesFor(person.id, [...new Set(rows.map((row) => row.from_id))]);
    const messages: ChatMessage[] = rows.map((row) => ({
      id: row.id,
      fromId: row.from_id,
      fromName: names.get(row.from_id) ?? SOMEONE,
      text: row.text,
      sentAt: row.sent_at.toISOString(),
    }));
    return reply(200, { messages });
  });
}
