import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { publish } from './collab.js';

export interface SetEvent {
  event: 'op' | 'lock' | 'presence' | 'status' | 'show';
  data: unknown;
  id?: number;
}

type Listener = (event: SetEvent) => void;

const listeners = new Map<string, Set<Listener>>();
const processId = randomUUID();

export function subscribe(setId: string, listener: Listener): () => void {
  const existing = listeners.get(setId) ?? new Set<Listener>();
  existing.add(listener);
  listeners.set(setId, existing);
  return () => {
    existing.delete(listener);
    if (existing.size === 0) listeners.delete(setId);
  };
}

function deliver(setId: string, event: SetEvent): void {
  for (const listener of listeners.get(setId) ?? []) listener(event);
}

/** Committed ops, lock changes, presence and show pointer moves fan out through Valkey. */
export function emit(setId: string, event: SetEvent): void {
  deliver(setId, event);
  void publish(setId, { origin: processId, ...event });
}

export function relayFromCollab(setId: string, message: unknown): void {
  if (message === null || typeof message !== 'object') return;
  const envelope = message as { origin?: string } & SetEvent;
  if (envelope.origin === processId) return;
  deliver(setId, { event: envelope.event, data: envelope.data, id: envelope.id });
}

export function openStream(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': open\n\n');
}

export function writeEvent(res: ServerResponse, event: SetEvent): void {
  const lines: string[] = [];
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  lines.push(`event: ${event.event}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  res.write(`${lines.join('\n')}\n\n`);
}

export function keepAlive(res: ServerResponse): NodeJS.Timeout {
  const timer = setInterval(() => res.write(': ping\n\n'), 15000);
  timer.unref();
  return timer;
}
