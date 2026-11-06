/** Thin fetch wrapper. A 401 on an action asks the page to sign in again; a poll never does. */

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: { error?: string; errors?: Record<string, string> }) {
    super(body.error ?? `status ${status}`);
  }
  get code(): string { return this.body.error ?? ''; }
  get fields(): Record<string, string> { return this.body.errors ?? {}; }
}

/** Thrown after the session ended during an action: the sign-in dialog handled it and nothing is re-sent. */
export class SessionEnded extends Error {}

type Asker = () => Promise<boolean>;
let askToSignIn: Asker = async () => false;
export function setSignInAsker(asker: Asker): void {
  askToSignIn = asker;
}

interface Options {
  key?: string;
  /** A background read: a 401 is returned as an error and never opens the dialog. */
  poll?: boolean;
  /** After signing in again, send the request once more (a plan save). */
  retryOnSession?: boolean;
}

async function send(method: string, path: string, body: unknown, key?: string): Promise<Response> {
  return fetch(path, {
    method,
    headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function api<T>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  let response = await send(method, path, body, options.key);
  if (response.status === 401 && !options.poll) {
    const signedIn = await askToSignIn();
    if (!signedIn || !options.retryOnSession) throw new SessionEnded();
    response = await send(method, path, body, options.key);
  }
  const answer = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, answer);
  return answer;
}

export const get = <T>(path: string, options?: Options): Promise<T> => api<T>('GET', path, undefined, options);
export const post = <T>(path: string, body?: unknown, options?: Options): Promise<T> => api<T>('POST', path, body ?? {}, options);
export const patch = <T>(path: string, body: unknown, options?: Options): Promise<T> => api<T>('PATCH', path, body, options);

export function newKey(): string {
  return crypto.randomUUID();
}
