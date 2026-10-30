export interface ApiFailure {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiCallError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.message);
    this.name = 'ApiCallError';
    this.failure = failure;
  }
}

function networkFailure(): ApiFailure {
  return { status: 0, code: 'network', message: 'No response.', details: {} };
}

async function failureFrom(response: Response): Promise<ApiFailure> {
  try {
    const body = (await response.json()) as { error?: Partial<ApiFailure> };
    const error = body.error;
    if (error && typeof error.code === 'string') {
      return {
        status: response.status,
        code: error.code,
        message: typeof error.message === 'string' ? error.message : 'Request failed.',
        details: (error.details as Record<string, unknown>) ?? {},
      };
    }
  } catch {
    /* fall through to a shapeless failure */
  }
  return { status: response.status, code: 'unknown', message: 'Request failed.', details: {} };
}

let skewMs = 0;

/** How far the browser clock runs ahead of the server clock, from the last response. */
export function serverSkewMs(): number {
  return skewMs;
}

async function run(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiCallError(networkFailure());
  }
  const serverDate = response.headers.get('date');
  if (serverDate) {
    const parsed = Date.parse(serverDate);
    if (!Number.isNaN(parsed)) skewMs = Date.now() - parsed;
  }
  if (!response.ok) throw new ApiCallError(await failureFrom(response));
  return response;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await run(path, { method: 'GET' });
  return (await response.json()) as T;
}

export interface SendOptions {
  idempotencyKey?: string;
}

export async function apiSend<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  options: SendOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  const response = await run(path, { method, headers, body: JSON.stringify(body ?? {}) });
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const response = await run(path, { method: 'POST', body: form });
  return (await response.json()) as T;
}

export async function apiDownload(path: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await run(path, { method: 'GET' });
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), fileName: match ? match[1]! : 'download' };
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
