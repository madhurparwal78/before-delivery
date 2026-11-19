// Live rooms: presence, positions, tile claims, chat, votes and the session
// event stream, shared across instances through the published Valkey keys.
import { config, opaqueId } from './config';
import { query } from './db';
import { valkey } from './providers';
import { isDown } from './world';
import { unavailable } from './errors';
import { CHAT_DISTANCE, type Facing, type Layout, type Tile, seatAhead, stepFrom } from '../shared/grid';

export const presenceKey = (personId: string): string => `presence:${personId}`;
export const positionsKey = (sessionId: string): string => `session:${sessionId}:positions`;
export const eventsChannel = (sessionId: string): string => `session:${sessionId}:events`;

export interface PersonState {
  x: number;
  y: number;
  facing: Facing;
  seated: boolean;
  seatId?: string;
  satFrom?: { x: number; y: number };
  name: string;
  avatarId?: string;
  joinedAt: number;
  worldId: string;
}

export interface SessionRow {
  id: string;
  world_id: string;
  room_id: string;
  host_id: string;
  visibility: string;
  capacity: number;
  community_id: string | null;
  status: string;
}

export function encodeState(s: PersonState): string {
  return JSON.stringify(s);
}

export function decodeState(raw: string): PersonState {
  return JSON.parse(raw) as PersonState;
}

// The single gate for every live command. A real failure and a grading outage
// reach the caller through the same path.
export async function requireValkey(): Promise<void> {
  if (isDown('valkey')) throw unavailable('Live rooms are unavailable right now.');
  try {
    await valkey.command('PING');
  } catch {
    throw unavailable('Live rooms are unavailable right now.');
  }
}

export async function publishEvent(sessionId: string, event: Record<string, unknown>): Promise<void> {
  try {
    await valkey.publish(eventsChannel(sessionId), JSON.stringify(event));
  } catch {
    // best effort; recovery restores the mirror from the server
  }
}

export async function allStates(sessionId: string): Promise<Map<string, PersonState>> {
  await requireValkey();
  const raw = await valkey.hgetall(positionsKey(sessionId));
  const map = new Map<string, PersonState>();
  for (const [personId, value] of Object.entries(raw)) map.set(personId, decodeState(value));
  return map;
}

export async function setState(sessionId: string, personId: string, state: PersonState): Promise<void> {
  await requireValkey();
  await valkey.hset(positionsKey(sessionId), personId, encodeState(state));
}

export async function removeState(sessionId: string, personId: string): Promise<void> {
  await requireValkey();
  await valkey.hdel(positionsKey(sessionId), personId);
}

export async function getSession(sessionId: string): Promise<SessionRow | null> {
  const rows = await query<SessionRow>(
    'SELECT id, world_id, room_id, host_id, visibility, capacity, community_id, status FROM sessions_table WHERE id = $1',
    [sessionId]
  );
  return rows[0] ?? null;
}

export interface MemberRow {
  person_id: string;
  joined_at: Date;
  room_version: number;
}

export async function activeMembers(sessionId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    'SELECT person_id, joined_at, room_version FROM session_members WHERE session_id = $1 AND left_at IS NULL ORDER BY joined_at, person_id',
    [sessionId]
  );
}

export async function isMember(sessionId: string, personId: string): Promise<boolean> {
  const rows = await query(
    'SELECT 1 FROM session_members WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL',
    [sessionId, personId]
  );
  return rows.length > 0;
}

export interface PersonRow {
  id: string;
  world_id: string;
  email: string;
  display_name: string;
  time_zone: string;
  site_role: string;
  avatar_id: string | null;
  hide_above: string | null;
  suspended: boolean;
  warned: boolean;
  confirmed: boolean;
}

export async function getPerson(personId: string): Promise<PersonRow | null> {
  const rows = await query<PersonRow>(
    `SELECT id, world_id, email, display_name, time_zone, site_role, avatar_id, hide_above, suspended, warned, confirmed
     FROM people WHERE id = $1`,
    [personId]
  );
  return rows[0] ?? null;
}

export async function isBlockedBetween(aId: string, bId: string): Promise<boolean> {
  const rows = await query(
    'SELECT 1 FROM blocks WHERE (person_id = $1 AND blocked_id = $2) OR (person_id = $2 AND blocked_id = $1)',
    [aId, bId]
  );
  return rows.length > 0;
}

export async function areFriends(aId: string, bId: string): Promise<boolean> {
  const rows = await query('SELECT 1 FROM friendships WHERE person_id = $1 AND friend_id = $2', [aId, bId]);
  return rows.length > 0;
}

export async function hasMute(muterId: string, mutedId: string): Promise<boolean> {
  const rows = await query('SELECT 1 FROM mutes WHERE person_id = $1 AND muted_id = $2', [muterId, mutedId]);
  return rows.length > 0;
}

export async function communityRoleOf(personId: string, communityId: string): Promise<string | null> {
  const rows = await query<{ role: string }>(
    'SELECT role FROM community_members WHERE person_id = $1 AND community_id = $2',
    [personId, communityId]
  );
  return rows[0]?.role ?? null;
}

