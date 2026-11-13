import type { ServerResponse } from 'node:http';
import { now } from './clock.js';
import { isoZoned } from './domain/time.js';
import { keys, valkey } from './valkey.js';

export type LiveType =
  | 'hello'
  | 'seat'
  | 'ride'
  | 'booking'
  | 'notice'
  | 'message'
  | 'presence'
  | 'rating'
  | 'id_review'
  | 'wallet'
  | 'clock';

interface Connection {
  res: ServerResponse;
  memberId: string | null;
  rideId: string | null;
  threadId: string | null;
}

const connections = new Set<Connection>();

function write(connection: Connection, type: LiveType, data: unknown): void {
  connection.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function openConnection(
  res: ServerResponse,
  memberId: string | null,
  rideId: string | null,
  threadId: string | null,
): Connection {
  const connection: Connection = { res, memberId, rideId, threadId };
  connections.add(connection);
  write(connection, 'hello', { server_now: isoZoned(now()) });
  return connection;
}

export function closeConnection(connection: Connection): void {
  connections.delete(connection);
}

export function threadConnectionCount(threadId: string, memberId: string): number {
  let count = 0;
  for (const connection of connections) {
    if (connection.threadId === threadId && connection.memberId === memberId) count += 1;
  }
  return count;
}

/** Members receive their own events on every connection they hold. */
export function publishToMembers(memberIds: readonly string[], type: LiveType, data: unknown): void {
  const wanted = new Set(memberIds);
  for (const connection of connections) {
    if (connection.memberId && wanted.has(connection.memberId)) write(connection, type, data);
  }
}

/** `ride=<id>` adds seat and ride events for that ride, for anyone watching. */
export function publishToRide(rideId: string, type: LiveType, data: unknown): void {
  for (const connection of connections) {
    if (connection.rideId === rideId) write(connection, type, data);
  }
}

/** `thread=<booking id>` adds message and presence events for that thread. */
export function publishToThread(
  bookingId: string,
  allowed: readonly string[],
  type: LiveType,
  data: unknown,
): void {
  const wanted = new Set(allowed);
  for (const connection of connections) {
    if (
      connection.threadId === bookingId &&
      connection.memberId &&
      wanted.has(connection.memberId)
    ) {
      write(connection, type, data);
    }
  }
}

export function publishClock(serverNow: Date): void {
  for (const connection of connections) {
    write(connection, 'clock', { server_now: isoZoned(serverNow) });
  }
}

export async function markPresent(bookingId: string, memberId: string): Promise<void> {
  await valkey.sadd(keys.presence(bookingId), memberId).catch(() => undefined);
}

export async function markAway(bookingId: string, memberId: string): Promise<string> {
  const at = isoZoned(now());
  await valkey.srem(keys.presence(bookingId), memberId).catch(() => undefined);
  await valkey.hset(keys.lastSeen, `${bookingId}:${memberId}`, at).catch(() => undefined);
  return at;
}

export async function presenceOf(
  bookingId: string,
  memberId: string,
): Promise<{ member_id: string; online: boolean; last_seen_at: string | null }> {
  const online = await valkey
    .sismember(keys.presence(bookingId), memberId)
    .catch(() => 0);
  const lastSeen = await valkey
    .hget(keys.lastSeen, `${bookingId}:${memberId}`)
    .catch(() => null);
  return { member_id: memberId, online: online === 1, last_seen_at: lastSeen ?? null };
}
