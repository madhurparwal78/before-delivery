import type { Server } from 'node:http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { App } from './app.js';
import { sessionUser, SESSION_COOKIE_NAME } from './sessions.js';

interface SocketUser { id: string; email: string; name: string }

interface SocketState {
  userId: string;
  diagramId: string;
  token: string;
}

export interface SocketMessage {
  kind: string;
  [key: string]: unknown;
}

export interface SocketsCtx {
  wss: WebSocketServer;
  app: App;
  server: Server;
}

const sockets = new Set<WebSocket>();
const socketState = new Map<WebSocket, SocketState>();

export function registerSockets(ctx: SocketsCtx): void {
  const { wss, app } = ctx;

  wss.on('connection', (ws: WebSocket, req: { url?: string; headers: Record<string, unknown> }, info: { user: SocketUser | null; diagramId: string | null; token: string | null }) => {
    const diagramId = info.diagramId;
    const user = info.user;
    if (!user || !diagramId || !info.token) {
      ws.close(4401, 'unauthenticated');
      return;
    }
    const token: string = info.token;
    void (async () => {
      const member = await app.db.query(
        'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2',
        [diagramId, user.id]);
      const roleRow = member.rows[0] as { role: string } | undefined;
      if (!roleRow) {
        ws.close(4404, 'not_found');
        return;
      }
      const state: SocketState = { userId: user.id, diagramId, token };
      sockets.add(ws);
      socketState.set(ws, state);

      const unsubscribe = app.on(diagramId, (event) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ kind: `server:${event.kind}`, payload: event.payload }));
        }
      });

      const outage = app.outageUntil(diagramId);
      if (outage > Date.now()) {
        ws.close(4503, 'save_unavailable');
        return;
      }

      announcePresence(app, diagramId);

      ws.on('message', (data) => {
        void handleMessage(app, ws, state, data.toString());
      });
      ws.on('close', () => {
        sockets.delete(ws);
        socketState.delete(ws);
        unsubscribe();
        announcePresence(app, diagramId);
      });
      ws.on('error', () => {
        sockets.delete(ws);
        socketState.delete(ws);
        unsubscribe();
      });
    })();
  });
}

async function handleMessage(app: App, ws: WebSocket, state: SocketState, raw: string): Promise<void> {
  let message: SocketMessage;
  try {
    message = JSON.parse(raw) as SocketMessage;
  } catch {
    return;
  }
  switch (message.kind) {
    case 'cursor': {
      const x = message['x'], y = message['y'];
      if (typeof x !== 'number' || typeof y !== 'number') return;
      const user = await userById(app, state.userId);
      if (!user) return;
      broadcastToOthers(app, state, ws, {
        kind: 'server:cursor',
        payload: { userId: state.userId, name: user.name, x, y },
      });
      break;
    }
    case 'client:op': {
      const op = (message['op'] ?? {}) as Record<string, unknown>;
      const member = await app.db.query(
        'SELECT role FROM members WHERE diagram_id = $1 AND user_id = $2',
        [state.diagramId, state.userId]);
      const role = (member.rows[0] as { role: string } | undefined)?.role;
      if (role !== 'owner' && role !== 'editor') return;
      await applySocketOperation(app, state, op);
      break;
    }
    default:
      break;
  }
}