export async function currentRoomVersion(roomId: string): Promise<number | null> {
  const rows = await query<{ current_version: number | null }>('SELECT current_version FROM assets WHERE id = $1', [roomId]);
  return rows[0]?.current_version ?? null;
}

export async function versionLayout(assetId: string, version: number): Promise<Layout | null> {
  const { parseLayout } = await import('../shared/grid');
  const rows = await query<{ layout: unknown }>(
    'SELECT layout FROM versions WHERE asset_id = $1 AND version = $2',
    [assetId, version]
  );
  if (!rows.length) return null;
  return parseLayout(rows[0].layout);
}

// The single place a joiner's landing tile is decided: the first free spawn
// tile in list order, else the first free tile scanning from the north row,
// west to east, facing south.
export async function placeJoiner(sessionId: string, layout: Layout): Promise<{ x: number; y: number }> {
  const states = await allStates(sessionId);
  const occupied = new Set<string>();
  states.forEach((st) => occupied.add(`${st.x},${st.y}`));
  for (const s of layout.spawn) {
    if (!occupied.has(`${s.x},${s.y}`)) return { x: s.x, y: s.y };
  }
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      if (occupied.has(`${x},${y}`)) continue;
      const { layoutAt } = await import('../shared/grid');
      if (layoutAt(layout, x, y) !== 'floor') continue;
      return { x, y };
    }
  }
  throw unavailable('This session is full.');
}

export interface PresenceInfo {
  state: 'online' | 'in-session' | 'offline';
  sessionId: string | null;
}

// ---------------------------------------------------------------------------
// Drop grace. A person with all sockets lost leaves DROP_GRACE_SECONDS later;
// a reload inside the grace keeps their tile.
// ---------------------------------------------------------------------------

const dropTimers = new Map<string, NodeJS.Timeout>();

export function scheduleDrop(sessionId: string, personId: string, worldId: string): void {
  const key = `${sessionId}:${personId}`;
  const existing = dropTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    dropTimers.delete(key);
    void completeDrop(sessionId, personId, worldId).catch(() => {});
  }, config.dropGraceSeconds * 1000);
  dropTimers.set(key, timer);
}

export function cancelDrop(sessionId: string, personId: string): void {
  const key = `${sessionId}:${personId}`;
  const t = dropTimers.get(key);
  if (t) {
    clearTimeout(t);
    dropTimers.delete(key);
  }
}

// Also used by the grading clock to complete drops that became due.
const pendingDrops = new Map<string, { sessionId: string; personId: string; worldId: string; dueAt: number }>();

export function recordPendingDrop(sessionId: string, personId: string, worldId: string, dueAt: number): void {
  pendingDrops.set(`${sessionId}:${personId}`, { sessionId, personId, worldId, dueAt });
  scheduleDrop(sessionId, personId, worldId);
}

export function clearPendingDrop(sessionId: string, personId: string): void {
  pendingDrops.delete(`${sessionId}:${personId}`);
  cancelDrop(sessionId, personId);
}

export function dueDrops(worldId: string, now: number): { sessionId: string; personId: string }[] {
  const out: { sessionId: string; personId: string }[] = [];
  pendingDrops.forEach((d, key) => {
    if (d.worldId === worldId && d.dueAt <= now) {
      out.push({ sessionId: d.sessionId, personId: d.personId });
      pendingDrops.delete(key);
    }
  });
  return out;
}

export async function completeDrop(sessionId: string, personId: string, worldId: string): Promise<void> {
  clearPendingDrop(sessionId, personId);
  if (personSockets(sessionId, personId).length > 0) return;
  await leavePerson(sessionId, personId);
  void worldId;
}

// Leaves the session: frees the tile, records the departure, hands the host
// role on and ends the session when the last person leaves. The host handover
// picks the person in the session longest, ties by id.
export async function leavePerson(sessionId: string, personId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') return;
  const states = await allStates(sessionId).catch(() => new Map<string, PersonState>());
  const leaver = states.get(personId);
  await removeState(sessionId, personId).catch(() => {});
  await query('UPDATE session_members SET left_at = now() WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL', [sessionId, personId]);
  const remaining = await allStates(sessionId).catch(() => new Map<string, PersonState>());
  const name = leaver?.name ?? 'Someone';
  if (remaining.size === 0) {
    await query("UPDATE sessions_table SET status = 'ended' WHERE id = $1", [sessionId]);
    await valkey.del(positionsKey(sessionId)).catch(() => {});
    await publishEvent(sessionId, { type: 'left', personId, name });
  } else {
    if (session.host_id === personId) {
      let nextHost: string | null = null;
      let bestJoined = Infinity;
      const members = await activeMembers(sessionId);
      for (const m of members) {
        if (m.person_id === personId) continue;
        const st = states.get(m.person_id);
        const joined = st ? st.joinedAt : m.joined_at.getTime();
        if (joined < bestJoined || (joined === bestJoined && (!nextHost || m.person_id < nextHost))) {
          bestJoined = joined;
          nextHost = m.person_id;
        }
      }
      if (nextHost) {
        await query('UPDATE sessions_table SET host_id = $1 WHERE id = $2', [nextHost, sessionId]);
        const hostName = states.get(nextHost)?.name ?? (await getPerson(nextHost))?.display_name ?? 'Someone';
        await publishEvent(sessionId, { type: 'host-changed', personId: nextHost, name: hostName });
      }
    }
    await publishEvent(sessionId, { type: 'left', personId, name });
  }
}

