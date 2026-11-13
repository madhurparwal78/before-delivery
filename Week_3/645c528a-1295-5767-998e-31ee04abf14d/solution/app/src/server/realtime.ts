/** Same-origin WebSocket hub. Clients name the topics they watch; the server pushes every change and clock reading. */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Session } from './auth';

export interface LiveClient {
  socket: WebSocket;
  session: Session;
  topics: Set<string>;
}

interface Hooks {
  watch: (client: LiveClient, topic: string) => void;
  unwatch: (client: LiveClient, topic: string) => void;
  presence: (playerId: string, online: boolean) => void;
}

const clients = new Set<LiveClient>();
const server = new WebSocketServer({ noServer: true, maxPayload: 4096 });
let hooks: Hooks;

export function setLiveHooks(next: Hooks): void {
  hooks = next;
}

function send(client: LiveClient, message: unknown): void {
  if (client.socket.readyState === client.socket.OPEN) client.socket.send(JSON.stringify(message));
}

export function sendTo(client: LiveClient, message: unknown): void {
  send(client, message);
}

export function sendToPlayer(playerId: string, message: unknown): void {
  for (const client of clients) if (client.session.playerId === playerId) send(client, message);
}

export function notifyPlayer(playerId: string): void {
  sendToPlayer(playerId, { topic: 'me' });
}

export function watchersOf(topic: string): LiveClient[] {
  return [...clients].filter((client) => client.topics.has(topic));
}

export function publish(topic: string, message: unknown): void {
  for (const client of watchersOf(topic)) send(client, { topic, ...(message as object) });
}

export function watchedTopics(prefix: string): string[] {
  const topics = new Set<string>();
  for (const client of clients) for (const topic of client.topics) if (topic.startsWith(prefix)) topics.add(topic);
  return [...topics];
}

export function isOnline(playerId: string): boolean {
  return [...clients].some((client) => client.session.playerId === playerId);
}

function setTopics(client: LiveClient, wanted: string[]): void {
  const next = new Set(wanted);
  for (const topic of [...client.topics]) {
    if (!next.has(topic)) {
      client.topics.delete(topic);
      hooks.unwatch(client, topic);
    }
  }
  for (const topic of next) {
    if (!client.topics.has(topic)) {
      client.topics.add(topic);
      hooks.watch(client, topic);
    }
  }
}

function isTopicList(value: unknown): value is { topics: string[] } {
  const { topics } = value as { topics?: unknown };
  return Array.isArray(topics) && topics.every((topic) => typeof topic === 'string');
}

export function acceptUpgrade(request: IncomingMessage, stream: Duplex, head: Buffer, session: Session): void {
  server.handleUpgrade(request, stream, head, (socket) => {
    const client: LiveClient = { socket, session, topics: new Set() };
    const first = !isOnline(session.playerId);
    clients.add(client);
    if (first) hooks.presence(session.playerId, true);
    socket.on('error', () => socket.terminate());
    socket.on('message', (data) => {
      try {
        const message: unknown = JSON.parse(String(data));
        if (isTopicList(message)) setTopics(client, message.topics);
      } catch {
        socket.close();
      }
    });
    socket.on('close', () => {
      setTopics(client, []);
      clients.delete(client);
      if (!isOnline(session.playerId)) hooks.presence(session.playerId, false);
    });
  });
}
