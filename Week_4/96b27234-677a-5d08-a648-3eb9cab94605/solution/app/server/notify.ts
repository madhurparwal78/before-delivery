import { publishPerson, publishSession, type SessionEvent } from "./valkey.js";
import { query } from "./db.js";
import type { PersonEvent } from "../shared/protocol.js";

/** One thing worth announcing to the people in a room; each viewer reads it with names projected for them. */
export type Note =
  | { t: "arrived" | "left" | "host" | "removed-vote"; p: string }
  | { t: "nearby"; viewer: string; p: string }
  | { t: "vote-failed" };

/** Pushes a frame to one person's own sockets; a hint lost to an outage is made up on the next load. */
export async function notifyPerson(personId: string, frame: PersonEvent): Promise<void> {
  try {
    await publishPerson(personId, frame);
  } catch {
    return;
  }
}

export async function notifySession(sessionId: string, event: SessionEvent): Promise<void> {
  try {
    await publishSession(sessionId, event);
  } catch {
    return;
  }
}

/** Tells every open session a person is in to repaint, for changes to name, avatar, blocks and hiding. */
export async function repaintSessionsOf(personIds: string[]): Promise<void> {
  const rows = await query<{ session_id: string }>(
    `SELECT DISTINCT m.session_id FROM session_members m JOIN sessions s ON s.id = m.session_id
     WHERE m.person_id = ANY($1) AND NOT m.gone AND s.status = 'open'`,
    [personIds],
  );
  await Promise.all(rows.map((row) => notifySession(row.session_id, { kind: "state", notes: [] })));
}

/** Tells a person's friends to refresh their friend list, because presence or session changed. */
export async function friendsHint(personId: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `SELECT f.id FROM (SELECT b AS id FROM friendships WHERE a = $1 UNION SELECT a FROM friendships WHERE b = $1) f
     WHERE NOT EXISTS (SELECT 1 FROM blocks WHERE (from_id = $1 AND to_id = f.id) OR (from_id = f.id AND to_id = $1))`,
    [personId],
  );
  await Promise.all(rows.map((row) => notifyPerson(row.id, { type: "friends" })));
}
