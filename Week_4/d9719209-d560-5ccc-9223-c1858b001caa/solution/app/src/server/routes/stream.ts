import type { ServerResponse } from 'node:http';
import { route, STREAMED, type Ctx, type Reply } from '../http.js';
import { optionalUser } from '../guards.js';
import { eventsAfter, isAfter, onLiveEvent, replayHasGap, valkeyAnswers, valkeyUnavailable, type LiveEvent } from '../valkey.js';

const HEARTBEAT_MS = 10_000;

interface Connection {
  res: ServerResponse;
  topics: Set<string>;
  lastId: string;
  replaying: boolean;
  held: LiveEvent[];
}

const connections = new Set<Connection>();

const wanted = (connection: Connection, event: LiveEvent): boolean => event.topics.some((t) => connection.topics.has(t));

function deliver(connection: Connection, event: LiveEvent): void {
  if (!wanted(connection, event) || !isAfter(event.id, connection.lastId)) return;
  connection.lastId = event.id;
  connection.res.write(`id: ${event.id}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

/** Every process fans the shared live channel out to its own open streams. */
export function startFanout(): void {
  onLiveEvent((event) => {
    for (const connection of connections) {
      if (connection.replaying) connection.held.push(event);
      else deliver(connection, event);
    }
  });
}

function parseTopics(raw: string | null): string[] {
  return (raw ?? '').split(',').map((t) => t.trim()).filter((t) => t === 'home' || /^(community|post):[A-Za-z0-9_]+$/.test(t))
    .map((t) => (t.startsWith('community:') ? t.toLowerCase() : t));
}

async function stream(ctx: Ctx): Promise<Reply> {
  const user = optionalUser(ctx);
  if (!(await valkeyAnswers())) throw valkeyUnavailable();
  const topics = new Set(parseTopics(ctx.query.get('topics')));
  if (user) topics.add(`user:${user.id}`);
  const resumeFrom = typeof ctx.headers['last-event-id'] === 'string' && /^\d+-\d+$/.test(ctx.headers['last-event-id'])
    ? ctx.headers['last-event-id'] : null;
  const { res, req } = ctx;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write('retry: 3000\n\n');
  const connection: Connection = { res, topics, lastId: resumeFrom ?? '0-0', replaying: resumeFrom !== null, held: [] };
  connections.add(connection);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    connections.delete(connection);
  });
  if (resumeFrom !== null) {
    try {
      if (await replayHasGap(resumeFrom)) res.write('event: resync\ndata: {}\n\n');
      else for (const event of await eventsAfter(resumeFrom)) deliver(connection, event);
    } catch {
      res.write('event: resync\ndata: {}\n\n');
    }
    connection.replaying = false;
    for (const event of connection.held) deliver(connection, event);
    connection.held = [];
  }
  return STREAMED;
}

export function registerStreamRoutes(): void {
  route('GET', '/api/stream', stream);
}
