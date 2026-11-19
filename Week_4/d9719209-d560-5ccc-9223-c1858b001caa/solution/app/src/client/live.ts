import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { StreamEventName, StreamPayloads } from '../shared/types.js';
import { announce } from './announce.js';

export type LiveEventName = Exclude<StreamEventName, 'resync'>;
export type LiveHandler = <E extends LiveEventName | 'resync'>(event: E, data: StreamPayloads[E]) => void;
export type LiveStatus = 'connecting' | 'live' | 'paused';

const EVENTS: Array<LiveEventName | 'resync'> = ['score', 'comments', 'comment', 'post-state', 'membership', 'account', 'resync'];
const RETRY_PAUSED_MS = 10_000;

interface Subscriber { topics: string[]; handler: LiveHandler }

const subscribers = new Set<Subscriber>();
const statusListeners = new Set<() => void>();
let status: LiveStatus = 'connecting';
let source: EventSource | null = null;
let openTopics = '';
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let scheduled = false;
let wasPaused = false;

function setStatus(next: LiveStatus): void {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function unionTopics(): string {
  return [...new Set([...subscribers].flatMap((s) => s.topics))].sort().join(',');
}

function dispatch<E extends LiveEventName | 'resync'>(event: E, data: StreamPayloads[E]): void {
  for (const subscriber of [...subscribers]) subscriber.handler(event, data);
}

function pause(): void {
  source?.close();
  source = null;
  if (status !== 'paused') {
    setStatus('paused');
    announce('Live updates paused');
  }
  wasPaused = true;
  clearTimeout(retryTimer);
  retryTimer = setTimeout(connect, RETRY_PAUSED_MS);
}

function connect(): void {
  scheduled = false;
  clearTimeout(retryTimer);
  source?.close();
  openTopics = unionTopics();
  const next = new EventSource(`/api/stream?topics=${encodeURIComponent(openTopics)}`);
  source = next;
  next.onopen = () => {
    setStatus('live');
    if (wasPaused) {
      wasPaused = false;
      dispatch('resync', {});
    }
  };
  next.onerror = () => {
    // A refusal (for example 503 while Valkey is down) closes the source for good; a dropped connection reconnects by itself.
    if (next.readyState === EventSource.CLOSED) pause();
  };
  for (const name of EVENTS) {
    next.addEventListener(name, (message) => {
      const data = JSON.parse((message as MessageEvent<string>).data) as StreamPayloads[typeof name];
      dispatch(name, data);
    });
  }
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  void Promise.resolve().then(() => {
    if (source !== null && unionTopics() === openTopics && status !== 'paused') {
      scheduled = false;
      return;
    }
    if (status === 'paused' && source === null) {
      scheduled = false;
      return;
    }
    connect();
  });
}

/** Subscribes `handler` to the live stream for `topics`; the shared connection widens to the union of every subscriber's topics. */
export function subscribe(topics: string[], handler: LiveHandler): () => void {
  const subscriber: Subscriber = { topics, handler };
  subscribers.add(subscriber);
  schedule();
  return () => {
    subscribers.delete(subscriber);
  };
}

/** Opens the stream again, for example after the session changed, so it carries the right account events. */
export function restartLive(): void {
  wasPaused = false;
  connect();
}

export function useLive(topics: string[], handler: LiveHandler): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = topics.join(',');
  useEffect(() => subscribe(key === '' ? [] : key.split(','), (event, data) => latest.current(event, data)), [key]);
}

export function useLiveStatus(): LiveStatus {
  return useSyncExternalStore((cb) => { statusListeners.add(cb); return () => { statusListeners.delete(cb); }; }, () => status);
}
