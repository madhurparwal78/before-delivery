export interface ApiFailure {
  error: string;
  message: string;
}

export class ApiCallError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, failure: ApiFailure) {
    super(failure.message);
    this.status = status;
    this.code = failure.error;
    this.name = 'ApiCallError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text === '' ? null : (JSON.parse(text) as unknown);
  if (!response.ok) {
    const failure = (payload ?? { error: 'not_found', message: 'Not found' }) as ApiFailure;
    throw new ApiCallError(response.status, failure);
  }
  return payload as T;
}

export async function getJson<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path, { headers: { accept: 'application/json' } }));
}

export async function sendJson<T>(method: string, path: string, body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function sendFile<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.set('file', file);
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return parse<T>(await fetch(path, { method: 'POST', body: form }));
}
