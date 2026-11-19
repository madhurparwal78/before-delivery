/** The JSON API and the one live channel, both on this origin. */

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fields?: Record<string, string>;
    readonly conflicts?: {
      field: string;
      label: string;
      yours: unknown;
      theirs: unknown;
      theirs_by: string;
      version: number;
    }[];
  };
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.error.message);
    this.name = 'ApiFailure';
  }

  get code(): string {
    return this.body.error.code;
  }

  get fields(): Record<string, string> {
    return this.body.error.fields ?? {};
  }
}

async function send<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text === '' ? {} : JSON.parse(text);
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> =>
    send<T>('POST', path, body ?? {}, headers),
  patch: <T>(path: string, body?: unknown): Promise<T> => send<T>('PATCH', path, body ?? {}),
  put: <T>(path: string, body?: unknown): Promise<T> => send<T>('PUT', path, body ?? {}),
  delete: <T>(path: string): Promise<T> => send<T>('DELETE', path),
  upload: async <T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> => {
    const form = new FormData();
    form.set('file', file);
    for (const [name, value] of Object.entries(fields)) form.set(name, value);
    const response = await fetch(path, { method: 'POST', body: form, credentials: 'same-origin' });
    const text = await response.text();
    const parsed: unknown = text === '' ? {} : JSON.parse(text);
    if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody);
    return parsed as T;
  },
};

export interface LiveMessage {
  readonly topic: string;
  readonly event: string;
  readonly data: Record<string, unknown>;
  readonly server_time: string;
}

type Listener = (message: LiveMessage) => void;

class LiveChannel {
  private socket: WebSocket | null = null;
  private readonly topics = new Set<string>();
  private readonly listeners = new Set<Listener>();
  private presenceOn: string | null = null;
  private heartbeat: number | null = null;

  connect(): void {
    if (this.socket && this.socket.readyState <= 1) return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.socket = new WebSocket(`${scheme}://${location.host}/api/live`);
    this.socket.addEventListener('open', () => {
      if (this.topics.size > 0) this.send({ subscribe: [...this.topics] });
      if (this.presenceOn) this.send({ presence: this.presenceOn });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as LiveMessage;
      for (const listener of this.listeners) listener(message);
    });
    this.socket.addEventListener('close', () => {
      window.setTimeout(() => this.connect(), 1000);
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket && this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  subscribe(topics: string[]): void {
    const fresh = topics.filter((topic) => !this.topics.has(topic));
    for (const topic of topics) this.topics.add(topic);
    if (fresh.length > 0) this.send({ subscribe: fresh });
  }

  replaceTopics(topics: string[]): void {
    const gone = [...this.topics].filter((topic) => !topics.includes(topic));
    if (gone.length > 0) this.send({ unsubscribe: gone });
    for (const topic of gone) this.topics.delete(topic);
    this.subscribe(topics);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** An open form registers presence every 10 seconds. */
  startPresence(number: string): void {
    this.stopPresence();
    this.presenceOn = number;
    this.send({ presence: number });
    this.heartbeat = window.setInterval(() => this.send({ presence: number }), 10_000);
  }

  stopPresence(): void {
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.presenceOn) this.send({ leave: this.presenceOn });
    this.presenceOn = null;
  }
}

export const live = new LiveChannel();
