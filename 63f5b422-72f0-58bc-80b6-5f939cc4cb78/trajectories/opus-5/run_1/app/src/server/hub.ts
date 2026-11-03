import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { notices } from '../shared/notices.js';
import { OpFailure, parseOp } from '../shared/ops.js';
import type { Role } from '../shared/types.js';
import { accountForRequest } from './auth.js';
import { config } from './config.js';
import { one } from './db.js';
import { ApiError, toApiError } from './errors.js';
import { submitOperation, type AcceptedOperation } from './engine.js';
import { accessFor } from './workspaces.js';

interface Session {
  socket: WebSocket;
  workspaceId: string;
  userId: string;
  name: string;
  role: Role;
  pageId: string | null;
  lastSeen: number;
}

const sessions = new Set<Session>();

function peopleOf(workspaceId: string): { id: string; name: string; role: Role }[] {
  const seen = new Map<string, { id: string; name: string; role: Role }>();
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId) continue;
    seen.set(session.userId, {
      id: session.userId,
      name: session.name,
      role: session.role,
    });
  }
  return [...seen.values()];
}

function send(session: Session, message: unknown): void {
  if (session.socket.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify(message));
}

export function broadcast(workspaceId: string, message: unknown, exceptUserId?: string): void {
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId) continue;
    if (exceptUserId !== undefined && session.userId === exceptUserId) continue;
    send(session, message);
  }
}

export function sendToUser(workspaceId: string, userId: string, message: unknown): void {
  for (const session of sessions) {
    if (session.workspaceId === workspaceId && session.userId === userId) send(session, message);
  }
}

function announcePresence(workspaceId: string): void {
  broadcast(workspaceId, { type: 'presence', people: peopleOf(workspaceId) });
}

export function broadcastAccepted(
  workspaceId: string,
  accepted: AcceptedOperation,
  author: { id: string; name: string },
): void {
  const message = {
    type: 'op',
    seq: accepted.seq,
    author,
    op: accepted.body,
    ids: accepted.ids,
    effects: accepted.effects ?? null,
  };
  for (const session of sessions) {
    if (session.workspaceId !== workspaceId) continue;
    send(session, message);
  }
  for (const conflict of accepted.conflicts) {
    sendToUser(workspaceId, conflict.userId, {
      type: 'conflict',
      opId: accepted.opId,
      property: conflict.property,
      value: conflict.value,
      winner: author,
    });
  }
}

export function pushRole(workspaceId: string, userId: string, role: Role): void {
  for (const session of sessions) {
    if (session.workspaceId === workspaceId && session.userId === userId) {
      session.role = role;
      send(session, { type: 'role', role });
    }
  }
  announcePresence(workspaceId);
}

export function closeForRemoval(workspaceId: string, userId: string): void {
  for (const session of [...sessions]) {
    if (session.workspaceId === workspaceId && session.userId === userId) {
      session.socket.close(4404, 'removed');
      sessions.delete(session);
    }
  }
  announcePresence(workspaceId);
}

async function currentRole(workspaceId: string, userId: string): Promise<Role | undefined> {
  const row = await one<{ role: Role }>(
    'select role from members where workspace_id = $1 and user_id = $2',
    [workspaceId, userId],
  );
  return row?.role;
}

