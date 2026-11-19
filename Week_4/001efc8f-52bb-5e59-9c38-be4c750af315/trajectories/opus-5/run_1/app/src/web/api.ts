import type { ApiErrorBody } from '../shared/api';

export class ApiFailure extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.status = status;
    this.code = body.error;
    this.body = body;
  }
}

/** The server's clock, estimated from the Date header of the latest response. */
let serverAnchorMs = Date.now();
let browserAnchorMs = performance.now();

function noteServerDate(header: string | null): void {
  if (header === null) return;
  const parsed = Date.parse(header);
  if (Number.isNaN(parsed)) return;
  serverAnchorMs = parsed;
  browserAnchorMs = performance.now();
}

export function serverNow(): number {
  return serverAnchorMs + (performance.now() - browserAnchorMs);
}

async function toResult<T>(response: Response): Promise<T> {
  noteServerDate(response.headers.get('date'));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length === 0 ? {} : (JSON.parse(text) as unknown);
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin' });
  return toResult<T>(response);
}

export async function apiSend<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return toResult<T>(response);
}

/** A multipart send that reports its real upload progress. */
export function apiUpload<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.withCredentials = true;
    request.timeout = timeoutMs;
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total);
    });
    request.addEventListener('load', () => {
      noteServerDate(request.getResponseHeader('date'));
      const text = request.responseText;
      const parsed = text.length === 0 ? {} : (JSON.parse(text) as unknown);
      if (request.status >= 200 && request.status < 300) {
        onProgress(1);
        resolve(parsed as T);
        return;
      }
      reject(new ApiFailure(request.status, parsed as ApiErrorBody));
    });
    request.addEventListener('error', () => reject(new Error('network')));
    request.addEventListener('timeout', () => reject(new Error('timeout')));
    request.send(form);
  });
}

export async function apiSendWithTimeout<T>(
  method: string,
  path: string,
  body: unknown,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return await toResult<T>(response);
  } finally {
    window.clearTimeout(timer);
  }
}
