const SEAT_KEY = 'fairline.seat';

export interface ApiFailure {
  error: string;
  message: string;
  errors?: Record<string, string>;
  heldBy?: { id: string; name: string; role: string };
  staffIds?: string[];
  retryAfterSeconds?: number;
  status?: string;
}

export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
    readonly retryAfterSeconds: number | null,
  ) {
    super(failure.message);
    this.name = 'RequestFailed';
  }
}

export function seatToken(): string | null {
  return sessionStorage.getItem(SEAT_KEY);
}

export function rememberSeatToken(token: string): void {
  sessionStorage.setItem(SEAT_KEY, token);
}

export function forgetSeatToken(): void {
  sessionStorage.removeItem(SEAT_KEY);
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  rawBody?: ArrayBuffer;
  expect?: 'json' | 'blob' | 'none';
}

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = seatToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    headers['content-type'] = 'application/octet-stream';
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(path, { method: options.method ?? 'GET', headers, body });
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (!response.ok) {
    const retry = response.headers.get('retry-after');
    const failure = (await response.json().catch(() => ({
      error: 'unavailable',
      message: 'The score service did not answer.',
    }))) as ApiFailure;
    throw new RequestFailed(response.status, failure, retry === null ? null : Number(retry));
  }
  if (options.expect === 'none') return undefined as T;
  if (options.expect === 'blob') return (await response.blob()) as T;
  return (await response.json()) as T;
}
