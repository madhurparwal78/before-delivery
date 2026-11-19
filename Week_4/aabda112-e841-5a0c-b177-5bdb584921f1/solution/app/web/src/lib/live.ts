import { useEffect, useRef } from 'react';
import type { LiveEvent } from '../../../shared/domain';

type Handler = (event: LiveEvent | { t: '*' }) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;

/**
 * The stream opens once the page has settled, so the first paint and its requests never wait on a connection that
 * stays open. The wait is wall time (`AbortSignal.timeout`), never `setTimeout`: a page whose timers are held still
 * (a paused clock, a throttled tab) must still open its stream and hear every change.
 */
const SETTLE_MS = 1500;
let pending: AbortSignal | null = null;

/** The server's live sequence when the signed-in user was last read; the stream resumes from it, so nothing published
 * while the page settled is lost. */
let resumeAfter: string | null = null;

export function noteLiveSeq(value: string | null): void {
  if (value !== null && /^\d+$/.test(value) && !source) resumeAfter = value;
}

function open(): void {
  source = new EventSource(resumeAfter === null ? '/api/live' : `/api/live?after=${resumeAfter}`);
  source.onopen = () => {
    handlers.forEach((h) => h({ t: '*' }));
  };
  source.onmessage = (message) => {
    const event = JSON.parse(message.data) as LiveEvent;
    handlers.forEach((h) => h(event));
  };
  // A refused stream (the session ended, e.g. the user was removed before it opened) never retries on its own:
  // re-read the signed-in user, which signs a gone session out and reconnects a live one.
  source.onerror = () => {
    if (source?.readyState !== EventSource.CLOSED) return;
    source = null;
    handlers.forEach((h) => h({ t: '*' }));
  };
}

export function connectLive(): void {
  if (source || pending) return;
  const signal = AbortSignal.timeout(SETTLE_MS);
  pending = signal;
  signal.addEventListener('abort', () => {
    if (pending !== signal) return;
    pending = null;
    open();
  });
}

export function disconnectLive(): void {
  pending = null;
  source?.close();
  source = null;
}

/** Calls `handler` for the named kinds of change (and after every reconnect), always with the latest closure. */
export function useLive(kinds: readonly LiveEvent['t'][], handler: (event: LiveEvent | { t: '*' }) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = kinds.join(',');
  useEffect(() => {
    const own: Handler = (event) => {
      if (event.t === '*' || kinds.includes(event.t)) latest.current(event);
    };
    handlers.add(own);
    return () => void handlers.delete(own);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