async function handleOperation(session: Session, raw: Record<string, unknown>): Promise<void> {
  const opRaw = raw['op'];
  const envelope =
    typeof opRaw === 'object' && opRaw !== null ? (opRaw as Record<string, unknown>) : {};
  const opId = typeof envelope['opId'] === 'string' ? envelope['opId'] : '';
  try {
    const role = await currentRole(session.workspaceId, session.userId);
    if (role === undefined) {
      session.socket.close(4404, 'no access');
      return;
    }
    session.role = role;
    if (role === 'viewer') {
      throw new ApiError(403, 'forbidden_role', notices.roleRefused);
    }
    const body = parseOp(envelope);
    const baseSeq = typeof envelope['baseSeq'] === 'number' ? envelope['baseSeq'] : 0;
    if (opId === '' || opId.length > 64) {
      throw new ApiError(422, 'invalid', 'Some values are not valid.', {
        opId: 'Expected an operation id of 1 to 64 characters.',
      });
    }
    const accepted = await submitOperation({
      workspaceId: session.workspaceId,
      userId: session.userId,
      opId,
      baseSeq,
      body,
    });
    send(session, {
      type: 'ack',
      opId,
      seq: accepted.seq,
      created: accepted.created ?? null,
      ids: accepted.ids,
      effects: accepted.effects ?? null,
    });
    if (!accepted.replayed) {
      const author = { id: session.userId, name: session.name };
      for (const other of sessions) {
        if (other === session || other.workspaceId !== session.workspaceId) continue;
        send(other, {
          type: 'op',
          seq: accepted.seq,
          author,
          op: accepted.body,
          ids: accepted.ids,
          effects: accepted.effects ?? null,
        });
      }
      for (const conflict of accepted.conflicts) {
        sendToUser(session.workspaceId, conflict.userId, {
          type: 'conflict',
          opId,
          property: conflict.property,
          value: conflict.value,
          winner: author,
        });
      }
    }
  } catch (error) {
    const failure = error instanceof OpFailure ? toApiError(error) : toApiError(error);
    send(session, {
      type: 'reject',
      opId,
      error: { code: failure.code, message: failure.message },
    });
  }
}

export function attachHub(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    void (async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/ws') {
        socket.destroy();
        return;
      }
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== config.publicUrl) {
        const host = request.headers.host ?? '';
        if (!origin.endsWith(host)) {
          socket.destroy();
          return;
        }
      }
      const account = await accountForRequest(request);
      const workspaceId = url.searchParams.get('workspace') ?? '';
      const accept = (code: number): void => {
        wss.handleUpgrade(request, socket, head, (ws) => {
          ws.close(code);
        });
      };
      if (!account) {
        accept(4401);
        return;
      }
      const access = await accessFor(account.id, workspaceId);
      if (!access) {
        accept(4404);
        return;
      }
      wss.handleUpgrade(request, socket, head, async (ws) => {
        const seqRow = await one<{ seq: string }>('select seq from workspaces where id = $1', [
          workspaceId,
        ]);
        const session: Session = {
          socket: ws,
          workspaceId,
          userId: account.id,
          name: account.name,
          role: access.role,
          pageId: null,
          lastSeen: Date.now(),
        };
        sessions.add(session);
        send(session, {
          type: 'hello',
          seq: Number(seqRow?.seq ?? 0),
          you: { id: account.id, name: account.name, role: access.role },
        });
        announcePresence(workspaceId);
        ws.on('pong', () => {
          session.lastSeen = Date.now();
        });
        ws.on('message', (data) => {
          session.lastSeen = Date.now();
          let raw: Record<string, unknown>;
          try {
            raw = JSON.parse(String(data)) as Record<string, unknown>;
          } catch {
            return;
          }
          const type = raw['type'];
          if (type === 'op') {
            void handleOperation(session, raw);
            return;
          }
          if (type === 'cursor') {
            const pageId = typeof raw['pageId'] === 'string' ? raw['pageId'] : null;
            session.pageId = pageId;
            for (const other of sessions) {
              if (other === session || other.workspaceId !== session.workspaceId) continue;
              send(other, {
                type: 'cursor',
                userId: session.userId,
                name: session.name,
                pageId,
                x: raw['x'],
                y: raw['y'],
              });
            }
            return;
          }
          if (type === 'select') {
            for (const other of sessions) {
              if (other === session || other.workspaceId !== session.workspaceId) continue;
              send(other, {
                type: 'selection',
                userId: session.userId,
                nodeId: raw['nodeId'],
              });
            }
          }
        });
        ws.on('close', () => {
          sessions.delete(session);
          announcePresence(workspaceId);
        });
      });
    })();
  });

  setInterval(() => {
    const now = Date.now();
    for (const session of [...sessions]) {
      if (now - session.lastSeen > config.presenceTimeoutMs) {
        sessions.delete(session);
        session.socket.terminate();
        announcePresence(session.workspaceId);
        continue;
      }
      if (session.socket.readyState === WebSocket.OPEN) session.socket.ping();
    }
  }, 1000).unref();
}
