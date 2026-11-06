import { ApiErrorBody } from '../../shared/api';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly text: string,
    readonly fields: Record<string, string> = {},
    readonly limit: number | null = null,
  ) {
    super(text);
  }

  field(name: string): string | undefined {
    return this.fields[name];
  }
}

export class NetworkFailure extends Error {}

export function requestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newUuid(): string {
  return crypto.randomUUID();
}

interface ApiOptions {
  method?: string;
  body?: unknown;
  key?: string;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
  if (options.key) headers['Idempotency-Key'] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure('the network is unavailable');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const body = parsed as ApiErrorBody;
    throw new ApiFailure(
      response.status,
      body.error?.code ?? 'server_error',
      body.error?.message ?? 'Something went wrong.',
      body.fields ?? {},
      body.limit ?? null,
    );
  }
  return parsed as T;
}

export async function apiMultipart<T>(path: string, form: FormData, key: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: form,
      credentials: 'same-origin',
    });
  } catch {
    throw new NetworkFailure('the network is unavailable');
  }
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const body = parsed as ApiErrorBody;
    throw new ApiFailure(
      response.status,
      body.error?.code ?? 'server_error',
      body.error?.message ?? 'Something went wrong.',
      body.fields ?? {},
      body.limit ?? null,
    );
  }
  return parsed as T;
}
