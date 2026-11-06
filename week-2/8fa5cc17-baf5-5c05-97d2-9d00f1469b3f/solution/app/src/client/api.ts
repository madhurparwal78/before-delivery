// Same-origin API calls with the session's CSRF token; a 401 anywhere signs the tab out.

export class NetworkError extends Error {}

export interface ApiResult<T> { status: number; data: T; headers: Headers }

let csrfToken = '';
let onSignedOut: () => void = () => undefined;
let rotations = 0;
/** bumped when a session rotation finishes; a 401 to a request sent before it is not a sign-out */
let generation = 0;

export function setCsrf(token: string): void {
  csrfToken = token;
}

/** Called when any workspace request answers 401 or the live channel reports `session.ended`. */
export function onUnauthenticated(handler: () => void): void {
  onSignedOut = handler;
}

export function signedOut(): void {
  if (rotations === 0) onSignedOut();
}

/**
 * Runs a request that rotates this tab's session (password change). Live events can reach the
 * tab before the answer that sets the new cookie, so a 401 meanwhile is not a sign-out.
 */
export async function rotatingSession<T>(work: () => Promise<T>): Promise<T> {
  rotations += 1;
  try {
    return await work();
  } finally {
    rotations -= 1;
    generation += 1;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface CallOptions { headers?: Record<string, string>; form?: FormData; signal?: AbortSignal }

export async function api<T>(method: string, path: string, body?: unknown, options: CallOptions = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  const sentIn = rotations > 0 ? -1 : generation;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (MUTATING.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  let response: Response;
  try {
    response = await fetch(path, {
      method, headers, credentials: 'same-origin', signal: options.signal,
      body: options.form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError('network');
  }
  const type = response.headers.get('content-type') ?? '';
  let data: unknown = null;
  try {
    data = type.includes('application/json') ? await response.json() : null;
  } catch {
    throw new NetworkError('network');
  }
  if (response.status === 401 && path !== '/api/auth/sign-in' && sentIn === generation) signedOut();
  return { status: response.status, data: data as T, headers: response.headers };
}

export const get = <T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> => api<T>('GET', path, undefined, { signal });

/** Field messages of a 422 answer, or an empty map. */
export function fieldErrors(result: ApiResult<unknown>): Record<string, string> {
  const data = result.data as { errors?: Record<string, string> } | null;
  return result.status === 422 && data?.errors ? data.errors : {};
}
