import type { WebSocket } from 'ws';
import type { ChatMessageJson, LiveEvent, ViewerRole } from '../shared/types.js';
import { classById, sessionById } from './access.js';
import { config } from './config.js';
import { query } from './db.js';
import { worldNow } from './clock.js';
import { beatHeartbeat, markOnline, prepareSnapshot, renderSnapshot } from './livestate.js';
import { bus } from './valkey.js';
import { newId } from './ids.js';

export interface LiveClient {
  socket: WebSocket;
  sessionId: string;
  role: ViewerRole;
  learnerId: string | null;
  connectionId: string | null;
}

const clientsBySession = new Map<string, Set<LiveClient>>();

function clientsFor(sessionId: string): LiveClient[] {
  return [...(clientsBySession.get(sessionId) ?? [])];
}

export function liveSessionIds(): string[] {
  return [...clientsBySession.keys()];
}

/** Builds each recipient's own snapshot and pushes one message per connected page. */
export async function pushToSession(
  sessionId: string,
  event: LiveEvent,
  message?: ChatMessageJson & { tableId: string }
): Promise<void> {
  const clients = clientsFor(sessionId);
  if (clients.length === 0) return;
  const session = await sessionById(sessionId);
  if (session === null) return;
  const cls = await classById(session.class_id);
  if (cls === null) return;
  const context = await prepareSnapshot(session, cls);
  for (const client of clients) {
    if (client.socket.readyState !== client.socket.OPEN) continue;
    const snapshot = renderSnapshot(context, { role: client.role, learnerId: client.learnerId });
    const payload: Record<string, unknown> = { event, snapshot };
    if (message !== undefined) {
      const forTeacher = client.role !== 'learner';
      const atTable = client.learnerId !== null && snapshot.seats.some(
        (seat) => seat.learnerId === client.learnerId && seat.breakoutTable === message.tableId
      );
      if (!forTeacher && !atTable) continue;
      payload.message = message;
    }
    client.socket.send(JSON.stringify(payload));
  }
}

/** Every accepted change reaches both instances through the live bus. */
export async function announceChange(
  sessionId: string,
  event: LiveEvent,
  message?: ChatMessageJson & { tableId: string }
): Promise<void> {
  await pushToSession(sessionId, event, message);
  if (!bus.available()) return;
  try {
    await bus.publish({ sessionId, event, instance: config.instanceName, ...(message ? { message } : {}) });
  } catch {
    /* the bus went down; this instance's pages already show the paused banner */
  }
}

export function startBusRelay(): void {
  bus.onEvent((event) => {
    if (event.instance === config.instanceName) return;
    void pushToSession(
      event.sessionId,
      event.event as LiveEvent,
      event.message as (ChatMessageJson & { tableId: string }) | undefined
    );
  });
  bus.onStatus((available) => {
    for (const sessionId of liveSessionIds()) {
      void pushToSession(sessionId, available ? 'live-resumed' : 'live-paused');
    }
  });
  setInterval(() => {
    for (const sessionId of liveSessionIds()) void beatHeartbeat(sessionId);
  }, 10_000).unref();
}

export async function addClient(client: LiveClient): Promise<void> {
  let set = clientsBySession.get(client.sessionId);
  if (set === undefined) {
    set = new Set();
    clientsBySession.set(client.sessionId, set);
  }
  set.add(client);
  if (client.learnerId !== null) {
    await openPresence(client.sessionId, client.learnerId, client);
  }
  await beatHeartbeat(client.sessionId);
}

export async function removeClient(client: LiveClient): Promise<void> {
  const set = clientsBySession.get(client.sessionId);
  set?.delete(client);
  if (set !== undefined && set.size === 0) clientsBySession.delete(client.sessionId);
  if (client.learnerId !== null && client.connectionId !== null) {
    await closePresence(client.sessionId, client.learnerId, client.connectionId);
  }
}

async function openPresence(sessionId: string, learnerId: string, client: LiveClient): Promise<void> {
  const session = await sessionById(sessionId);
  if (session === null) return;
  const now = await worldNow(session.world_id);
  const connectionId = newId('con');
  client.connectionId = connectionId;
  await query(
    `INSERT INTO connections (id, session_id, learner_id, instance, grace_seconds, opened_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
    [connectionId, sessionId, learnerId, config.instanceName, config.reconnectGraceSeconds, now]
  );
  const open = await query<{ id: number }>(
    'SELECT id FROM presence WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL',
    [sessionId, learnerId]
  );
  if (open.length === 0) {
    await query('INSERT INTO presence (session_id, learner_id, joined_at) VALUES ($1, $2, $3)', [
      sessionId,
      learnerId,
      now
    ]);
  }
  await markOnline(sessionId, learnerId, true);
  await pushToSession(sessionId, 'presence');
}

async function closePresence(sessionId: string, learnerId: string, connectionId: string): Promise<void> {
  const session = await sessionById(sessionId);
  if (session === null) return;
  const now = await worldNow(session.world_id);
  await query('UPDATE connections SET closed_at = $2 WHERE id = $1 AND closed_at IS NULL', [connectionId, now]);
  const stillOpen = await query<{ id: string }>(
    'SELECT id FROM connections WHERE session_id = $1 AND learner_id = $2 AND closed_at IS NULL',
    [sessionId, learnerId]
  );
  if (stillOpen.length > 0) return;
  await query('UPDATE presence SET left_at = $3 WHERE session_id = $1 AND learner_id = $2 AND left_at IS NULL', [
    sessionId,
    learnerId,
    now
  ]);
}
