import { api } from './api';

export type AppConfig = {
  post_max_chars: number;
  see_more_chars: number;
  typing_timeout_ms: number;
  max_skills: number;
  photo_max_bytes: number;
  resume_max_bytes: number;
  feed_page_size: number;
  time_zone: string;
  now: string;
};

export type Me = {
  id: string;
  handle: string;
  name: string;
} | null;

let appConfig: AppConfig = {
  post_max_chars: 3000,
  see_more_chars: 210,
  typing_timeout_ms: 5000,
  max_skills: 50,
  photo_max_bytes: 5000000,
  resume_max_bytes: 2000000,
  feed_page_size: 10,
  time_zone: 'UTC',
  now: new Date(0).toISOString(),
};

let me: Me = null;
let serverNowMs = 0;
let receivedAt = 0;

export function cfg(): AppConfig {
  return appConfig;
}

export function currentMember(): Me {
  return me;
}

/** The business clock, as the server last reported it, advanced by elapsed time only. */
export function nowIso(): string {
  return new Date(serverNowMs + (performance.now() - receivedAt)).toISOString();
}

export function setServerNow(iso: string): void {
  serverNowMs = Date.parse(iso);
  receivedAt = performance.now();
}

type Handler = (data: Record<string, unknown>) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(event: string, handler: Handler): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler);
  return () => set?.delete(handler);
}

function emit(event: string, data: Record<string, unknown>): void {
  for (const handler of handlers.get(event) ?? []) handler(data);
  for (const handler of handlers.get('*') ?? []) handler({ ...data, event });
}

const LIVE_EVENTS = [
  'hello',
  'tick',
  'clock',
  'network',
  'graph',
  'profile',
  'skills',
  'post',
  'post_deleted',
  'feed',
  'message',
  'typing',
  'read',
  'application',
  'board',
  'job_field',
  'job_typing',
  'job_presence',
];

export function connectLive(): void {
  const source = new EventSource('/api/live');
  for (const name of LIVE_EVENTS) {
    source.addEventListener(name, (event) => {
      const data = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
      if (typeof data.now === 'string') setServerNow(data.now);
      emit(name, data);
    });
  }
  source.addEventListener('error', () => {
    /* EventSource reconnects by itself; nothing is polled. */
  });
}

export async function loadConfig(): Promise<void> {
  const result = await api.get<AppConfig>('/api/config');
  if (result.ok) {
    appConfig = result.body;
    setServerNow(result.body.now);
  }
}

export async function loadMe(): Promise<void> {
  const result = await api.get<{ id: string; handle: string; name: string }>('/api/me');
  me = result.ok ? { id: result.body.id, handle: result.body.handle, name: result.body.name } : null;
}

export type Counters = { messaging: number; notifications: number; invitations: number };
let counters: Counters = { messaging: 0, notifications: 0, invitations: 0 };
const counterListeners = new Set<(value: Counters) => void>();

export function onCounters(listener: (value: Counters) => void): () => void {
  counterListeners.add(listener);
  listener(counters);
  return () => counterListeners.delete(listener);
}

export async function refreshCounters(): Promise<void> {
  if (!me) return;
  const [conversations, notifications, network] = await Promise.all([
    api.get<{ conversations: { unread_count: number }[] }>('/api/conversations'),
    api.get<{ unread_count: number }>('/api/notifications'),
    api.get<{ received: unknown[] }>('/api/network'),
  ]);
  counters = {
    messaging: conversations.ok
      ? conversations.body.conversations.filter((entry) => entry.unread_count > 0).length
      : 0,
    notifications: notifications.ok ? notifications.body.unread_count : 0,
    invitations: network.ok ? network.body.received.length : 0,
  };
  for (const listener of counterListeners) listener(counters);
}
