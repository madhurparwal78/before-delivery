import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { config, limits } from './config';
import { pool } from './db';
import { userFor } from './auth';
import { guideById, roleOf, isMember, visibleTo } from './content';
import type { LiveEvent, PresencePerson, User } from '../shared/types';

interface Client {
  ws: WebSocket;
  user: User | null;
  guideId: string | null;
  editor: boolean;
  step: number | null;
}

const clients = new Set<Client>();
const send = (client: Client, event: LiveEvent) => client.ws.readyState === 1 && client.ws.send(JSON.stringify(event));

/** Working-copy events go only to the guide's team; counts, questions and states go to everyone who may see the guide. */
const teamEvents = new Set<LiveEvent['type']>(['field', 'working', 'version']);

export function emitGuide(guideId: string, event: LiveEvent): void {
  for (const client of clients) if (client.guideId === guideId && (client.editor || !teamEvents.has(event.type))) send(client, event);
}

export function emitUser(userId: string, event: LiveEvent): void {
  for (const client of clients) if (client.user?.id === userId) send(client, event);
}

function peopleFor(guideId: string, viewer: Client): PresencePerson[] {
  const byUser = new Map<string, PresencePerson>();
  for (const other of clients)
    if (other.guideId === guideId && other.editor && other.user && other.user.id !== viewer.user?.id)
      byUser.set(other.user.id, { id: other.user.id, name: other.user.name, step: other.step ?? 0 });
  return [...byUser.values()];
}

function announcePresence(guideId: string): void {
  for (const client of clients)
    if (client.guideId === guideId && client.editor) send(client, { type: 'presence', people: peopleFor(guideId, client) });
}

async function hello(client: Client, message: { guide?: unknown; editor?: unknown; step?: unknown }): Promise<void> {
  if (typeof message.guide !== 'string') return;
  const guide = await guideById(pool, message.guide);
  if (!guide) return;
  const role = await roleOf(pool, guide, client.user);
  if (!visibleTo(guide, role)) return;
  client.guideId = guide.id;
  if (message.editor === true && isMember(role)) {
    client.editor = true;
    client.step = typeof message.step === 'number' ? message.step : 0;
    announcePresence(guide.id);
  }
}

function onUpgrade(wss: WebSocketServer) {
  return async (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', config.publicUrl).pathname !== '/api/live') return void socket.destroy();
    const user = await userFor(req).catch(() => null);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, user, guideId: null, editor: false, step: null };
      clients.add(client);
      ws.on('message', (raw) => {
        let message: { type?: unknown; guide?: unknown; editor?: unknown; step?: unknown };
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (message.type === 'hello') void hello(client, message);
        else if (message.type === 'step' && client.editor && typeof message.step === 'number') {
          client.step = message.step;
          if (client.guideId) announcePresence(client.guideId);
        }
      });
      ws.on('close', () => {
        setTimeout(() => {
          clients.delete(client);
          if (client.guideId && client.editor) announcePresence(client.guideId);
        }, limits.presence_grace_seconds * 1000);
      });
      ws.on('error', () => ws.terminate());
    });
  };
}

export function attachLive(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => void onUpgrade(wss)(req, socket, head));
  setInterval(() => {
    for (const client of clients) if (client.ws.readyState === 1) client.ws.ping();
  }, 20000).unref();
}
