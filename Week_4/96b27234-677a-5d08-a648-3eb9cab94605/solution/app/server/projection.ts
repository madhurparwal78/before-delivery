import { SOMEONE, type AvatarState, type FeatureView, type Layout, type PersonView } from "../shared/protocol.js";
import { blockedWith } from "./blocks.js";
import { one, query } from "./db.js";
import { rankOrder } from "./rank.js";
import { distance, readStance, tileKey, withinReach, type Stance } from "./room.js";
import type { SessionRow } from "./sessiondata.js";
import { positionsKey, run, tilesKey } from "./valkey.js";

interface InsideView {
  roomVersion: number;
  layout: Layout;
  features: FeatureView[];
  people: PersonView[];
  nearby: string[];
  nearest: string | null;
}

interface MemberRow {
  person_id: string;
  room_version: number;
  display_name: string;
  avatar_rank: string | null;
}

/** Layout of one version of a room. */
export async function layoutOf(roomId: string, version: number): Promise<Layout> {
  const row = await one<{ layout: Layout }>("SELECT layout FROM asset_versions WHERE asset_id = $1 AND version = $2", [roomId, version]);
  return row?.layout as Layout;
}

/** Everyone's stance and who holds each tile, from the session's Valkey keys. */
export async function readRoom(sessionId: string): Promise<{ stances: Map<string, Stance>; tiles: Map<string, string> }> {
  const [positions, tiles] = await run((client) => Promise.all([client.hgetall(positionsKey(sessionId)), client.hgetall(tilesKey(sessionId))]));
  return {
    stances: new Map(Object.entries(positions).map(([id, record]) => [id, readStance(record)])),
    tiles: new Map(Object.entries(tiles)),
  };
}

/** The room as one viewer sees it: real names unless a block stands between, avatars by their rank setting. */
export async function projectInside(session: SessionRow, viewerId: string): Promise<InsideView | null> {
  const members = await query<MemberRow>(
    `SELECT m.person_id, m.room_version, p.display_name, v.rank AS avatar_rank
     FROM session_members m JOIN people p ON p.id = m.person_id
     LEFT JOIN assets a ON a.id = p.avatar_id AND NOT a.removed AND a.kind = 'avatar'
     LEFT JOIN asset_versions v ON v.asset_id = a.id AND v.version = a.current_version
     WHERE m.session_id = $1 AND NOT m.gone ORDER BY m.joined_seq`,
    [session.id],
  );
  const mine = members.find((member) => member.person_id === viewerId);
  if (!mine) return null;
  const [setting, blocked, room] = await Promise.all([
    one<{ hide_above: string | null }>("SELECT hide_above FROM people WHERE id = $1", [viewerId]),
    blockedWith(viewerId),
    readRoom(session.id),
  ]);
  const layout = await layoutOf(session.roomId, mine.room_version);
  const hideAbove = setting?.hide_above ?? null;
  const people: PersonView[] = [];
  for (const member of members) {
    const stance = room.stances.get(member.person_id);
    if (!stance) continue;
    const apart = blocked.has(member.person_id);
    let avatar: AvatarState = "shown";
    if (apart || member.avatar_rank === null) avatar = "fallback";
    else if (member.person_id !== viewerId && hideAbove !== null && rankOrder(member.avatar_rank) > rankOrder(hideAbove)) avatar = "hidden";
    people.push({
      personId: member.person_id,
      displayName: apart ? SOMEONE : member.display_name,
      x: stance.x,
      y: stance.y,
      facing: stance.facing,
      seated: stance.seated,
      avatar,
      host: member.person_id === session.hostId,
    });
  }
  const features: FeatureView[] = [
    ...layout.seats.map((seat) => ({ id: seat.id, kind: "seat" as const, x: seat.x, y: seat.y, occupiedBy: room.tiles.get(tileKey(seat.x, seat.y)) ?? null })),
    ...layout.exits.map((exit) => ({ id: exit.id, kind: "exit" as const, x: exit.x, y: exit.y, occupiedBy: null })),
  ];
  const self = room.stances.get(viewerId);
  const others = self ? people.filter((person) => person.personId !== viewerId) : [];
  const byDistance = (a: PersonView, b: PersonView): number =>
    distance(self as Stance, a) - distance(self as Stance, b) || a.displayName.localeCompare(b.displayName) || a.personId.localeCompare(b.personId);
  const ordered = [...others].sort(byDistance);
  return {
    roomVersion: mine.room_version,
    layout,
    features,
    people,
    nearby: ordered.filter((person) => withinReach(self as Stance, person)).map((person) => person.personId),
    nearest: ordered[0]?.personId ?? null,
  };
}
