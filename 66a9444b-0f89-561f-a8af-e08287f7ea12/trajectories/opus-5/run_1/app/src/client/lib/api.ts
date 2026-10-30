export interface ApiFailure {
  status: number;
  code: string | null;
  fields: Record<string, string>;
  extra: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly failure: ApiFailure) {
    super(failure.code ?? 'request_failed');
  }
}

async function parse(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) return response.json();
  return null;
}

function toFailure(status: number, body: unknown): ApiFailure {
  const record = (body ?? {}) as Record<string, unknown>;
  const fields =
    typeof record['errors'] === 'object' && record['errors'] !== null
      ? (record['errors'] as Record<string, string>)
      : {};
  const { error, errors, ...extra } = record;
  void errors;
  return {
    status,
    code: typeof error === 'string' ? error : null,
    fields,
    extra,
  };
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  let payload: BodyInit | undefined;
  if (options.body instanceof FormData) {
    payload = options.body;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(toFailure(response.status, await parse(response)));
  if (response.status === 204) return undefined as T;
  return (await parse(response)) as T;
}

export function newIdempotencyKey(): string {
  return `kf-${crypto.randomUUID().replace(/-/g, '')}`;
}
