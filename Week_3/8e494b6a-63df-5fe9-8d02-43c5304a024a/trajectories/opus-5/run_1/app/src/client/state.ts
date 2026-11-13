export type Me = {
  username: string;
  time_zone: string;
  space: { slug: string; name: string; role: 'viewer' | 'editor' | 'admin' };
  spaces: { slug: string; name: string; role: string }[];
  seq: number;
};

export type Config = {
  grading: boolean;
  settings: {
    page_size: number;
    tail_buffer: number;
    query_max_len: number;
    query_max_depth: number;
    upload_max_bytes: number;
    sse_heartbeat_ms: number;
  };
};

export type LiveMessage = {
  type: 'clock' | 'alert' | 'inbox' | 'case' | 'upload' | 'lifecycle';
  seq: number;
  [key: string]: unknown;
};

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
    readonly position?: number,
  ) {
    super(message);
  }
}

export const state = {
  me: null as Me | null,
  config: null as Config | null,
  serverTimeMs: Date.now(),
  seq: 0,
  pending: 0,
  stored: 0,
  failures: 0,
  notice: null as string | null,
};

type Listener = (message: LiveMessage) => void;

let liveHandler: Listener | null = null;
const shellListeners: Listener[] = [];

export function setLiveHandler(handler: Listener | null): void {
  liveHandler = handler;
}

export function addShellListener(handler: Listener): void {
  shellListeners.push(handler);
}

let announceTarget: ((sentences: string[]) => void) | null = null;
let pendingTarget: (() => void) | null = null;

export function setShellHooks(hooks: {
  announce: (sentences: string[]) => void;
  pending: () => void;
}): void {
  announceTarget = hooks.announce;
  pendingTarget = hooks.pending;
}

export function announce(...sentences: string[]): void {
  const text = sentences.filter((sentence) => sentence !== '').join(' ');
  if (text === '' || !announceTarget) return;
  announceTarget([text]);
}

export function notice(text: string): void {
  state.notice = text;
  announce(text);
}

async function request<T>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    throw new ApiFailure(
      response.status,
      String(parsed.error ?? 'not_found'),
      String(parsed.message ?? 'Not found.'),
      parsed.fields as Record<string, string> | undefined,
      parsed.seq === undefined ? (parsed.position as number | undefined) : (parsed.position as number | undefined),
    );
  }
  return parsed as T;
}

export async function get<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

/** Every write counts in data-pending while it is in flight. */
export async function write<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  raw?: BodyInit,
): Promise<T> {
  state.pending += 1;
  pendingTarget?.();
  try {
    return await request<T>(method, path, body, raw);
  } finally {
    state.pending -= 1;
    pendingTarget?.();
  }
}

export async function busyWrite<T>(
  node: HTMLButtonElement,
  work: () => Promise<T>,
): Promise<T | null> {
  if (node.getAttribute('aria-busy') === 'true') return null;
  node.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    node.removeAttribute('aria-busy');
  }
}

let eventSource: EventSource | null = null;

export function connectLive(spaceSlug: string): void {
  eventSource?.close();
  eventSource = new EventSource(`/api/events?space=${encodeURIComponent(spaceSlug)}`);
  eventSource.addEventListener('message', (event) => {
    const message = JSON.parse((event as MessageEvent<string>).data) as LiveMessage;
    state.seq = message.seq;
    if (message.type === 'clock') {
      state.serverTimeMs = Number(message.now_ms);
    }
    if (typeof message.stored_total === 'number') state.stored = message.stored_total as number;
    if (typeof message.failure_total === 'number') state.failures = message.failure_total as number;
    for (const listener of shellListeners) listener(message);
    liveHandler?.(message);
  });
}

export async function refreshServerTime(): Promise<void> {
  const time = await get<{ now_ms: number }>('/api/time');
  state.serverTimeMs = time.now_ms;
}

export function zone(): string {
  return state.me?.time_zone ?? 'UTC';
}

export function roleAllows(needed: 'viewer' | 'editor' | 'admin'): boolean {
  const order = ['viewer', 'editor', 'admin'];
  const role = state.me?.space.role ?? 'viewer';
  return order.indexOf(role) >= order.indexOf(needed);
}
