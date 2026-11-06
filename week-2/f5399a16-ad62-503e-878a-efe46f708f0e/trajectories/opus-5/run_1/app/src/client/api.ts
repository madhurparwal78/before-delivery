export type ApiFailure = {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
  retryAfter: number | null;
};

export class ApiRefusal extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.message);
  }
}

export type Sent = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  form?: FormData;
};

export async function api<T = unknown>(path: string, sent: Sent = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (sent.form !== undefined) {
    body = sent.form;
  } else if (sent.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(sent.body);
  }
  const response = await fetch(path, {
    method: sent.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  if (!response.ok) {
    const error = (parsed['error'] ?? {}) as Record<string, unknown>;
    const retryAfter = response.headers.get('retry-after');
    throw new ApiRefusal({
      status: response.status,
      code: String(error['code'] ?? 'serverError'),
      message: String(error['message'] ?? 'Something went wrong on the desk.'),
      fields: (error['fields'] as Record<string, string>) ?? {},
      retryAfter: retryAfter === null ? null : Number(retryAfter),
    });
  }
  return parsed as T;
}

export function isRefusal(error: unknown): error is ApiRefusal {
  return error instanceof ApiRefusal;
}
