import { conflict, notFound } from "./http.js";
import { one, query, tx } from "./db.js";
import { friendsHint, notifySession, type Note } from "./notify.js";
import type { Person } from "./people.js";
import { layoutOf, readRoom } from "./projection.js";
import { spawnCandidates, stanceRecord, tileKey, withinReach, type Stance } from "./room.js";
import type { SessionRow } from "./sessiondata.js";
import { claimSpawn, dropSession, presenceKey, releasePerson, run, socketsKey, takePlace } from "./valkey.js";

/** Others whose reach the person has just entered, and who now reach the person: both are told. */
export function nearbyNotes(mover: string, before: Stance | null, after: Stance, others: Map<string, Stance>): Note[] {
  const notes: Note[] = [];
  for (const [id, stance] of others) {
    if (id === mover) continue;
    const wasNear = before !== null && withinReach(before, stance);
    if (!wasNear && withinReach(after, stance)) {
      notes.push({ t: "nearby", viewer: id, p: mover }, { t: "nearby", viewer: mover, p: id });
    }
  }
  return notes;
}

export async function currentVersion(roomId: string): Promise<number> {
  const row = await one<{ current_version: number }>("SELECT current_version FROM assets WHERE id = $1 AND NOT removed", [roomId]);
  return row?.current_version ?? 1;
}

const FULL = "This session is full.";

/** Takes a place and a first free tile, then records the membership; a replay changes nothing. */
export async function enterSession(person: Person, session: SessionRow): Promise<void> {
  const place = await takePlace(session.id, person.id, session.capacity);
  if (place === "full") throw conflict(FULL);
  if (place === "already") {
    for (let waited = 0; waited < 40; waited += 1) {
      if (await one("SELECT 1 AS ok FROM session_members WHERE session_id = $1 AND person_id = $2 AND NOT gone", [session.id, person.id])) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return;
  }
  try {
    const version = await currentVersion(session.roomId);
    const layout = await layoutOf(session.roomId, version);
    const room = await readRoom(session.id);
    let placed: Stance | null = null;
    for (const tile of spawnCandidates(layout, (x, y) => room.tiles.has(tileKey(x, y)))) {
      const stance: Stance = { x: tile.x, y: tile.y, facing: "south", seated: false, from: null, at: 0 };
      if (await claimSpawn(session.id, person.id, tileKey(tile.x, tile.y), stanceRecord(stance))) {
        placed = stance;
        break;
      }
    }
    if (!placed) throw conflict(FULL);
    const recorded = await one(
      `INSERT INTO session_members (session_id, person_id, joined_seq, room_version, gone)
       SELECT $1, $2, nextval('join_seq'), $3, false WHERE EXISTS (SELECT 1 FROM sessions WHERE id = $1 AND status = 'open')
       ON CONFLICT (session_id, person_id) DO UPDATE SET joined_seq = excluded.joined_seq, room_version = excluded.room_version, gone = false
       RETURNING session_id`,
      [session.id, person.id, version],
    );
    if (!recorded) throw notFound();
    await run((client) => client.set(presenceKey(person.id), "1"));
    const notes: Note[] = [{ t: "arrived", p: person.id }];
    for (const [id, stance] of room.stances) {
      if (withinReach(placed, stance)) notes.push({ t: "nearby", viewer: id, p: person.id });
    }
    await notifySession(session.id, { kind: "state", notes });
  } catch (error) {
    await releasePerson(session.id, person.id).catch(() => undefined);
    throw error;
  }
  await friendsHint(person.id);
}

interface LeaveOptions {
  /** The person was sent away, so their room page reads it. */
  forced?: boolean;
  ban?: boolean;
  notes?: Note[];
}

/** Ends a person's place in a session, hands the host on and ends the session when it empties. */
export async function leaveSession(sessionId: string, personId: string, options: LeaveOptions = {}): Promise<void> {
  const outcome = await tx(async (client) => {
    const gone = await one<{ person_id: string }>(
      "UPDATE session_members SET gone = true WHERE session_id = $1 AND person_id = $2 AND NOT gone RETURNING person_id",
      [sessionId, personId],
      client,
    );
    if (!gone) return null;
    if (options.ban) await query("INSERT INTO session_bans (session_id, person_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [sessionId, personId], client);
    const host = await one<{ host_id: string }>("SELECT host_id FROM sessions WHERE id = $1 FOR UPDATE", [sessionId], client);
    const next = await one<{ person_id: string }>(
      "SELECT person_id FROM session_members WHERE session_id = $1 AND NOT gone ORDER BY joined_seq LIMIT 1",
      [sessionId],
      client,
    );
    if (!next) {
      await query("UPDATE sessions SET status = 'ended' WHERE id = $1", [sessionId], client);
      return { ended: true, newHost: null };
    }
    if (host?.host_id === personId) {
      await query("UPDATE sessions SET host_id = $2 WHERE id = $1", [sessionId, next.person_id], client);
      return { ended: false, newHost: next.person_id };
    }
    return { ended: false, newHost: null };
  });
  if (!outcome) return;
  await releasePerson(sessionId, personId);
  const notes: Note[] = [{ t: "left", p: personId }];
  if (outcome.newHost) notes.push({ t: "host", p: outcome.newHost });
  notes.push(...(options.notes ?? []));
  if (outcome.ended) await dropSession(sessionId);
  else await notifySession(sessionId, { kind: "state", notes });
  await notifySession(sessionId, { kind: "kick", personId, forced: options.forced ?? false });
  await clearPresenceIfIdle(personId);
  await friendsHint(personId);
}

/** A person with no socket anywhere and no place in any session is no longer present. */
export async function clearPresenceIfIdle(personId: string): Promise<void> {
  const stillIn = await one("SELECT 1 AS ok FROM session_members m JOIN sessions s ON s.id = m.session_id WHERE m.person_id = $1 AND NOT m.gone AND s.status = 'open'", [personId]);
  if (stillIn) return;
  await run(async (client) => {
    if ((await client.hlen(socketsKey(personId))) === 0) await client.del(presenceKey(personId));
  });
}

export async function openSessionIdsOf(personId: string, communityId?: string): Promise<string[]> {
  const rows = await query<{ session_id: string }>(
    `SELECT m.session_id FROM session_members m JOIN sessions s ON s.id = m.session_id
     WHERE m.person_id = $1 AND NOT m.gone AND s.status = 'open' AND ($2::text IS NULL OR s.community_id = $2)`,
    [personId, communityId ?? null],
  );
  return rows.map((row) => row.session_id);
}

/** Sends a person out of every open session (or of one community's), returning how many they left. */
export async function removeEverywhere(personId: string, communityId?: string): Promise<number> {
  const sessions = await openSessionIdsOf(personId, communityId);
  for (const sessionId of sessions) await leaveSession(sessionId, personId, { forced: true });
  return sessions.length;
}
