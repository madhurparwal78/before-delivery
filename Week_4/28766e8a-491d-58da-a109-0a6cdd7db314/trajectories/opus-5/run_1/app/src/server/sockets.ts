import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { type Operation, parseOperation } from '../shared/operation.js';
import { isPlainObject } from '../shared/validate.js';
import { sessionFromRequest } from './auth.js';
import { queryOne } from './db.js';
import { type Membership, requireMembership, saveOutageActive } from './diagrams.js';
import { ApiError } from './errors.js';
import {
  type Client,
  addClient,
  broadcast,
  presenceList,
  removeClient,
  send,
} from './hub.js';
import { UndoSkipped, runOperation } from './operations.js';
import { listExports } from './exports.js';

/** Every operation kind the live socket accepts. */
const SOCKET_OPERATION_KINDS: readonly string[] = [
  'add_shape',
  'update_shape',
  'update_shapes',
  'delete_shape',
  'add_connector',
  'delete_connector',
  'delete_shapes',
  'duplicate_shapes',
  'reorder_shape',
  'group_shapes',
  'ungroup_shapes',
  'add_page',
  'rename_page',
  'reorder_page',
  'delete_page',
  'add_layer',
  'rename_layer',
  'reorder_layer',
  'set_layer_flag',
  'restore_version',
  'undo',
  'redo',
];

const CURSOR_INTERVAL_MS = 50;

const server = new WebSocketServer({ noServer: true });

export async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  const origin = request.headers.origin;
  if (origin !== undefined && !sameOrigin(origin, request)) {
    socket.destroy();
    return;
  }
  const diagramId = url.searchParams.get('diagram') ?? '';
  const session = await sessionFromRequest(request);

  server.handleUpgrade(request, socket, head, async (ws) => {
    if (!session) {
      ws.close(4401);
      return;
    }
    try {
      const membership = await requireMembership(diagramId, session.user.id);
      if (await saveOutageActive(diagramId)) {
        ws.close(4503);
        return;
      }
      await open(ws, diagramId, session.id, session.user, membership);
    } catch (error) {
      ws.close(error instanceof ApiError && error.status === 404 ? 4404 : 4401);
    }
  });
}

function sameOrigin(origin: string, request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

async function open(
  ws: WebSocket,
  diagramId: string,
  sessionId: string,
  user: { id: string; email: string; name: string },
  membership: Membership,
): Promise<void> {
  const { role, ownerName } = membership;
  const client: Client = {
    socket: ws,
    diagramId,
    sessionId,
    userId: user.id,
    name: user.name,
    role,
    alive: true,
  };
  const first = addClient(client);
  let lastCursor = 0;

  ws.on('pong', () => {
    client.alive = true;
  });

  ws.send(
    JSON.stringify({
      t: 'hello',
      you: user,
      role,
      ownerName,
      document: membership.diagram.document,
      presence: presenceList(diagramId).filter((p) => p.userId !== user.id),
      exports: await listExports(diagramId),
    }),
  );

  if (first) {
    broadcast(
      diagramId,
      { t: 'presence', list: presenceList(diagramId), joined: { userId: user.id, name: user.name, role } },
      user.id,
    );
  } else {
    broadcast(diagramId, { t: 'presence', list: presenceList(diagramId) }, user.id);
  }

  ws.on('message', (raw) => {
    void (async () => {
      let message: unknown;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!isPlainObject(message)) return;
      if (message['t'] === 'cursor') {
        const now = Date.now();
        if (now - lastCursor < CURSOR_INTERVAL_MS) return;
        lastCursor = now;
        const page = message['page'];
        const x = message['x'];
        const y = message['y'];
        if (typeof page !== 'string' || typeof x !== 'number' || typeof y !== 'number') return;
        broadcast(diagramId, { t: 'cursor', userId: user.id, name: user.name, page, x, y }, user.id);
        return;
      }
      if (message['t'] !== 'op') return;
      const opId = message['opId'];
      if (typeof opId !== 'string') return;
      const parsed = parseOperation(message['op'], 'op', SOCKET_OPERATION_KINDS);
      if (!parsed.ok) {
        send(client, { t: 'opError', opId, code: 'invalid', message: 'Check the operation.', fields: parsed.fields });
        return;
      }
      const baseSeq = typeof message['baseSeq'] === 'number' ? message['baseSeq'] : 0;
      try {
        const response = await runOperation(diagramId, user, { opId, baseSeq, op: parsed.value });
        send(client, { t: 'ack', opId, seq: response.seq, ids: response.ids, rerouted: response.rerouted });
      } catch (error) {
        if (error instanceof UndoSkipped) {
          send(client, { t: 'undoSkipped', opId, by: error.by, shape: error.shape });
          return;
        }
        if (error instanceof ApiError) {
          send(client, {
            t: 'opError',
            opId,
            code: error.code,
            message: error.message,
            ...(error.fields ? { fields: error.fields } : {}),
            ...(await blamedBy(diagramId, parsed.value)),
          });
          if (error.status === 503) ws.close(4503);
          return;
        }
        send(client, { t: 'opError', opId, code: 'invalid', message: 'That change could not be saved.' });
      }
    })();
  });

  ws.on('close', () => {
    const last = removeClient(client);
    if (last) {
      broadcast(diagramId, { t: 'cursorGone', userId: user.id });
      broadcast(diagramId, { t: 'presence', list: presenceList(diagramId) });
    }
  });
}

/** Names the person whose change removed the object, so the sender hears the deleted notice. */
async function blamedBy(diagramId: string, op: Operation): Promise<{ by?: string }> {
  const field =
    'shape' in op && typeof op.shape === 'string'
      ? `shape:${op.shape}:*`
      : 'connector' in op
        ? `connector:${op.connector}:*`
        : null;
  if (field === null) return {};
  const row = await queryOne<{ name: string }>(
    `SELECT u.name FROM field_writers w JOIN users u ON u.id = w.actor_id
      WHERE w.diagram_id = $1 AND w.field = $2`,
    [diagramId, field],
  );
  return row ? { by: row.name } : {};
}
