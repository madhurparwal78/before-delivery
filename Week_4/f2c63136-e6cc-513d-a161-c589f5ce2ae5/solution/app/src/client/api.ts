import { announcement } from './store.ts';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: { error?: string; errors?: Record<string, string>; current_head?: string }) {
    super(body.error ?? 'Request failed');
  }
  get fields(): Record<string, string> {
    return this.body.errors ?? {};
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await response.json() : await response.text();
  if (!response.ok) throw new ApiError(response.status, typeof data === 'object' ? data : {});
  return data as T;
}

/** Shows a refusal or outage (not a field error) in the announcement strip; true when it did. */
export function refuse(error: unknown): boolean {
  if (error instanceof ApiError && error.body.error) {
    announcement.set({ message: error.body.error });
    return true;
  }
  return false;
}

/** The live update stream of a repository: a WebSocket, so the page still reaches network idle while it is open. */
export function openLive(org: string, repo: string): WebSocket {
  return new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live/${org}/${repo}`);
}
