export class ApiCallError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, message: string, fields: Record<string, string>, body: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.body = body;
  }

  get networkOrServer(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

type Hooks = {
  onUnauthenticated: () => void;
  onServiceTrouble: () => void;
};

const hooks: Hooks = { onUnauthenticated: () => undefined, onServiceTrouble: () => undefined };

export function setApiHooks(next: Partial<Hooks>): void {
  Object.assign(hooks, next);
}

export type Request = {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
};

export async function api<T>(method: string, path: string, request: Request = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';
  if (request.idempotencyKey !== undefined) headers['Idempotency-Key'] = request.idempotencyKey;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal ?? null,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiCallError(0, 'network', 'The request did not reach Tallyroom.', {}, {});
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (response.ok) return parsed as T;
  const body = (parsed ?? {}) as Record<string, unknown>;
  const error = (body.error ?? {}) as { code?: string; message?: string; fields?: Record<string, string> };
  const code = error.code ?? 'unknown';
  if (code === 'unauthenticated') hooks.onUnauthenticated();
  if (response.status === 503) hooks.onServiceTrouble();
  throw new ApiCallError(response.status, code, error.message ?? 'That did not work.', error.fields ?? {}, body);
}

export type UploadResult = { status: number; body: Record<string, unknown> };

/** Uploads a file, reporting progress so the upload region can follow it. */
export function upload(
  path: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file, file.name);
    const request = new XMLHttpRequest();
    request.open('POST', path, true);
    request.withCredentials = true;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      let body: Record<string, unknown> = {};
      try {
        body = request.responseText === '' ? {} : (JSON.parse(request.responseText) as Record<string, unknown>);
      } catch {
        body = {};
      }
      if (request.status === 401) hooks.onUnauthenticated();
      if (request.status === 503) hooks.onServiceTrouble();
      resolve({ status: request.status, body });
    });
    request.addEventListener('error', () => {
      hooks.onServiceTrouble();
      reject(new ApiCallError(0, 'network', 'The upload did not reach Tallyroom.', {}, {}));
    });
    request.send(form);
  });
}
