import type { WebSocket } from 'ws';
import { BRANCH_COLOURS, type Role } from '../shared/types.js';
import { nowMs } from './clock.js';
import { db } from './db.js';

export interface Connection {
  ws: WebSocket;
  mapId: string;
  actorKey: string;
  actorName: string;
  kind: 'user' | 'guest';
  role: Role;
  canSeeRestricted: boolean;
  colour: string;
  cursor: { x: number; y: number; topic_id: string | null } | null;
  view: { zoom: number; pan_x: number; pan_y: number; width: number; height: number } | null;
}

export interface AudienceConnection {
  ws: WebSocket;
  code: string;
}

export interface OutgoingMessage {
  type: string;
  /** Only this actor receives the message when set. */
  recipient?: string;
  /** Topic ids the message speaks about, used to filter restricted branches. */
  topics?: string[];
  payload: Record<string, unknown>;
}

const connections = new Set<Connection>();
const audience = new Set<AudienceConnection>();
const lastSeen = new Map<string, { mapId: string; at: number; name: string }>();

export function addConnection(conn: Connection): void {
  connections.add(conn);
  lastSeen.delete(`${conn.mapId}:${conn.actorKey}`);
}

export function dropConnection(conn: Connection): void {
  connections.delete(conn);
  if (!connectionsFor(conn.mapId).some((other) => other.actorKey === conn.actorKey)) {
    lastSeen.set(`${conn.mapId}:${conn.actorKey}`, {
      mapId: conn.mapId,
      at: nowMs(),
      name: conn.actorName,
    });
  }
}

export function connectionsFor(mapId: string): Connection[] {
  return [...connections].filter((conn) => conn.mapId === mapId);
}

export function addAudience(conn: AudienceConnection): void {
  audience.add(conn);
}

export function dropAudience(conn: AudienceConnection): void {
  audience.delete(conn);
}

export function audienceFor(code: string): AudienceConnection[] {
  return [...audience].filter((conn) => conn.code === code);
}

export function pendingPresenceRemovals(timeoutMs: number): { mapId: string; key: string }[] {
  const out: { mapId: string; key: string }[] = [];
  const cutoff = nowMs() - timeoutMs;
  for (const [key, value] of lastSeen) {
    if (value.at <= cutoff) {
      out.push({ mapId: value.mapId, key });
      lastSeen.delete(key);
    }
  }
  return out;
}

/** The lowest free branch colour, by order of joining the map. */
export function colourForJoin(mapId: string): string {
  const taken = new Set(connectionsFor(mapId).map((conn) => conn.colour));
  for (const colour of BRANCH_COLOURS) {
    if (!taken.has(colour)) return colour;
  }
  return BRANCH_COLOURS[0];
}

export interface VisibilityFilter {
  /** Topic ids hidden from anyone who may not see restricted branches. */
  restricted: Set<string>;
}

const currentFilters = new Map<string, VisibilityFilter>();

export function setVisibilityFilter(mapId: string, filter: VisibilityFilter): void {
  currentFilters.set(mapId, filter);
}

export function visibleTo(conn: Connection, message: OutgoingMessage): boolean {
  if (message.recipient !== undefined && message.recipient !== conn.actorKey) return false;
  const topics = message.topics;
  if (!topics || topics.length === 0) return true;
  if (conn.canSeeRestricted) return true;
  const filter = currentFilters.get(conn.mapId);
  if (!filter) return true;
  return topics.every((id) => !filter.restricted.has(id));
}

/** Assigns the next per-map sequence number, stores the message and sends it. */
export async function publish(mapId: string, message: OutgoingMessage): Promise<number> {
  const result = await db.query<{ live_seq: string }>(
    'update maps set live_seq = live_seq + 1 where id = $1 returning live_seq',
    [mapId],
  );
  const seq = Number(result.rows[0]?.live_seq ?? 0);
  const envelope = { seq, type: message.type, ...message.payload };
  await db.query(
    'insert into live_messages (map_id, seq, payload, recipient) values ($1, $2, $3, $4)',
    [mapId, seq, { envelope, topics: message.topics ?? [] }, message.recipient ?? null],
  );
  for (const conn of connectionsFor(mapId)) {
    if (!visibleTo(conn, message)) continue;
    sendTo(conn, envelope);
  }
  return seq;
}

export function sendTo(conn: Connection, envelope: Record<string, unknown>): void {
  if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(envelope));
}

export function sendToAudience(code: string, envelope: Record<string, unknown>): void {
  for (const conn of audienceFor(code)) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(envelope));
  }
}

export async function replayMessages(conn: Connection, since: number): Promise<void> {
  const result = await db.query<{ payload: { envelope: Record<string, unknown>; topics: string[] }; recipient: string | null }>(
    'select payload, recipient from live_messages where map_id = $1 and seq > $2 order by seq asc',
    [conn.mapId, since],
  );
  for (const row of result.rows) {
    const message: OutgoingMessage = {
      type: String(row.payload.envelope.type ?? ''),
      topics: row.payload.topics,
      payload: {},
    };
    if (row.recipient !== null) message.recipient = row.recipient;
    if (!visibleTo(conn, message)) continue;
    sendTo(conn, row.payload.envelope);
  }
}
