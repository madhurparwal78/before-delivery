// The one place that talks to the server. Every ordinary request is counted in `body[data-pending]`; the event
// streams (`/api/events`, export streams) are EventSource connections and never pass through here.
import type { LineError } from './types.ts';

interface ApiBody {
  error: string;
  errors?: Record<string, string> | LineError[];
  message?: string;
  version?: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiBody;
  readonly retryAfter: number | null;

  constructor(status: number, body: ApiBody, retryAfter: number | null) {
    super(body.error);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }

  /** `errors` of a validation answer, keyed by field. */
  get fields(): Record<string, string> {
    const { errors } = this.body;
    return errors && !Array.isArray(errors) ? errors : {};
  }

  /** `errors` of an upload answer, one per line. */
  get lines(): LineError[] {
    const { errors } = this.body;
    return Array.isArray(errors) ? errors : [];
  }

  /** The first field message, preferring `key`. */
  fieldMessage(key?: string): string | null {
    const fields = this.fields;
    return (key ? fields[key] : undefined) ?? Object.values(fields)[0] ?? null;
  }
}

/** Copy for the answers every page treats alike, or null when the page should handle the error itself. */
export function generalErrorCopy(error: unknown): string | null {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  if (error.status === 429) return `Too many requests. Try again in ${error.retryAfter ?? 1} seconds.`;
  if (error.status >= 500) return 'Something went wrong. Try again.';
  return null;
}

let pending = 0;

function setPending(next: number): void {
  pending = next;
  document.body.dataset.pending = String(pending);
}

/**
 * Holds `body[data-pending]` above zero while `work` runs. Composite operations (request, then state update) use it
 * so the counter drops only after the screen has caught up.
 */
export async function track<T>(work: () => Promise<T>): Promise<T> {
  setPending(pending + 1);
  try {
    return await work();
  } finally {
    setPending(pending - 1);
  }
}

let onUnauthenticated: () => void = () => undefined;

/** The router registers where a signed-out request sends the user. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

interface RequestOptions {
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  headers?: Record<string, string>;
}

async function send(method: string, path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.json);
  } else if (options.bytes) {
    headers['Content-Type'] = 'text/csv';
    body = options.bytes;
  }
  const response = await fetch(path, { method, headers, body });
  if (response.ok) return response;
  const retry = Number(response.headers.get('Retry-After'));
  const parsed: unknown = await response.json().catch(() => ({ error: 'server_error' }));
  const apiError = new ApiError(response.status, parsed as ApiBody, retry > 0 ? retry : null);
  if (response.status === 401 && path !== '/api/me' && !path.startsWith('/api/auth/')) onUnauthenticated();
  throw apiError;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  return track(async () => {
    const response = await send(method, path, options);
    return (response.status === 204 ? undefined : await response.json()) as T;
  });
}

let lastDownloadUrl: string | null = null;

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>('GET', path, { headers }),
  post: <T>(path: string, json?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { json, headers }),
  put: <T>(path: string, json?: unknown, headers?: Record<string, string>) => request<T>('PUT', path, { json, headers }),
  patch: <T>(path: string, json?: unknown, headers?: Record<string, string>) => request<T>('PATCH', path, { json, headers }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
  /** Sends the bytes of a CSV file untouched. */
  csv: <T>(method: 'POST' | 'PUT', path: string, bytes: Uint8Array<ArrayBuffer>) => request<T>(method, path, { bytes }),
  text: (path: string) => track(async () => (await send('GET', path, {})).text()),
  /** Fetches a file and hands it to the browser as a download, so a storage outage shows as an error, not a JSON file. */
  download: (path: string, fallbackName: string) =>
    track(async () => {
      const response = await send('GET', path, {});
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
      if (lastDownloadUrl) URL.revokeObjectURL(lastDownloadUrl);
      lastDownloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = lastDownloadUrl;
      link.download = name;
      document.body.append(link);
      link.click();
      link.remove();
    }),
};
