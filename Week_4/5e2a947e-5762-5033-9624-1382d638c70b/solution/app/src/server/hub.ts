import type { WebSocket } from 'ws';
import { BRANCH_COLOURS, type BranchColour, type LiveMessage, type PresenceEntry, type Role, type Sequenced } from '../shared/model.ts';
import { can } from '../shared/rules.ts';
import { serverNow } from './clock.ts';
import { config } from './config.ts';
import { database, query, type Db } from './db.ts';
import type { Principal } from './http.ts';

export type Audience = 'all' | 'resync' | 'privileged' | 'user';

export interface Connection {
  ws: WebSocket;
  mapId: string;
  principal: Principal;
  role: Role;
  expiredNotified: boolean;
  /** Messages held back while stored events are being replayed, so replay always comes first. */
  held: object[] | null;
}

function sendConn(conn: Connection, message: object): void {
  if (conn.held) conn.held.push(message);
  else sendSocket(conn.ws, message);
}

/** End a replay: send everything held back in order. */
export function release(conn: Connection): void {
  const held = conn.held ?? [];
  conn.held = null;
  for (const message of held) sendSocket(conn.ws, message);
}

interface PresenceRecord {
  personId: string;
  name: string;
  guest: boolean;
  role: Role;
  colourIndex: number;
  goneAt: number | null;
}

const committed: ((mapId: string) => void)[] = [];

/** Register work to run after any group commits on a map. */
export function onCommitted(handler: (mapId: string) => void): void {
  committed.push(handler);
}

export function notifyCommitted(mapId: string): void {
  for (const handler of committed) handler(mapId);
}

const PING_MS = 20_000;

/** Protocol-level pings keep a socket alive; a quiet client is never closed. Returns the stop function. */
export function keepAlive(ws: WebSocket): () => void {
  const timer = setInterval(() => ws.ping(), PING_MS);
  return () => clearInterval(timer);
}

const connections = new Map<string, Set<Connection>>();
const presence = new Map<string, Map<string, PresenceRecord>>();
const audiences = new Map<string, Set<WebSocket>>();
const lastSeq = new Map<string, number>();

export const seqOf = (mapId: string): number => lastSeq.get(mapId) ?? 0;
export const noteSeq = (mapId: string, seq: number): void => {
  lastSeq.set(mapId, Math.max(seqOf(mapId), seq));
};

export const sendSocket = (ws: WebSocket, message: object): void => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
};

/** What one recipient receives of a stored or live message, or null when it receives nothing. */
function forRecipient(
  message: LiveMessage,
  audience: Audience,
  onlyId: string | null,
  recipient: { id: string; role: Role },
): LiveMessage | null {
  if (audience === 'user') return onlyId === recipient.id ? message : null;
  if (audience === 'privileged') return can(recipient.role, 'see_restricted') ? message : null;
  if (audience === 'resync') return can(recipient.role, 'see_restricted') ? message : { type: 'resync' };
  return message;
}

export function deliver(mapId: string, seq: number, message: LiveMessage, audience: Audience, onlyId: string | null): void {
  noteSeq(mapId, seq);
  for (const conn of connections.get(mapId) ?? []) {
    const visible = forRecipient(message, audience, onlyId, { id: conn.principal.id, role: conn.role });
    if (visible) sendConn(conn, { seq, ...visible });
  }
}

/** Send a message that is not stored: presence, cursors and per-person notices. */
export function transient(mapId: string, message: LiveMessage, onlyId: string | null = null, except: WebSocket | null = null): void {
  for (const conn of connections.get(mapId) ?? []) {
    if (conn.ws === except) continue;
    if (onlyId !== null && conn.principal.id !== onlyId) continue;
    sendConn(conn, { seq: seqOf(mapId), ...message });
  }
}

export function allConnections(): Connection[] {
  return [...connections.values()].flatMap((set) => [...set]);
}

export function presenceList(mapId: string): PresenceEntry[] {
  return [...(presence.get(mapId)?.values() ?? [])]
    .sort((a, b) => a.colourIndex - b.colourIndex)
    .map((r) => ({
      id: r.personId,
      name: r.name,
      role: r.role,
      guest: r.guest,
      colour: BRANCH_COLOURS[r.colourIndex % BRANCH_COLOURS.length] as BranchColour,
    }));
}

