// The live sync channel over a streamed fetch, resuming from the last event id after any drop.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { signedOut } from './api.ts';

export type SyncStatus = 'connecting' | 'live' | 'paused';
type Listener = (event: string, data: unknown) => void;

const RETRY_MS = 2000;
const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let status: SyncStatus = 'connecting';
let lastId: string | null = null;
let controller: AbortController | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let started = false;

function setStatus(next: SyncStatus): void {
  if (status === next) return;
  status = next;
  for (const fn of statusListeners) fn();
}

function dispatch(event: string, raw: string, id: string | null): void {
  if (id !== null) lastId = id;
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (event === 'session.ended') {
    stop();
    signedOut();
    return;
  }
  for (const fn of [...listeners]) fn(event, data);
}

function scheduleReconnect(): void {
  if (retry !== null || !started) return;
  retry = setTimeout(() => {
    retry = null;
    void connect();
  }, RETRY_MS);
}

async function connect(): Promise<void> {
  controller?.abort();
  const own = new AbortController();
  controller = own;
  try {
    const response = await fetch('/api/events', {
      headers: { Accept: 'text/event-stream', ...(lastId ? { 'Last-Event-ID': lastId } : {}) },
      credentials: 'same-origin', signal: own.signal,
    });
    if (response.status === 401) {
      stop();
      signedOut();
      return;
    }
    if (!response.ok || !response.body) throw new Error('channel refused');
    setStatus('live');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let event = 'message';
    let data: string[] = [];
    let id: string | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line === '') {
          if (data.length) dispatch(event, data.join('\n'), id);
          event = 'message';
          data = [];
          id = null;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const key = colon === -1 ? line : line.slice(0, colon);
          const val = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (key === 'data') data.push(val);
          else if (key === 'event') event = val;
          else if (key === 'id') id = val;
        }
      }
    }
  } catch {
    // dropped or refused; reconnect below
  }
  if (controller !== own) return;
  setStatus('paused');
  scheduleReconnect();
}

function stop(): void {
  started = false;
  controller?.abort();
  controller = null;
  if (retry !== null) clearTimeout(retry);
  retry = null;
}

/** Opens the channel once per tab; drops are reported as paused and resumed from the last id. */
export function startSync(): void {
  if (started) return;
  started = true;
  window.addEventListener('offline', () => {
    if (!started) return;
    controller?.abort();
    controller = null;
    setStatus('paused');
  });
  window.addEventListener('online', () => {
    if (!started) return;
    if (retry !== null) clearTimeout(retry);
    retry = null;
    void connect();
  });
  void connect();
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore((fn) => {
    statusListeners.add(fn);
    return () => statusListeners.delete(fn);
  }, () => status);
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Runs `handler` for every incoming event; the latest handler is always used. */
export function useSync(handler: Listener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e, d) => ref.current(e, d)), []);
}
