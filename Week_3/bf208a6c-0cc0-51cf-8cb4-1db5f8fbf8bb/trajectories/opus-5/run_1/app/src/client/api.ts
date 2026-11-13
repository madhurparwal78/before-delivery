export class RequestFailed extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(`request failed with ${status}`);
  }

  fieldError(field: string): string | null {
    const errors = this.body.errors;
    if (typeof errors !== 'object' || errors === null) return null;
    const value = (errors as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : null;
  }

  get code(): string | null {
    return typeof this.body.error === 'string' ? this.body.error : null;
  }
}

const parse = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (text === '') return {};
  return JSON.parse(text) as Record<string, unknown>;
};

const send = async (method: string, path: string, body?: unknown): Promise<Record<string, unknown>> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await parse(response);
  if (!response.ok) throw new RequestFailed(response.status, parsed);
  return parsed;
};

export const api = {
  get: <T>(path: string): Promise<T> => send('GET', path) as Promise<T>,
  post: <T>(path: string, body?: unknown): Promise<T> => send('POST', path, body) as Promise<T>,
  patch: <T>(path: string, body?: unknown): Promise<T> => send('PATCH', path, body) as Promise<T>,
  put: <T>(path: string, body?: unknown): Promise<T> => send('PUT', path, body) as Promise<T>,
  del: <T>(path: string): Promise<T> => send('DELETE', path) as Promise<T>,
  form: async <T>(path: string, form: FormData): Promise<T> => {
    const response = await fetch(path, { method: 'POST', credentials: 'same-origin', body: form });
    const parsed = await parse(response);
    if (!response.ok) throw new RequestFailed(response.status, parsed);
    return parsed as T;
  },
};
