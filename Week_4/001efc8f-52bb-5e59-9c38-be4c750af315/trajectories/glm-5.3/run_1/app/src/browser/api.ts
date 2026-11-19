import type { ApiErrorBody } from './types';

export class ApiFailure extends Error {
  body: ApiErrorBody;
  status: number;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

interface LastResponse {
  date: string;
  receivedAt: number;
}

let lastResponse: LastResponse | null = null;

function noteResponse(res: Response): void {
  const date = res.headers.get('Date');
  if (date) lastResponse = { date, receivedAt: performance.now() };
}

/** The client's estimate of the server's clock: last Date header plus elapsed browser time. */
export function serverNow(): Date {
  if (!lastResponse) return new Date();
  const base = Date.parse(lastResponse.date);
  return new Date(base + (performance.now() - lastResponse.receivedAt));
}

export async function api<T>(path: string, init?: RequestInit): Promise<{ data: T; headers: Headers }> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  noteResponse(res);
  if (res.status === 204) return { data: null as T, headers: res.headers };
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    throw new ApiFailure(res.status, (parsed as ApiErrorBody) ?? { error: 'internal_error', message: 'Something went wrong on our side. Try again.' });
  }
  return { data: parsed as T, headers: res.headers };
}

export async function apiJson<T>(path: string, method: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
  return api<T>(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export class NetworkError extends Error {}
