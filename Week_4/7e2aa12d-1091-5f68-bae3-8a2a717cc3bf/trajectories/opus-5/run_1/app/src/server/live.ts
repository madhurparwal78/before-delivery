import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Change, LayoutState } from '../shared/types.js';
import { config } from './config.js';
import { readCookie, SESSION_COOKIE } from './http.js';
import {
  dropPresence,
  onLayoutMessage,
  presentDesigners,
  publishToLayout,
  renewPresence,
} from './valkey.js';
import { designerBySession, layoutByLink, layoutById, roleFor } from './store.js';

interface Connection {
  socket: WebSocket;
  layoutId: string;
  kind: 'editor' | 'view';
  username: string | null;
}

const connections = new Set<Connection>();

const sockets = new WebSocketServer({ noServer: true });

export interface ChangeMessage {
  revision: number;
  author: string;
  change: Change;
  state: LayoutState;
}

export async function publishChange(layoutId: string, message: ChangeMessage): Promise<void> {
  await publishToLayout(layoutId, { type: 'change', ...message });
}

onLayoutMessage((layoutId, payload) => {
  const text = JSON.stringify(payload);
  for (const connection of connections) {
    if (connection.layoutId === layoutId) connection.socket.send(text);
  }
});

function editorsOf(layoutId: string): Connection[] {
  return [...connections].filter(
    (connection) => connection.layoutId === layoutId && connection.kind === 'editor',
  );
}

async function sendPresence(layoutId: string): Promise<void> {
  const editors = editorsOf(layoutId);
  if (editors.length === 0) return;
  const designers = await presentDesigners(layoutId);
  for (const editor of editors) {
    const list = designers ?? (editor.username ? [editor.username] : []);
    editor.socket.send(JSON.stringify({ type: 'presence', designers: list }));
  }
}

/** Presence keys are renewed well inside their expiry while a connection is open. */
export function startPresenceLoop(): void {
  const period = Math.max(1000, Math.min(1500, Math.floor((config.presenceSeconds * 1000) / 3)));
  setInterval(() => {
    const layoutIds = new Set<string>();
    for (const connection of connections) {
      if (connection.kind === 'editor' && connection.username) {
        void renewPresence(connection.layoutId, connection.username);
        layoutIds.add(connection.layoutId);
      }
    }
    for (const layoutId of layoutIds) void sendPresence(layoutId);
  }, period).unref();
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function refuse(socket: Duplex): void {
  socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

export async function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): Promise<void> {
  if (!sameOrigin(request)) {
    refuse(socket);
    return;
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const segments = url.pathname.split('/').filter((part) => part.length > 0);

  if (segments[0] === 'api' && segments[1] === 'layouts' && segments[3] === 'live' && segments.length === 4) {
    const token = readCookie(request, SESSION_COOKIE);
    const designer = token ? await designerBySession(token) : null;
    if (!designer) {
      refuse(socket);
      return;
    }
    const layout = await layoutById(segments[2] as string);
    if (!layout || !(await roleFor(layout, designer.id))) {
      refuse(socket);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void join(ws, layout.id, 'editor', designer.username);
    });
    return;
  }

  if (segments[0] === 'api' && segments[1] === 'view' && segments[3] === 'live' && segments.length === 4) {
    const layout = await layoutByLink(segments[2] as string, 'view');
    if (!layout) {
      refuse(socket);
      return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      void join(ws, layout.id, 'view', null);
    });
    return;
  }

  refuse(socket);
}

async function join(
  socket: WebSocket,
  layoutId: string,
  kind: 'editor' | 'view',
  username: string | null,
): Promise<void> {
  const connection: Connection = { socket, layoutId, kind, username };
  connections.add(connection);
  socket.on('close', () => {
    connections.delete(connection);
    void leave(connection);
  });
  socket.on('error', () => socket.close());
  if (kind === 'editor' && username) {
    await renewPresence(layoutId, username);
  }
  await sendPresence(layoutId);
}

async function leave(connection: Connection): Promise<void> {
  if (connection.kind !== 'editor' || !connection.username) return;
  const stillOpen = editorsOf(connection.layoutId).some(
    (other) => other.username === connection.username,
  );
  if (!stillOpen) await dropPresence(connection.layoutId, connection.username);
  await sendPresence(connection.layoutId);
}
