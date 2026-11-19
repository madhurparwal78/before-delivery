import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import pg from 'pg';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { LIVE_CHANNEL, type Queryable } from './db.js';
import type { LiveEvent, Role } from '../shared/types.js';

export interface Audience {
  principalIds?: string[];
  roles?: Role[];
  everyone?: boolean;
}

interface Envelope {
  event: LiveEvent;
  audience: Audience;
}

interface Subscriber {
  socket: WebSocket;
  principalId: string;
  role: Role;
}

const subscribers = new Set<Subscriber>();
const server = new WebSocketServer({ noServer: true });

export function handleUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  principal: { id: string; role: Role },
): void {
  server.handleUpgrade(request, socket, head, (ws) => {
    const subscriber: Subscriber = { socket: ws, principalId: principal.id, role: principal.role };
    subscribers.add(subscriber);
    ws.on('close', () => subscribers.delete(subscriber));
    ws.on('error', () => subscribers.delete(subscriber));
  });
}

export async function publish(tx: Queryable, event: LiveEvent, audience: Audience): Promise<void> {
  const envelope: Envelope = { event, audience };
  await tx.query('select pg_notify($1, $2)', [LIVE_CHANNEL, JSON.stringify(envelope)]);
}

function deliver(envelope: Envelope): void {
  const payload = JSON.stringify(envelope.event);
  for (const subscriber of subscribers) {
    const matches =
      envelope.audience.everyone === true ||
      (envelope.audience.principalIds ?? []).includes(subscriber.principalId) ||
      (envelope.audience.roles ?? []).includes(subscriber.role);
    if (matches && subscriber.socket.readyState === subscriber.socket.OPEN) {
      subscriber.socket.send(payload);
    }
  }
}

export async function startLiveListener(): Promise<void> {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  client.on('notification', (message) => {
    if (message.channel !== LIVE_CHANNEL || !message.payload) return;
    deliver(JSON.parse(message.payload) as Envelope);
  });
  client.on('error', () => {
    setTimeout(() => void startLiveListener(), 2000);
  });
  await client.connect();
  await client.query(`listen ${LIVE_CHANNEL}`);
}

export const EVERYONE: Audience = { everyone: true };
export const REVIEWERS: Role[] = ['brand_reviewer', 'legal_reviewer', 'owner'];
