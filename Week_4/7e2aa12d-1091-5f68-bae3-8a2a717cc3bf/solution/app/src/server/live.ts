import type { WebSocket } from 'ws';
import type { LiveChange, LiveMessage } from '../shared/types.js';
import { config } from './config.js';
import { markAbsent, markPresent, presentIn, subscriber } from './valkey.js';

interface Connection {
  socket: WebSocket;
  /** The signed-in designer, or null on a view page. */
  username: string | null;
  /** The browser tab that holds the connection, so a change is not echoed to its author. */
  editor: string | null;
  alive: boolean;
  lastPresence: string;
}

const connections = new Map<string, Set<Connection>>();

const send = (connection: Connection, message: LiveMessage): void => {
  if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
};

type EditorConnection = Connection & { username: string };

const editorsOf = (layoutId: string): EditorConnection[] =>
  [...(connections.get(layoutId) ?? [])].filter((connection): connection is EditorConnection => connection.username !== null);
const hasEditor = (layoutId: string, username: string): boolean => editorsOf(layoutId).some((connection) => connection.username === username);

/** Send each editor of the layout the designers present: the live presence keys, or only themself while Valkey is away. */
async function pushPresence(layoutId: string): Promise<void> {
  const editors = editorsOf(layoutId);
  const present = await presentIn(layoutId);
  const everyone = present && [...new Set([...present, ...editors.map((editor) => editor.username)])].sort();
  for (const connection of editors) {
    const designers = everyone ?? [connection.username];
    const key = designers.join('\n');
    if (key === connection.lastPresence) continue;
    connection.lastPresence = key;
    send(connection, { type: 'presence', designers });
  }
}

/** Register a WebSocket for a layout; `username` is null for a view page. */
export async function attach(socket: WebSocket, layoutId: string, username: string | null, editor: string | null): Promise<void> {
  const connection: Connection = { socket, username, editor, alive: true, lastPresence: '' };
  const set = connections.get(layoutId) ?? new Set();
  set.add(connection);
  connections.set(layoutId, set);
  socket.on('pong', () => (connection.alive = true));
  socket.on('error', (error) => console.warn('websocket:', error.message));
  socket.on('close', () => {
    set.delete(connection);
    if (set.size === 0) connections.delete(layoutId);
    if (username && !hasEditor(layoutId, username)) void markAbsent(layoutId, username).then(() => pushPresence(layoutId));
  });
  if (username) {
    await markPresent(layoutId, username);
    await pushPresence(layoutId);
  }
}

/** Close a designer's editor connections (removed collaborator) or every view connection (link revoked or replaced). */
export function disconnect(layoutId: string, username: string | null): void {
  for (const connection of [...(connections.get(layoutId) ?? [])]) {
    if (connection.username === username) connection.socket.close(4004, 'not available');
  }
}

/** Forward a change published on `layout:<id>` to every open editor and view page of that layout. */
function deliver(layoutId: string, raw: string): void {
  const change = JSON.parse(raw) as LiveChange;
  for (const connection of connections.get(layoutId) ?? []) {
    if (connection.editor !== null && connection.editor === change.editor) continue;
    send(connection, change);
  }
}

/** Renew presence keys, notice joins and leaves made through other app processes, and drop dead sockets. */
export function runLiveLoops(): void {
  const renewEvery = Math.max(250, (config.presenceSeconds * 1000) / 4);
  setInterval(() => {
    for (const [layoutId, set] of connections) {
      for (const username of new Set([...set].map((connection) => connection.username).filter((name): name is string => name !== null))) void markPresent(layoutId, username);
    }
  }, renewEvery).unref();
  setInterval(() => {
    for (const layoutId of connections.keys()) void pushPresence(layoutId);
  }, 500).unref();
  setInterval(() => {
    for (const set of connections.values()) {
      for (const connection of set) {
        if (!connection.alive) connection.socket.terminate();
        else {
          connection.alive = false;
          connection.socket.ping();
        }
      }
    }
  }, 15_000).unref();
  subscriber.on('ready', () => void subscriber.psubscribe('layout:*').catch((error: Error) => console.warn('valkey subscribe:', error.message)));
  subscriber.on('pmessage', (_pattern, channel, message) => deliver(channel.slice('layout:'.length), message));
}
