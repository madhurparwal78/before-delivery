import { useEffect, useRef } from 'react';

import type { MemberRef } from './types';

interface EditorRef {
  id: string;
  name: string;
}

/** Every event the server pushes (payloads are ids only; pages refetch) plus the local `reconnected`. */
type LiveEvent =
  | { type: 'clock'; now: string }
  | { type: 'graph' }
  | { type: 'network' }
  | { type: 'connected'; member: MemberRef }
  | { type: 'post'; post_id: string; change: 'created' | 'updated' | 'deleted' | 'reactions' | 'comments' | 'reposts'; author_id: string }
  | { type: 'notification' }
  | { type: 'message'; conversation_id: string; message_id: string; sender_id: string }
  | { type: 'typing'; conversation_id: string; member_id: string }
  | { type: 'read'; conversation_id: string }
  | { type: 'skills'; member_id: string }
  | { type: 'job'; job_id: string; change: 'closed' | 'updated' }
  | { type: 'application'; application_id: string; job_id: string; state: string }
  | { type: 'job_field'; job_id: string; field: string; version: number; by: EditorRef }
  | { type: 'job_presence'; job_id: string; editing: EditorRef[] }
  | { type: 'job_typing'; job_id: string; field: string; member: EditorRef }
  | { type: 'reconnected' };

type LiveEventType = LiveEvent['type'];
type LiveEventOf<T extends LiveEventType> = Extract<LiveEvent, { type: T }>;

type Handler = (event: LiveEvent) => void;

/** Every event name the server sends; `reconnected` is raised locally when a dropped stream is open again. */
const EVENT_TYPES: Array<Exclude<LiveEventType, 'reconnected'>> = [
  'clock',
  'graph',
  'network',
  'connected',
  'post',
  'notification',
  'message',
  'typing',
  'read',
  'skills',
  'job',
  'application',
  'job_field',
  'job_presence',
  'job_typing',
];

const RECONNECT_MS = 2000;

/** What a stream transport reports: an event's JSON, the stream open, or the stream lost (it reconnects itself). */
type Signal = { kind: 'event'; data: string } | { kind: 'open' } | { kind: 'lost' };

/**
 * Opens the event stream at `url` and reports each signal; returns the close. The stream lives in a worker of this
 * page alone (`live-worker.ts`), so an open stream never keeps the page counted as loading;
 * browsers without shared workers hold the EventSource on the page.
 */
function openTransport(url: string, onSignal: (signal: Signal) => void): () => void {
  if (typeof SharedWorker !== 'undefined') {
    const name = `live-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const worker = new SharedWorker(new URL('./live-worker.ts', import.meta.url), { name, type: 'module' });
    worker.port.onmessage = (message: MessageEvent<Signal>) => onSignal(message.data);
    worker.port.start();
    worker.port.postMessage({ url: new URL(url, window.location.href).href, types: EVENT_TYPES });
    return () => {
      worker.port.postMessage('close');
      worker.port.close();
    };
  }
  let source: EventSource | null = null;
  let timer: number | undefined;
  const connect = (): void => {
    const current = new EventSource(url);
    source = current;
    for (const type of EVENT_TYPES) {
      current.addEventListener(type, (message) => onSignal({ kind: 'event', data: (message as MessageEvent<string>).data }));
    }
    current.onopen = () => onSignal({ kind: 'open' });
    current.onerror = () => {
      onSignal({ kind: 'lost' });
      if (current.readyState === EventSource.CLOSED) timer = window.setTimeout(connect, RECONNECT_MS);
    };
  };
  connect();
  return () => {
    window.clearTimeout(timer);
    source?.close();
  };
}

/** One event stream and the handlers listening on it. The shared stream and each editor stream have one of these. */
type Stream = {
  readonly url: string;
  readonly handlers: Set<Handler>;
  closeTransport: (() => void) | null;
  lost: boolean;
  enabled: boolean;
};

const streamAt = (url: string, enabled: boolean): Stream => ({
  url,
  handlers: new Set(),
  closeTransport: null,
  lost: false,
  enabled,
});

function emit(stream: Stream, event: LiveEvent): void {
  for (const handler of [...stream.handlers]) handler(event);
}

/** Opens the stream at once; after a lost stream opens again, every listener is asked to read again. */
function open(stream: Stream): void {
  if (stream.closeTransport) return;
  stream.closeTransport = openTransport(stream.url, (signal) => {
    if (signal.kind === 'event') emit(stream, JSON.parse(signal.data) as LiveEvent);
    else if (signal.kind === 'lost') stream.lost = true;
    else {
      if (stream.lost) emit(stream, { type: 'reconnected' });
      stream.lost = false;
    }
  });
}

function close(stream: Stream): void {
  stream.closeTransport?.();
  stream.closeTransport = null;
  stream.lost = false;
}

function subscribe(stream: Stream, handler: Handler): () => void {
  stream.handlers.add(handler);
  if (stream.enabled) open(stream);
  return () => {
    stream.handlers.delete(handler);
    if (stream.handlers.size === 0) close(stream);
  };
}

/** The stream is only open while enabled (signed in) and somebody listens. */
function enable(stream: Stream, enabled: boolean): void {
  stream.enabled = enabled;
  if (!enabled) close(stream);
  else if (stream.handlers.size > 0) open(stream);
}

const shared = streamAt('/api/live', false);

/** Called by the session: the member stream exists only while signed in. */
export const setLiveEnabled = (enabled: boolean): void => enable(shared, enabled);

/** Calls the handler for each listed event type from the member's shared stream. The handler may change every render. */
export function useLive<T extends LiveEventType>(types: T | T[], handler: (event: LiveEventOf<T>) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const wanted = Array.isArray(types) ? types.join(',') : types;
  useEffect(() => {
    const list: LiveEventType[] = wanted.split(',') as LiveEventType[];
    return subscribe(shared, (event) => {
      if (list.includes(event.type)) latest.current(event as LiveEventOf<T>);
    });
  }, [wanted]);
}

/**
 * Opens the job editor's own stream (`/api/live?editor=<jobId>`) while mounted; the server lists this member as
 * editing while it is open. The handler receives every event of that stream.
 */
export function useEditorStream(jobId: string | null, handler: Handler): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!jobId) return undefined;
    return subscribe(streamAt(`/api/live?editor=${encodeURIComponent(jobId)}`, true), (event) => latest.current(event));
  }, [jobId]);
}
