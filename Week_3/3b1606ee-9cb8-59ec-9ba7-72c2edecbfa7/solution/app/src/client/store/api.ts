export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** The request never reached the exchange (offline, refused, reset). */
export class NetworkFailure extends Error {}

/** The store sets these once at start: what to do when the session is revoked and when storage goes up or down. */
export const hooks = {
  onUnauthenticated: (): void => undefined,
  onStorage: (_available: boolean): void => undefined,
};

async function send(method: string, path: string, init: { body?: BodyInit; json?: unknown }): Promise<Response> {
  const headers: Record<string, string> = {};
  let body = init.body;
  if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  } else if (body) {
    headers['Content-Type'] = 'application/octet-stream';
  }
  try {
    return await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new NetworkFailure();
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.error === 'string' ? body.error : 'error';
  if (response.status === 401 && code === 'unauthenticated') hooks.onUnauthenticated();
  if (response.status === 503 && code === 'storage_unavailable') hooks.onStorage(false);
  return new ApiFailure(response.status, code, body);
}

export async function api<T>(method: string, path: string, json?: unknown): Promise<T> {
  const response = await send(method, path, { json });
  if (!response.ok) throw await failure(response);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function uploadBlob(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  const response = await send('PUT', `/api/blobs/${id}/content`, { body: bytes });
  if (!response.ok) throw await failure(response);
  hooks.onStorage(true);
}

export async function downloadBlob(id: string): Promise<ArrayBuffer> {
  const response = await send('GET', `/api/blobs/${id}`, {});
  if (!response.ok) throw await failure(response);
  hooks.onStorage(true);
  return response.arrayBuffer();
}
