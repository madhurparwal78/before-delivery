import { SOMEONE, type Visibility } from "../shared/protocol.js";
import { blockedWith } from "./blocks.js";
import { one, query, type Db } from "./db.js";
import type { Person } from "./people.js";

export interface SessionRow {
  id: string;
  worldId: string;
  roomId: string;
  roomName: string;
  hostId: string;
  hostName: string;
  visibility: Visibility;
  capacity: number;
  communityId: string | null;
  count: number;
}

interface Raw {
  id: string;
  world_id: string;
  room_id: string;
  room_name: string;
  host_id: string;
  host_name: string;
  visibility: Visibility;
  capacity: number;
  community_id: string | null;
  count: number;
}

const SELECT = `
  SELECT s.id, s.world_id, s.room_id, a.name AS room_name, s.host_id, h.display_name AS host_name, s.visibility, s.capacity,
         s.community_id, (SELECT count(*) FROM session_members m WHERE m.session_id = s.id AND NOT m.gone) AS count
  FROM sessions s JOIN assets a ON a.id = s.room_id JOIN people h ON h.id = s.host_id`;

const toRow = (raw: Raw): SessionRow => ({
  id: raw.id,
  worldId: raw.world_id,
  roomId: raw.room_id,
  roomName: raw.room_name,
  hostId: raw.host_id,
  hostName: raw.host_name,
  visibility: raw.visibility,
  capacity: raw.capacity,
  communityId: raw.community_id,
  count: raw.count,
});

/** An open session of the world, or null: an ended or foreign session is never found. */
export async function loadSession(id: string, worldId: string, db?: Db): Promise<SessionRow | null> {
  const raw = await one<Raw>(`${SELECT} WHERE s.id = $1 AND s.world_id = $2 AND s.status = 'open'`, [id, worldId], db);
  return raw ? toRow(raw) : null;
}

export async function openSessions(worldId: string): Promise<SessionRow[]> {
  const rows = await query<Raw>(`${SELECT} WHERE s.world_id = $1 AND s.status = 'open' ORDER BY s.created_at, s.id`, [worldId]);
  return rows.map(toRow);
}

/** Everything the visibility table needs to know about one viewer, loaded once. */
interface Access {
  friends: Set<string>;
  communities: Set<string>;
  blocked: Set<string>;
  invited: Set<string>;
  banned: Set<string>;
  inside: Set<string>;
}

export async function accessFor(viewer: Person): Promise<Access> {
  const [friends, communities, blocked, invited, banned, inside] = await Promise.all([
    query<{ id: string }>("SELECT b AS id FROM friendships WHERE a = $1 UNION SELECT a FROM friendships WHERE b = $1", [viewer.id]),
    query<{ id: string }>("SELECT community_id AS id FROM community_members WHERE person_id = $1", [viewer.id]),
    blockedWith(viewer.id),
    query<{ id: string }>("SELECT session_id AS id FROM session_invitees WHERE person_id = $1", [viewer.id]),
    query<{ id: string }>("SELECT session_id AS id FROM session_bans WHERE person_id = $1", [viewer.id]),
    query<{ id: string }>("SELECT session_id AS id FROM session_members WHERE person_id = $1 AND NOT gone", [viewer.id]),
  ]);
  const ids = (rows: { id: string }[]): Set<string> => new Set(rows.map((row) => row.id));
  return {
    friends: ids(friends),
    communities: ids(communities),
    blocked,
    invited: ids(invited),
    banned: ids(banned),
    inside: ids(inside),
  };
}

/** The visibility table: whether a viewer may see, and so join, a session. */
export function mayJoin(viewer: Person, session: SessionRow, access: Access): boolean {
  if (session.worldId !== viewer.worldId || access.banned.has(session.id)) return false;
  if (access.inside.has(session.id) || session.hostId === viewer.id) return true;
  if (session.visibility === "public" || access.blocked.has(session.hostId)) return session.visibility === "public";
  switch (session.visibility) {
    case "friends":
      return access.friends.has(session.hostId);
    case "community":
      return session.communityId !== null && access.communities.has(session.communityId);
    case "invite":
      return access.invited.has(session.id);
    default:
      return false;
  }
}

export const hostNameFor = (session: SessionRow, viewer: Person, access: Access): string =>
  access.blocked.has(session.hostId) && session.hostId !== viewer.id ? SOMEONE : session.hostName;

export const isInside = async (sessionId: string, personId: string, db?: Db): Promise<boolean> =>
  (await one("SELECT 1 AS ok FROM session_members WHERE session_id = $1 AND person_id = $2 AND NOT gone", [sessionId, personId], db)) !== null;
