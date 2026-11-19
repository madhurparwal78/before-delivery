import type { ApiErrorDto } from '../shared/types.js';
import { heldKey } from './session.js';

/** The one error shape the frontend reads. */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorDto | null) {
    super(body?.error ?? 'unreachable');
    this.status = status;
    this.code = body?.error ?? 'unreachable';
    this.fields = body?.fields ?? {};
  }
}

type Listener = () => void;
const outageListeners = new Set<Listener>();

/** Pages read the status endpoint again after any 503. */
export function onOutage(listener: Listener): void {
  outageListeners.add(listener);
}

interface RequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly raw?: Blob;
  readonly contentType?: string;
  readonly anonymous?: boolean;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const key = heldKey();
  if (key !== null && options.anonymous !== true) headers['authorization'] = `Bearer ${key}`;
  if (options.idempotencyKey !== undefined) {
    headers['idempotency-key'] = options.idempotencyKey;
  }

  let payload: BodyInit | undefined;
  if (options.raw !== undefined) {
    headers['content-type'] = options.contentType ?? options.raw.type;
    payload = options.raw;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload });
  } catch {
    for (const listener of outageListeners) listener();
    throw new ApiFailure(0, null);
  }

  if (response.status === 503) {
    for (const listener of outageListeners) listener();
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text === '' ? null : (JSON.parse(text) as unknown);
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorDto | null);
  return parsed as T;
}

export const get = <T>(path: string): Promise<T> => request<T>('GET', path);
export const post = <T>(path: string, options?: RequestOptions): Promise<T> =>
  request<T>('POST', path, options);
export const patch = <T>(path: string, options?: RequestOptions): Promise<T> =>
  request<T>('PATCH', path, options);
export const del = (path: string): Promise<void> => request<void>('DELETE', path);

/** Confirms a pasted key with the server before the browser adopts that identity. */
export async function confirmKey(candidate: string): Promise<boolean> {
  try {
    const response = await fetch('/api/me', {
      headers: { authorization: `Bearer ${candidate}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function newIdempotencyKey(): string {
  return `dg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Downloads a PDF and hands it to the browser as a file. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const key = heldKey();
  const response = await fetch(path, {
    headers: key === null ? {} : { authorization: `Bearer ${key}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new ApiFailure(response.status, text === '' ? null : (JSON.parse(text) as ApiErrorDto));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
