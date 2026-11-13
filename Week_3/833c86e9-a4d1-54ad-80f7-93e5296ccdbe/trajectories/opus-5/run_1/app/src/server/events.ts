import { ServerResponse } from 'node:http';
import { config } from './config';
import { nowIso } from './clock';

export type EventName = 'clock' | 'availability' | 'quote.changed' | 'hold.expired' | 'account.changed';

interface Stream {
  res: ServerResponse;
  visitorId: string | null;
  username: string | null;
  heartbeat: NodeJS.Timeout;
}

const streams = new Set<Stream>();

export function addStream(res: ServerResponse, visitorId: string | null, username: string | null): Stream {
  const heartbeat = setInterval(() => {
    res.write(': keep-alive\n\n');
  }, config.sseHeartbeatMs);
  const stream: Stream = { res, visitorId, username, heartbeat };
  streams.add(stream);
  res.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(stream);
  });
  return stream;
}

export function send(stream: Stream, event: EventName, data: Record<string, unknown>): void {
  stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function broadcast(event: EventName, data: Record<string, unknown>): void {
  for (const stream of streams) send(stream, event, data);
}

/** Sends to the streams of one browser context (its visitor) and of that user's sessions. */
export function sendToContext(
  owner: { visitorId: string | null; username: string | null },
  event: EventName,
  data: Record<string, unknown>,
): void {
  for (const stream of streams) {
    const sameVisitor = owner.visitorId !== null && stream.visitorId === owner.visitorId;
    const sameUser = owner.username !== null && stream.username === owner.username;
    if (sameVisitor || sameUser) send(stream, event, data);
  }
}

export function sendToUser(username: string, event: EventName, data: Record<string, unknown>): void {
  for (const stream of streams) if (stream.username === username) send(stream, event, data);
}

export function broadcastClock(): void {
  broadcast('clock', { now: nowIso() });
}

