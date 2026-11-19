import type { ApiErrorShape } from '../../shared/api.js';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly detail: ApiErrorShape['error'];

  constructor(status: number, body: ApiErrorShape | null) {
    const error = body?.error;
    super(error?.message ?? 'Something went wrong.');
    this.name = 'ApiFailure';
    this.status = status;
    this.code = error?.code ?? 'internal_error';
    this.fields = error?.fields ?? {};
    this.detail = error ?? { code: this.code, message: this.message };
  }
}

export interface RequestOptions {
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly ifMatch?: number;
  readonly signal?: AbortSignal;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  if (options.ifMatch !== undefined) headers['if-match'] = `"${options.ifMatch}"`;

  const response = await fetch(path, {
    method,
    headers,
    body,
    credentials: 'same-origin',
    signal: options.signal ?? null,
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new ApiFailure(response.status, parsed as ApiErrorShape | null);
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('GET', path, options),
  post: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('POST', path, options),
  put: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>('PUT', path, options),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>('DELETE', path, options),
};

export async function uploadAsset(
  slug: string,
  kind: 'font' | 'model' | 'audio',
  file: File,
): Promise<unknown> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file, file.name);
  const response = await fetch(`/api/pieces/${slug}/assets`, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  });
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorShape | null);
  return parsed;
}

/**
 * The browser key rule: a key is reused only to retry a request that got a 5xx
 * answer or no answer at all. Every other press sends a new key.
 */
export function createKeyHolder(): {
  next(): string;
  reuseAfterFailure(status: number | null): void;
} {
  let current = crypto.randomUUID();
  return {
    next: () => current,
    reuseAfterFailure: (status) => {
      const retryable = status === null || status >= 500;
      if (!retryable) current = crypto.randomUUID();
    },
  };
}
