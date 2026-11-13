import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { userForToken, sessionCookieName } from './auth';
import { limits } from './config';
import { getPattern, roleOf } from './patterns';
import { parseCookies } from './http';
import {
  liveUpdatesOn,
  onPatternMessage,
  presenceJoin,
  presenceLeave,
  presenceList,
  presenceTouch,
  publishPattern,
  watchLive,
} from './valkey';

export interface LiveMessage {
  kind: string;
  [key: string]: unknown;
}

interface Client {
  socket: WebSocket;
  userId: string;
  name: string;
  patternId: string;
  designer: boolean;
  queue: string[];
}

const clients = new Set<Client>();
const holds = new Set<string>();

const holdKey = (patternId: string, userId: string): string => `${patternId}|${userId}`;

export async function publish(patternId: string, message: LiveMessage): Promise<void> {
  await publishPattern(patternId, message);
}

export function setHold(patternId: string, userId: string, hold: boolean): void {
  const key = holdKey(patternId, userId);
  if (hold) {
    holds.add(key);
    return;
  }
  holds.delete(key);
  for (const client of clients) {
    if (client.patternId !== patternId || client.userId !== userId) continue;
    for (const queued of client.queue) client.socket.send(queued);
    client.queue = [];
  }
}

function deliver(patternId: string, raw: string): void {
  for (const client of clients) {
    if (client.patternId !== patternId) continue;
    if (holds.has(holdKey(patternId, client.userId))) {
      client.queue.push(raw);
      continue;
    }
    client.socket.send(raw);
  }
}

async function announcePresence(patternId: string): Promise<void> {
  const hash = await presenceList(patternId);
  const people = Object.entries(hash ?? {}).map(([id, name]) => ({ id, name }));
  await publish(patternId, { kind: 'presence', people });
}

export function attachLive(server: Server): void {
  const sockets = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    void (async () => {
      const cookies = parseCookies(request.headers.cookie);
      const user = await userForToken(cookies[sessionCookieName]);
      const patternId = url.searchParams.get('pattern') ?? '';
      const pattern = patternId ? await getPattern(patternId) : null;
      if (!user || (patternId !== '' && !pattern)) {
        socket.destroy();
        return;
      }
      const role = pattern ? await roleOf(user, pattern) : null;
      if (pattern && !role) {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => {
        const client: Client = {
          socket: ws,
          userId: user.id,
          name: user.name,
          patternId,
          designer: role === 'owner' || role === 'co-designer',
          queue: [],
        };
        clients.add(client);
        ws.send(JSON.stringify({ kind: 'live', on: liveUpdatesOn() }));
        if (client.designer) {
          void presenceJoin(patternId, user.id, user.name).then(() => announcePresence(patternId));
        }

        ws.on('message', (raw) => {
          let message: LiveMessage;
          try {
            message = JSON.parse(raw.toString()) as LiveMessage;
          } catch {
            return;
          }
          if (message.kind === 'cursor' && client.designer) {
            void publish(patternId, {
              kind: 'cursor',
              by: user.id,
              name: user.name,
              row: message.row,
              col: message.col,
            });
          }
        });
        ws.on('close', () => {
          clients.delete(client);
          const stillHere = [...clients].some(
            (other) => other.patternId === patternId && other.userId === user.id && other.designer,
          );
          if (client.designer && !stillHere) {
            void presenceLeave(patternId, user.id).then(() => announcePresence(patternId));
          }
        });
      });
    })();
  });

  onPatternMessage(deliver);

  watchLive((on) => {
    const raw = JSON.stringify({ kind: 'live', on });
    for (const client of clients) client.socket.send(raw);
    if (!on) return;
    const rejoined = new Set<string>();
    for (const client of clients) {
      if (!client.designer) continue;
      rejoined.add(client.patternId);
      void presenceJoin(client.patternId, client.userId, client.name);
    }
    for (const patternId of rejoined) {
      void presenceList(patternId).then(() => announcePresence(patternId));
    }
  });

  setInterval(
    () => {
      const patternIds = new Set([...clients].filter((client) => client.designer).map((c) => c.patternId));
      for (const patternId of patternIds) void presenceTouch(patternId);
    },
    Math.max(1, Math.floor(limits.presenceTtlSeconds / 2)) * 1000,
  ).unref();
}