export function colourOf(mapId: string, personId: string): BranchColour {
  const record = presence.get(mapId)?.get(personId);
  return BRANCH_COLOURS[(record?.colourIndex ?? 0) % BRANCH_COLOURS.length] as BranchColour;
}

const announcePresence = (mapId: string): void => transient(mapId, { type: 'presence', people: presenceList(mapId) });

export function join(conn: Connection): void {
  const set = connections.get(conn.mapId) ?? new Set<Connection>();
  set.add(conn);
  connections.set(conn.mapId, set);
  const room = presence.get(conn.mapId) ?? new Map<string, PresenceRecord>();
  presence.set(conn.mapId, room);
  const known = room.get(conn.principal.id);
  if (known) {
    known.goneAt = null;
    known.role = conn.role;
  } else {
    const used = new Set([...room.values()].map((r) => r.colourIndex));
    let index = 0;
    while (used.has(index)) index += 1;
    room.set(conn.principal.id, {
      personId: conn.principal.id,
      name: conn.principal.name,
      guest: conn.principal.guest,
      role: conn.role,
      colourIndex: index,
      goneAt: null,
    });
  }
  announcePresence(conn.mapId);
}

export function leave(conn: Connection): void {
  connections.get(conn.mapId)?.delete(conn);
  const stillHere = [...(connections.get(conn.mapId) ?? [])].some((c) => c.principal.id === conn.principal.id);
  const record = presence.get(conn.mapId)?.get(conn.principal.id);
  if (record && !stillHere) record.goneAt = serverNow();
}

export const hasSocket = (mapId: string, personId: string): boolean =>
  [...(connections.get(mapId) ?? [])].some((c) => c.principal.id === personId);

/** Remove people whose last socket closed more than the presence timeout ago. */
export function sweepPresence(): void {
  const now = serverNow();
  for (const [mapId, room] of presence) {
    let changed = false;
    for (const [personId, record] of room) {
      if (record.goneAt !== null && now - record.goneAt >= config.presenceTimeoutMs) {
        room.delete(personId);
        changed = true;
      }
    }
    if (changed) announcePresence(mapId);
    if (room.size === 0) presence.delete(mapId);
  }
}

export function setRole(mapId: string, personId: string, role: Role): void {
  const record = presence.get(mapId)?.get(personId);
  if (record) record.role = role;
  for (const conn of connections.get(mapId) ?? []) if (conn.principal.id === personId) conn.role = role;
  announcePresence(mapId);
}

export function dropPerson(mapId: string, personId: string): void {
  for (const conn of [...(connections.get(mapId) ?? [])]) {
    if (conn.principal.id === personId) conn.ws.close();
  }
  presence.get(mapId)?.delete(personId);
  announcePresence(mapId);
}

/** Open audience connections for a presentation code. */
function audienceSockets(code: string): Set<WebSocket> {
  return audiences.get(code) ?? new Set();
}

export function joinAudience(code: string, ws: WebSocket): void {
  const set = audiences.get(code) ?? new Set<WebSocket>();
  set.add(ws);
  audiences.set(code, set);
}

export function leaveAudience(code: string, ws: WebSocket): void {
  audiences.get(code)?.delete(ws);
}

export const followerCount = (code: string): number => audienceSockets(code).size;

export function sendAudience(code: string, message: object): void {
  for (const ws of audienceSockets(code)) sendSocket(ws, message);
}

/** Stored messages after `since`, in order, filtered for one recipient. */
export async function replayEvents(
  mapId: string,
  since: number,
  recipient: { id: string; role: Role },
  db: Db = database(),
): Promise<Sequenced<LiveMessage>[]> {
  const rows = await query<{ seq: number; body: LiveMessage; audience: Audience; only_id: string | null }>(
    db,
    'SELECT seq, body, audience, only_id FROM events WHERE map_id = $1 AND seq > $2 ORDER BY seq',
    [mapId, since],
  );
  const out: Sequenced<LiveMessage>[] = [];
  for (const row of rows) {
    const visible = forRecipient(row.body, row.audience, row.only_id, recipient);
    if (visible) out.push({ seq: row.seq, ...visible });
  }
  return out;
}
