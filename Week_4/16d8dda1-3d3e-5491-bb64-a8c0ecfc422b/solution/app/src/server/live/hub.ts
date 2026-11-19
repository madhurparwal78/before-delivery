// WebSocket pages of every session on this instance; every accepted change reaches them through the bus.
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { LiveMessage } from '../../shared/wire';
import { learnerIdOf, openSession, callerFor, type OpenedSession } from '../access';
import { config } from '../config';
import { notFound, Refusal } from '../errors';
import { assertSameOrigin, matchPath, param, SECURITY_HEADERS } from '../http';
import { RUNNING_STATES } from '../../shared/states';
import { learnerConnected, learnerDisconnected, registerAgain } from './presence';
import { buildBase, snapshotFor, type Base, type Viewer } from './snapshot';
import { refreshHeartbeat, watch, type BusEvent } from './valkey';

interface Connection {
  socket: WebSocket;
  viewer: Viewer;
}

const server = new WebSocketServer({ noServer: true, maxPayload: 1024 });
server.on('headers', (headers) => {
  headers.push(`X-Slatehall-Instance: ${config.instanceName}`);
});
const connections = new Map<string, Set<Connection>>();
/** Each session's pushes run one after another, so no page ever receives an older snapshot after a newer one. */
const queues = new Map<string, Promise<void>>();

function inOrder(sessionId: string, work: () => Promise<void>): Promise<void> {
  const next = (queues.get(sessionId) ?? Promise.resolve()).then(work);
  const settled = next.catch(() => undefined);
  queues.set(sessionId, settled);
  void settled.then(() => {
    if (queues.get(sessionId) === settled) queues.delete(sessionId);
  });
  return next;
}

function send(connection: Connection, message: LiveMessage): void {
  if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
}

function mayRead(base: Base, viewer: Viewer, tableId: string | undefined): boolean {
  if (viewer.role !== 'learner') return true;
  return viewer.learnerId !== null && base.live.breakout?.members[viewer.learnerId] === tableId;
}

function push(sessionId: string, event: Omit<BusEvent, 'sessionId'>): Promise<void> {
  return inOrder(sessionId, async () => {
    const group = connections.get(sessionId);
    if (!group || group.size === 0) return;
    const base = await buildBase(sessionId);
    for (const connection of group) {
      const message: LiveMessage = { event: event.event, snapshot: snapshotFor(base, connection.viewer) };
      if (event.displayName !== undefined) message.displayName = event.displayName;
      if (event.tableId !== undefined) message.tableId = event.tableId;
      if (event.message && mayRead(base, connection.viewer, event.tableId)) message.message = event.message;
      send(connection, message);
    }
  });
}

async function pushAll(event: LiveMessage['event']): Promise<void> {
  await Promise.all([...connections.keys()].map((sessionId) => push(sessionId, { event })));
}

async function attach(socket: WebSocket, opened: OpenedSession): Promise<void> {
  const { session } = opened;
  const viewer: Viewer = { role: opened.role, learnerId: learnerIdOf(opened.caller) };
  const connection: Connection = { socket, viewer };
  const group = connections.get(session.id) ?? new Set<Connection>();
  group.add(connection);
  connections.set(session.id, group);
  const tracked = viewer.learnerId !== null && RUNNING_STATES.includes(session.state);
  socket.on('error', () => undefined);
  socket.on('close', () => {
    group.delete(connection);
    if (group.size === 0) connections.delete(session.id);
    if (tracked && viewer.learnerId) {
      learnerDisconnected(session.id, viewer.learnerId, session.world_id).catch((error: unknown) => console.error('leave failed', error));
    }
  });
  await inOrder(session.id, async () => {
    send(connection, { event: 'snapshot', snapshot: snapshotFor(await buildBase(session.id), viewer) });
  });
  if (tracked && viewer.learnerId) await learnerConnected(session.id, viewer.learnerId, session.world_id);
}

function refuseUpgrade(socket: Duplex, error: unknown): void {
  const status = error instanceof Refusal ? error.status : 404;
  const text = error instanceof Refusal ? error.message : notFound().message;
  const body = JSON.stringify({ error: text });
  const headers = [
    `HTTP/1.1 ${status} ${status === 403 ? 'Forbidden' : 'Not Found'}`,
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    `X-Slatehall-Instance: ${config.instanceName}`,
    ...Object.entries(SECURITY_HEADERS).map(([name, value]) => `${name}: ${value}`),
    'Connection: close',
  ];
  socket.end(`${headers.join('\r\n')}\r\n\r\n${body}`);
}

export async function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
  socket.on('error', () => undefined);
  try {
    assertSameOrigin(req.headers);
    const params = matchPath('/ws/sessions/:id', new URL(req.url ?? '/', 'http://localhost').pathname);
    const caller = params ? await callerFor(req) : null;
    if (!params || !caller) throw notFound();
    const opened = await openSession(caller, param(params, 'id'));
    server.handleUpgrade(req, socket, head, (ws) => {
      attach(ws, opened).catch((error: unknown) => console.error('attach failed', error));
    });
  } catch (error) {
    refuseUpgrade(socket, error);
  }
}

export function startHub(): void {
  watch({
    status: (up) => {
      const work = up ? registerAgain().then(() => pushAll('resumed')) : pushAll('paused');
      work.catch((error: unknown) => console.error('bus status push failed', error));
    },
    event: (event) => {
      push(event.sessionId, event).catch((error: unknown) => console.error('push failed', error));
    },
  });
  setInterval(() => {
    for (const sessionId of connections.keys()) refreshHeartbeat(sessionId).catch(() => undefined);
  }, 10_000);
}
