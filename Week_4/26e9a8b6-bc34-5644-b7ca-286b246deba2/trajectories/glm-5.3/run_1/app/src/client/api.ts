// Same-origin API calls and the live connection, with catch-up after a drop.

export interface ApiOptions {
  method?: string;
  body?: unknown;
  raw?: ArrayBuffer | Blob;
  contentType?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function api<T = Record<string, unknown>>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.raw !== undefined) {
    headers['content-type'] = options.contentType ?? 'model/gltf-binary';
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.raw instanceof Blob && (options.raw as File & { name?: string }).name) {
    headers['x-file-name'] = encodeURIComponent((options.raw as File & { name: string }).name);
  }
  const response = await fetch(path, {
    method: options.method ?? (options.body !== undefined || options.raw !== undefined ? 'POST' : 'GET'),
    headers,
    body: options.raw !== undefined ? options.raw : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 204) return {} as T;
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    const body = (json ?? {}) as Record<string, unknown>;
    throw new ApiError(response.status, String(body.error ?? 'unknown'), body);
  }
  return json as T;
}

export interface LiveEvent {
  type: string;
  guide_id?: string;
  [key: string]: unknown;
}

export interface LiveHandlers {
  onEvent: (event: LiveEvent) => void;
}

/** One same-origin live connection with retry on the browser's online event and within 1 s. */
export class LiveConnection {
  private source: EventSource | null = null;
  private retryTimer: number | null = null;
  private closed = false;

  constructor(
    private guideId: string | null,
    private handlers: LiveHandlers,
  ) {}

  start(): void {
    this.connect();
    window.addEventListener('online', () => this.connect());
  }

  stop(): void {
    this.closed = true;
    this.source?.close();
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
  }

  private connect(): void {
    if (this.closed) return;
    this.source?.close();
    const url = this.guideId ? `/api/live?guide=${encodeURIComponent(this.guideId)}` : '/api/live';
    const source = new EventSource(url);
    this.source = source;
    source.addEventListener('live', (event) => {
      try {
        this.handlers.onEvent(JSON.parse((event as MessageEvent).data) as LiveEvent);
      } catch (error) {
        // A malformed event is dropped; a handler error is reported.
        console.error('live handler failed', error);
      }
    });
    source.onopen = () => {
      if (this.retryTimer !== null) {
        window.clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
    };
    source.onerror = () => {
      source.close();
      if (this.closed) return;
      // Try again within 1 s; Last-Event-Id makes the server catch up.
      if (this.retryTimer === null) {
        this.retryTimer = window.setTimeout(() => {
          this.retryTimer = null;
          this.connect();
        }, 1000);
      }
    };
  }
}
