import { SHARED_COPY, validationAnnouncement } from '../domain/copy.ts';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  savedBy?: string;
  savedAt?: string;
  current?: unknown;
  retryAfterSeconds?: number;
  claimedAt?: string;
}

export class RequestFailed extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'RequestFailed';
    this.failure = failure;
  }
}

let serverOffsetMs = 0;

/** The server's clock, taken from the Date header of each API answer. */
export function serverNow(): number {
  return Date.now() + serverOffsetMs;
}

function recordServerClock(response: Response): void {
  const header = response.headers.get('date');
  if (header === null) return;
  const stamp = Date.parse(header);
  if (!Number.isNaN(stamp)) serverOffsetMs = stamp - Date.now();
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  headers?: Record<string, string>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json', ...(options.headers ?? {}) };
  let body: BodyInit | undefined;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new RequestFailed({
      status: 0,
      code: 'unreachable',
      message: SHARED_COPY.unreachable,
      fields: {},
    });
  }
  recordServerClock(response);

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload: unknown = text === '' ? null : safeParse(text);

  if (response.ok) return payload as T;

  const record = (payload ?? {}) as Record<string, unknown>;
  const error = (record['error'] ?? {}) as Record<string, unknown>;
  const fields = (record['fields'] ?? {}) as Record<string, string>;
  const count = Object.keys(fields).length;
  const message =
    response.status === 422 && count > 0
      ? validationAnnouncement(count)
      : typeof error['message'] === 'string'
        ? (error['message'] as string)
        : SHARED_COPY.unreachable;

  throw new RequestFailed({
    status: response.status,
    code: typeof error['code'] === 'string' ? (error['code'] as string) : 'server_error',
    message: response.status >= 500 && response.status !== 503 ? SHARED_COPY.unreachable : message,
    fields,
    savedBy: typeof record['savedBy'] === 'string' ? (record['savedBy'] as string) : undefined,
    savedAt: typeof record['savedAt'] === 'string' ? (record['savedAt'] as string) : undefined,
    current: record['current'],
    retryAfterSeconds:
      typeof record['retryAfterSeconds'] === 'number' ? (record['retryAfterSeconds'] as number) : undefined,
    claimedAt: typeof record['claimedAt'] === 'string' ? (record['claimedAt'] as string) : undefined,
  });
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
