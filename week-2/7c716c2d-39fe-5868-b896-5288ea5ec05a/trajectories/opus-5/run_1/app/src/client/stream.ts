import type { EventName } from '../shared/types.js';

export type StreamEvent = { name: EventName; data: Record<string, unknown> };

type Handler = (event: StreamEvent) => void;

const handlers = new Set<Handler>();
let source: EventSource | null = null;

const names: EventName[] = [
  'message',
  'thread_reply',
  'message_deleted',
  'unread',
  'typing',
  'presence',
  'room',
  'knock',
  'issue',
  'doc',
  'notice',
  'revoked',
  'reset',
];

export function onStreamEvent(handler: Handler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function emit(name: EventName, raw: string): void {
  let data: Record<string, unknown> = {};
  if (raw !== '') {
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  for (const handler of [...handlers]) handler({ name, data });
}

/** One event stream per page, reconnecting with the last id it saw. */
export function startStream(): void {
  if (source !== null) return;
  const opened = new EventSource('/api/events', { withCredentials: true });
  source = opened;
  for (const name of names) {
    opened.addEventListener(name, (event) => {
      emit(name, (event as MessageEvent<string>).data);
    });
  }
}

export function stopStream(): void {
  source?.close();
  source = null;
}
