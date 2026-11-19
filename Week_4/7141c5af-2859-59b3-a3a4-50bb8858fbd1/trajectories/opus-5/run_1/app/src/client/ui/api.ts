/** Talking to the published API, and what an ended session does. */
import { F } from '../../shared/feedback.ts';
import { announce, showSessionEnded } from './shell.ts';

export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  retryAfter: number | null;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;
  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiError';
    this.failure = failure;
  }
}

let sessionEnded = false;

/** True once a request has read `sessionEnded`, so the screen stops writing. */
export function isSessionEnded(): boolean {
  return sessionEnded;
}

async function request(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<unknown> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined = raw;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: 'same-origin',
  });

  if (response.status === 204) return null;

  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  const parsed: unknown = contentType.includes('json') && text ? JSON.parse(text) : text;

  if (response.ok) return parsed;

  const shape = parsed as { error?: { code?: string; message?: string; fields?: Record<string, string> } };
  const failure: ApiFailure = {
    status: response.status,
    code: shape.error?.code ?? 'unknown',
    message: shape.error?.message ?? 'Something went wrong on the desk.',
    fields: shape.error?.fields ?? {},
    retryAfter: response.headers.get('retry-after') === null ? null : Number(response.headers.get('retry-after')),
  };

  if (failure.status === 401 && failure.code === 'sessionEnded') {
    sessionEnded = true;
    announce(F.sessionEnded);
    showSessionEnded(window.location.pathname + window.location.search);
  }
  if (failure.status === 401 && failure.code === 'notSignedIn') {
    window.location.assign(
      `/sign-in?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`,
    );
  }
  throw new ApiError(failure);
}

export const api = {
  get: (path: string): Promise<unknown> => request('GET', path),
  post: (path: string, body: unknown = {}): Promise<unknown> => request('POST', path, body),
  patch: (path: string, body: unknown): Promise<unknown> => request('PATCH', path, body),
  put: (path: string, body: unknown): Promise<unknown> => request('PUT', path, body),
  remove: (path: string): Promise<unknown> => request('DELETE', path),
  upload: (path: string, form: FormData): Promise<unknown> => request('POST', path, undefined, form),
};

/** The field errors of a refusal, in the order the server listed them. */
export function fieldProblems(error: unknown): { field: string; message: string }[] {
  if (!(error instanceof ApiError)) return [];
  return Object.entries(error.failure.fields).map(([field, message]) => ({ field, message }));
}

export function failureMessage(error: unknown): string {
  return error instanceof ApiError ? error.failure.message : F.refreshFailed;
}