/** Socket-only operations: pages, layers, groups, z order, duplicates, undo. */
async function applySocketOperation(
  app: App, state: SocketState, op: Record<string, unknown>,
): Promise<void> {
  const diagramId = state.diagramId;
  const doc = await app.loadDocument(diagramId);
  if (!doc) return;
  const kind = op['kind'];
  const changed: boolean = (() => {
    switch (kind) {
      case 'add_page': {
        if (doc.pages.length >= 20) return false;
        const name = String(op['name'] ?? `Page ${doc.pages.length + 1}`);
        const page = {
          id: app.newId('p'), name, order: doc.pages.length,
          layers: [{ id: app.newId('l'), name: 'Layer 1', order: 0, visible: true, locked: false }],
          shapes: [], connectors: [], groups: [],
        };
        doc.pages.push(page);
        return true;
      }
      case 'rename_page': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const name = String(op['name'] ?? '');
        if (name.length < 1 || name.length > 60) return false;
        page.name = name;
        return true;
      }
      case 'reorder_pages': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const target = Number(op['order']);
        const sorted = [...doc.pages].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((p) => p.id === page.id);
        if (index < 0 || !Number.isInteger(target) || target < 0 || target >= sorted.length) return false;
        sorted.splice(index, 1);
        sorted.splice(target, 0, page);
        sorted.forEach((p, i) => { p.order = i; });
        return true;
      }
      case 'delete_page': {
        if (doc.pages.length <= 1) return false;
        const pageId = String(op['page'] ?? '');
        const page = doc.pages.find((p) => p.id === pageId);
        if (!page) return false;
        doc.pages = doc.pages.filter((p) => p.id !== pageId);
        doc.pages.sort((a, b) => a.order - b.order).forEach((p, i) => { p.order = i; });
        return true;
      }
      case 'add_layer': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page || page.layers.length >= 10) return false;
        const name = String(op['name'] ?? `Layer ${page.layers.length + 1}`);
        page.layers.push({ id: app.newId('l'), name, order: page.layers.length, visible: true, locked: false });
        return true;
      }
      case 'rename_layer': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const layer = page.layers.find((l) => l.id === op['layer']);
        if (!layer) return false;
        const name = String(op['name'] ?? '');
        if (name.length < 1 || name.length > 60) return false;
        layer.name = name;
        return true;
      }
      case 'reorder_layers': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const layer = page.layers.find((l) => l.id === op['layer']);
        if (!layer) return false;
        const target = Number(op['order']);
        const sorted = [...page.layers].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((l) => l.id === layer.id);
        if (index < 0 || !Number.isInteger(target) || target < 0 || target >= sorted.length) return false;
        sorted.splice(index, 1);
        sorted.splice(target, 0, layer);
        sorted.forEach((l, i) => { l.order = i; });
        return true;
      }
      case 'set_layer_visible': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const layer = page.layers.find((l) => l.id === op['layer']);
        if (!layer) return false;
        layer.visible = op['visible'] === true;
        return true;
      }
      case 'set_layer_locked': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const layer = page.layers.find((l) => l.id === op['layer']);
        if (!layer) return false;
        layer.locked = op['locked'] === true;
        return true;
      }
      case 'group_shapes': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const ids = Array.isArray(op['shapes']) ? op['shapes'] as string[] : [];
        if (ids.length < 2) return false;
        const layers = new Set<string>();
        for (const id of ids) {
          const shape = page.shapes.find((s) => s.id === id);
          if (!shape) return false;
          layers.add(shape.layer);
        }
        if (layers.size > 1) return false;
        const groupId = app.newId('g');
        page.groups.push({ id: groupId, members: ids });
        for (const id of ids) {
          const shape = page.shapes.find((s) => s.id === id);
          if (shape) shape.group = groupId;
        }
        return true;
      }
      case 'ungroup': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const groups = Array.isArray(op['groups']) ? op['groups'] as string[] : [];
        let changedAny = false;
        for (const groupId of groups) {
          const group = page.groups.find((g) => g.id === groupId);
          if (!group) continue;
          for (const memberId of group.members) {
            const shape = page.shapes.find((s) => s.id === memberId);
            if (shape) shape.group = null;
          }
          page.groups = page.groups.filter((g) => g.id !== groupId);
          changedAny = true;
        }
        return changedAny;
      }
      case 'z_order': {
        const page = doc.pages.find((p) => p.id === op['page']);
        if (!page) return false;
        const shape = page.shapes.find((s) => s.id === op['shape']);
        if (!shape) return false;
        const step = Number(op['step']);
        if (step !== 1 && step !== -1) return false;
        shape.z += step;
        return true;
      }
      case 'restore': {
        return false;
      }
      default:
        return false;
    }
  })();
  if (!changed) return;
  const { rerouteDocument } = await import('./documents.js');
  rerouteDocument(doc);
  doc.seq += 1;
  await app.saveDocument(doc);
  app.broadcast(diagramId, {
    kind: 'operation',
    payload: {
      ack: { opId: `socket-${doc.seq}`, seq: doc.seq, ids: {}, rerouted: [] },
      op: { kind: 'socket' }, userId: state.userId,
    },
  });
}

function broadcastToOthers(app: App, state: SocketState, except: WebSocket, payload: unknown): void {
  for (const socket of sockets) {
    const st = socketState.get(socket);
    if (!st || st.diagramId !== state.diagramId) continue;
    if (socket === except) continue;
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }
}

function announcePresence(app: App, diagramId: string): void {
  const people = new Map<string, Set<string>>();
  for (const socket of sockets) {
    const st = socketState.get(socket);
    if (!st || st.diagramId !== diagramId) continue;
    const set = people.get(st.userId) ?? new Set<string>();
    set.add('socket');
    people.set(st.userId, set);
  }
  void (async () => {
    const payload: { userId: string; name: string }[] = [];
    for (const userId of people.keys()) {
      const user = await userById(app, userId);
      if (user) payload.push({ userId, name: user.name });
    }
    for (const socket of sockets) {
      const st = socketState.get(socket);
      if (!st || st.diagramId !== diagramId) continue;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ kind: 'server:presence', payload }));
      }
    }
  })();
}

async function userById(app: App, userId: string): Promise<SocketUser | null> {
  const result = await app.db.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
  const row = result.rows[0] as SocketUser | undefined;
  return row ?? null;
}

/** Close every socket for a session or diagram; used by sign-out and outages. */
export function closeSockets(predicate: (state: SocketState) => boolean, code: number, reason: string): void {
  for (const socket of sockets) {
    const state = socketState.get(socket);
    if (!state) continue;
    if (predicate(state)) {
      socket.close(code, reason);
      sockets.delete(socket);
      socketState.delete(socket);
    }
  }
}

/** Close every socket opened with a session token; used by sign-out. */
export function closeSocketsForSession(token: string, code: number, reason: string): void {
  closeSockets((state) => state.token === token, code, reason);
}

/** Close every socket on a diagram; used by the save-outage route. */
export function closeSocketsForDiagram(diagramId: string, code: number, reason: string): void {
  closeSockets((state) => state.diagramId === diagramId, code, reason);
}

export function parseSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE_NAME) return part.slice(idx + 1).trim();
  }
  return null;
}

export function hasSession(token: string | null): boolean {
  return token !== null;
}

export { sessionUser };
