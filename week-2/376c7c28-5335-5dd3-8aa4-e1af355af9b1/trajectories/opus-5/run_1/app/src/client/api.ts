export interface Failure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly errors: Record<string, string> | null;
}

export class RequestFailed extends Error {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(failure.message);
    this.failure = failure;
  }
}

type SessionEndedListener = () => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

export function onSessionEnded(listener: SessionEndedListener): void {
  sessionEndedListeners.add(listener);
}

export function announceSessionEnded(): void {
  for (const listener of sessionEndedListeners) listener();
}

interface CallOptions {
  readonly body?: unknown;
  readonly form?: FormData;
  readonly idempotencyKey?: string;
}

async function parseFailure(response: Response): Promise<Failure> {
  let code = 'server_error';
  let message = 'Something went wrong. Try again.';
  let errors: Record<string, string> | null = null;
  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body['error'] === 'string') code = body['error'];
    if (typeof body['message'] === 'string') message = body['message'];
    if (body['errors'] && typeof body['errors'] === 'object') {
      errors = body['errors'] as Record<string, string>;
    }
  } catch {
    /* a body the app cannot read keeps the generic copy */
  }
  return { status: response.status, code, message, errors };
}

export async function call<T>(
  method: string,
  path: string,
  options: CallOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (options.form) {
    payload = options.form;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new RequestFailed({
      status: 0,
      code: 'network',
      message: 'No connection. Check the studio wifi and try again.',
      errors: null,
    });
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const failure = await parseFailure(response);
    if (failure.code === 'unauthenticated') announceSessionEnded();
    throw new RequestFailed(failure);
  }
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await response.json()) as T;
  return undefined as T;
}

export const get = <T>(path: string): Promise<T> => call<T>('GET', path);
export const post = <T>(path: string, body?: unknown, idempotencyKey?: string): Promise<T> =>
  call<T>('POST', path, { body, idempotencyKey });
export const put = <T>(path: string, body?: unknown): Promise<T> => call<T>('PUT', path, { body });
export const del = <T>(path: string): Promise<T> => call<T>('DELETE', path);

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
