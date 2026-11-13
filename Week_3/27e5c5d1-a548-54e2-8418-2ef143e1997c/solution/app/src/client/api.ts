import type { StaleReply } from '../shared/types.ts';

/** What the server's error bodies can carry: the code, field messages, and a stale write's card, author and change. */
type ErrorBody = Record<string, unknown> & Partial<Omit<StaleReply, 'error'>>;

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(`request failed with ${status}`);
  }

  /** The server's answer to a write made against an old version of a card. */
  get stale(): StaleReply | null {
    const { card, changedBy, change } = this.body;
    return this.status === 409 && this.body['error'] === 'stale' && card && changedBy && change ? { error: 'stale', card, changedBy, change } : null;
  }

  get fields(): Record<string, string> {
    const fields: unknown = this.body['fields'];
    return typeof fields === 'object' && fields !== null ? Object.fromEntries(Object.entries(fields).map(([key, message]) => [key, String(message)])) : {};
  }
}

let onSignedOut: () => void = () => undefined;

/** The one handler for a 401 from anywhere: the store decides where the person goes. */
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler;
}

interface Request {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Sign-in answers 401 itself; every other 401 means the session ended. */
  quiet401?: boolean;
}

export async function call<T>(path: string, request: Request = {}): Promise<T> {
  const headers: Record<string, string> = { ...request.headers };
  let body: BodyInit | undefined;
  if (request.form) body = request.form;
  else if (request.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.body);
  }
  const init: RequestInit = { method: request.method ?? 'GET', headers, credentials: 'same-origin', cache: 'no-store' };
  if (body !== undefined) init.body = body;
  if (request.signal) init.signal = request.signal;
  const response = await fetch(path, init);
  const text = response.status === 204 ? '' : await response.text();
  const parsed = readJson(text);
  if (response.status === 401 && !request.quiet401) onSignedOut();
  if (!response.ok) throw new ApiFailure(response.status, parsed);
  return parsed;
}

/** The JSON of a response body; a body that is not JSON reads as an empty object. */
function readJson(text: string) {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}
