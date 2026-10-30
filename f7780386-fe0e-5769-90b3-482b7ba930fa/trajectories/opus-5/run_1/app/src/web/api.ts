export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly missing: string[];

  constructor(status: number, code: string, fields: Record<string, string>, missing: string[]) {
    super(code);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.missing = missing;
  }
}

/** Raised when the browser could not reach the server at all. */
export class NetworkError extends Error {
  constructor() {
    super('unreachable');
    this.name = 'NetworkError';
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
}

async function toError(response: Response): Promise<ApiError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const code = typeof payload['error'] === 'string' ? payload['error'] : 'request_failed';
  const errors = payload['errors'];
  const fields: Record<string, string> = {};
  if (errors !== null && typeof errors === 'object') {
    for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
      if (typeof value === 'string') fields[key] = value;
    }
  }
  const missing = Array.isArray(payload['missing'])
    ? (payload['missing'] as unknown[]).filter((item): item is string => typeof item === 'string')
    : [];
  return new ApiError(response.status, code, fields, missing);
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (options.form !== undefined) {
    init.body = options.form;
  } else if (options.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new NetworkError();
  }

  if (response.status === 204) return undefined as T;
  if (!response.ok) throw await toError(response);
  const text = await response.text();
  return (text === '' ? undefined : JSON.parse(text)) as T;
}