// ---------------------------------------------------------------------------
// Per-instance socket bookkeeping
// ---------------------------------------------------------------------------

export interface SockHandle {
  sessionId?: string;
  personId: string;
  send: (payload: string) => void;
}

const roomSockets = new Map<string, SockHandle[]>();
const meSockets = new Map<string, SockHandle[]>();

export function addRoomSocket(sessionId: string, personId: string, send: (payload: string) => void): void {
  const list = roomSockets.get(sessionId) ?? [];
  list.push({ sessionId, personId, send });
  roomSockets.set(sessionId, list);
}

export function removeRoomSocket(sessionId: string, personId: string, send: (payload: string) => void): void {
  const list = roomSockets.get(sessionId) ?? [];
  const i = list.findIndex((s) => s.send === send);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) roomSockets.delete(sessionId);
}

export function personSockets(sessionId: string, personId: string): SockHandle[] {
  return (roomSockets.get(sessionId) ?? []).filter((s) => s.personId === personId);
}

export function sessionSockets(sessionId: string): SockHandle[] {
  return roomSockets.get(sessionId) ?? [];
}

export function addMeSocket(personId: string, send: (payload: string) => void): void {
  const list = meSockets.get(personId) ?? [];
  list.push({ personId, send });
  meSockets.set(personId, list);
}

export function removeMeSocket(personId: string, send: (payload: string) => void): void {
  const list = meSockets.get(personId) ?? [];
  const i = list.findIndex((s) => s.send === send);
  if (i >= 0) list.splice(i, 1);
  if (!list.length) meSockets.delete(personId);
}

export function meSocketsFor(personId: string): SockHandle[] {
  return meSockets.get(personId) ?? [];
}

export async function markOnline(personId: string): Promise<void> {
  await valkey.set(presenceKey(personId), config.instanceName).catch(() => {});
}

export async function clearPresence(personId: string): Promise<void> {
  await valkey.del(presenceKey(personId)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  sessionId: string;
  fromId: string;
  text: string;
  sentAt: string;
  toIds: string[];
}

// The single place chat recipients are decided: within reach at send time, no
// block between the pair, and no mute of the speaker by the recipient.
export async function chatRecipients(sessionId: string, fromId: string): Promise<string[]> {
  const states = await allStates(sessionId);
  const from = states.get(fromId);
  if (!from) return [];
  const recipients: string[] = [];
  for (const [pid, st] of states) {
    if (pid === fromId) continue;
    const distance = Math.max(Math.abs(from.x - st.x), Math.abs(from.y - st.y));
    if (distance > CHAT_DISTANCE) continue;
    if (await isBlockedBetween(fromId, pid)) continue;
    if (await hasMute(pid, fromId)) continue;
    recipients.push(pid);
  }
  return recipients;
}

export async function saveChatMessage(msg: ChatMessage): Promise<void> {
  await query(
    'INSERT INTO chat_messages (id, session_id, from_id, text, sent_at, to_ids) VALUES ($1,$2,$3,$4,$5,$6)',
    [msg.id, msg.sessionId, msg.fromId, msg.text, msg.sentAt, JSON.stringify(msg.toIds)]
  );
}

export async function chatLogFor(sessionId: string, viewerId: string): Promise<ChatMessage[]> {
  const rows = await query<{ id: string; from_id: string; text: string; sent_at: string; to_ids: string[] | string }>(
    `SELECT id, from_id, text, sent_at, to_ids FROM chat_messages
     WHERE session_id = $1 AND (from_id = $2 OR to_ids @> to_jsonb($3::text[]))
     ORDER BY sent_at, id`,
    [sessionId, viewerId, [viewerId]]
  );
  return rows.map((r) => ({
    id: r.id,
    sessionId,
    fromId: r.from_id,
    text: r.text,
    sentAt: r.sent_at,
    toIds: typeof r.to_ids === 'string' ? JSON.parse(r.to_ids) : r.to_ids,
  }));
}

// User-perceived character count: an emoji, including a joined one, counts 1.
export function userPerceivedLength(text: string): number {
  const segments = Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  if (segments) {
    let count = 0;
    for (const _ of segments.segment(text)) count += 1;
    return count;
  }
  return Array.from(text).length;
}

export function seatTexts(): { noSeat: string; taken: string; already: string } {
  return { noSeat: 'No seat in front of you.', taken: 'That seat is taken.', already: 'You are already seated.' };
}

export function standTexts(): { noSpace: string; notSeated: string } {
  return { noSpace: 'No space to stand.', notSeated: 'You are not seated.' };
}

export { seatAhead, stepFrom };
export type { Tile, Facing, Layout };
export { opaqueId };
