export interface ApiFailure {
  code: string;
  message: string;
  fields: Record<string, string>;
  status: number;
}

export class RequestFailed extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

export interface Envelope<T> {
  status: number;
  body: T;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  const text = await response.text();
  const payload: unknown = text === '' ? null : JSON.parse(text);
  if (!response.ok) {
    const envelope = payload as {
      error?: { code: string; message: string; fields: Record<string, string> };
    };
    const error = envelope?.error;
    throw new RequestFailed({
      code: error?.code ?? 'NOT_FOUND',
      message: error?.message ?? 'Harbour record not found.',
      fields: error?.fields ?? {},
      status: response.status,
    });
  }
  return { status: response.status, body: payload as T };
}

export const api = {
  get: async <T>(path: string): Promise<T> => (await send<T>('GET', path)).body,
  post: async <T>(path: string, body: unknown): Promise<T> => (await send<T>('POST', path, body)).body,
  put: async <T>(path: string, body: unknown): Promise<T> => (await send<T>('PUT', path, body)).body,
  remove: async (path: string): Promise<void> => {
    await send<null>('DELETE', path);
  },
  postEnvelope: <T>(path: string, body: unknown): Promise<Envelope<T>> => send<T>('POST', path, body),
};

export function query(params: Record<string, string | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) search.set(key, value);
  }
  const text = search.toString();
  return text === '' ? '' : `?${text}`;
}
