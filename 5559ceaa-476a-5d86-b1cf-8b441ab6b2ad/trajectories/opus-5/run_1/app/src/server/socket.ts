import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientFrame, ServerFrame, User } from '../shared/api.js';
import { limits } from './config.js';
import { pool } from './db.js';
import { ApiError } from './http/errors.js';
import { blockingSession, loadMembership, memberList, sessionView } from './repository.js';
import { currentUser } from './services/authSession.js';
import { publish, startBus, type Envelope } from './services/bus.js';
import { loadFile, saveFile } from './services/fileWrites.js';

const INSTANCE_ID = randomUUID();
const PRESENCE_HEARTBEAT_MS = 10_000;
const CLOSE_REMOVED = 4403;

interface Connection {
  socket: WebSocket;
  projectId: string;
  user: User;
  connectionId: string;
}

const connections = new Set<Connection>();

function sendFrame(socket: WebSocket, frame: ServerFrame): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
}

function deliver(envelope: Envelope): void {
  for (const connection of connections) {
    if (connection.projectId !== envelope.project_id) continue;
    if (envelope.user_id !== undefined && connection.user.id !== envelope.user_id) continue;
    sendFrame(connection.socket, envelope.frame);
    if (envelope.frame.type === 'access_revoked') {
      connection.socket.close(CLOSE_REMOVED, 'removed');
    }
  }
}

async function announcePresence(projectId: string): Promise<void> {
  const participants = await memberList(pool, projectId);
  await publish({ project_id: projectId, frame: { type: 'presence', participants } });
}

function parseFrame(text: string): ClientFrame | null {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  const fileId = frame['file_id'];
  if (typeof fileId !== 'string') return null;
  if (frame['type'] === 'edit') {
    if (typeof frame['content'] !== 'string') return null;
    if (!Number.isInteger(frame['base_revision'])) return null;
    return {
      type: 'edit',
      file_id: fileId,
      base_revision: frame['base_revision'] as number,
      content: frame['content'],
    };
  }
  if (frame['type'] === 'cursor') {
    if (!Number.isInteger(frame['line']) || !Number.isInteger(frame['column'])) return null;
    return {
      type: 'cursor',
      file_id: fileId,
      line: frame['line'] as number,
      column: frame['column'] as number,
    };
  }
  return null;
}

async function onEdit(connection: Connection, frame: ClientFrame): Promise<void> {
  if (frame.type !== 'edit') return;
  try {
    await saveFile(
      connection.projectId,
      connection.user,
      frame.file_id,
      frame.base_revision,
      frame.content,
    );
  } catch (cause) {
    if (!(cause instanceof ApiError)) throw cause;
    const code =
      cause.code === 'not_driver' ||
      cause.code === 'session_paused' ||
      cause.code === 'stale_revision' ||
      cause.code === 'validation'
        ? cause.code
        : 'validation';
    const currentRevision = cause.extra['current_revision'];
    sendFrame(connection.socket, {
      type: 'edit_rejected',
      file_id: frame.file_id,
      code,
      current_revision: typeof currentRevision === 'number' ? currentRevision : null,
    });
  }
}

async function onCursor(connection: Connection, frame: ClientFrame): Promise<void> {
  if (frame.type !== 'cursor') return;
  const file = await loadFile(pool, connection.projectId, frame.file_id);
  await publish({
    project_id: connection.projectId,
    frame: {
      type: 'cursor',
      user_id: connection.user.id,
      file_id: file.id,
      path: file.path,
      line: frame.line,
      column: frame.column,
    },
  });
}

async function greet(connection: Connection): Promise<void> {
  const participants = await memberList(pool, connection.projectId);
  const session = await blockingSession(pool, connection.projectId);
  const you = participants.find((member) => member.user_id === connection.user.id);
  if (you === undefined) return;
  sendFrame(connection.socket, {
    type: 'hello',
    you,
    session: session === null ? null : sessionView(session),
    participants,
  });
}

export function attachProjectSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.socketFrameBytes });

  startBus(deliver);

  setInterval(() => {
    const ids = [...connections].map((connection) => connection.connectionId);
    if (ids.length === 0) return;
    pool
      .query('update presence set last_seen = now() where connection_id = any($1::text[])', [ids])
      .catch(() => undefined);
    pool
      .query(`delete from presence where last_seen < now() - interval '40 seconds'`)
      .catch(() => undefined);
  }, PRESENCE_HEARTBEAT_MS).unref();

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const match = /^\/api\/projects\/([^/]+)\/socket$/.exec(url.pathname);
      if (match === null) {
        socket.destroy();
        return;
      }
      const projectId = match[1] ?? '';
      const user = await currentUser(req);
      if (user === null) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      try {
        await loadMembership(pool, projectId, user.id);
      } catch {
        socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const connection: Connection = {
          socket: ws,
          projectId,
          user,
          connectionId: randomUUID(),
        };
        connections.add(connection);
        void (async () => {
          await pool.query(
            `insert into presence (connection_id, project_id, user_id, instance_id)
             values ($1, $2, $3, $4)`,
            [connection.connectionId, projectId, user.id, INSTANCE_ID],
          );
          await greet(connection);
          await announcePresence(projectId);
        })();

        ws.on('message', (data) => {
          void (async () => {
            const frame = parseFrame(data.toString('utf8'));
            if (frame === null) return;
            if (frame.type === 'edit') await onEdit(connection, frame);
            else await onCursor(connection, frame);
          })().catch(() => undefined);
        });

        ws.on('close', () => {
          connections.delete(connection);
          void (async () => {
            await pool.query('delete from presence where connection_id = $1', [
              connection.connectionId,
            ]);
            await announcePresence(projectId);
          })();
        });
      });
    })().catch(() => socket.destroy());
  });
}

export async function clearInstancePresence(): Promise<void> {
  await pool.query('delete from presence where instance_id = $1', [INSTANCE_ID]);
}
