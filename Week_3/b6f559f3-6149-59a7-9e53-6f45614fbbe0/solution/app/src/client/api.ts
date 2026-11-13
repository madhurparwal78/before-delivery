import type { ApiErrorBody } from '../shared/protocol';
import type { PublicSettings } from '../shared/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly errors: Record<string, string>,
  ) {
    super(message);
  }
}

export const newId = (): string => crypto.randomUUID();

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function send<T>(method: Method, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, 'network', 'Server unreachable.', {});
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const failure = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, failure.error ?? 'error', failure.message ?? 'Something went wrong.', failure.errors ?? {});
  }
  return data as T;
}

/** JSON and multipart calls to the app's own API. Failures throw `ApiError` carrying the published error shape. */
export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> => send<T>('POST', path, body ?? {}, headers),
  put: <T>(path: string, body?: unknown): Promise<T> => send<T>('PUT', path, body),
  delete: <T>(path: string): Promise<T> => send<T>('DELETE', path),
  upload: <T>(path: string, form: FormData): Promise<T> => send<T>('POST', path, form),
};

/** The few non-secret tunables the server injects into the HTML shell. */
export function publicSettings(): PublicSettings {
  const node = document.getElementById('hs-settings');
  return node?.textContent
    ? (JSON.parse(node.textContent) as PublicSettings)
    : { autosaveMs: 800, embedPollSeconds: 30, particleMax: 2000, timeZone: 'Europe/Lisbon' };
}
