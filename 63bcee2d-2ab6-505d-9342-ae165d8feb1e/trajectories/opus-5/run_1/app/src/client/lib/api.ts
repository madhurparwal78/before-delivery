/** The one place the browser talks to the API and reads the one error shape. */

export interface ApiFailure {
  status: number;
  code: string;
  errors?: Record<string, string>;
  extras: Record<string, unknown>;
  network: boolean;
}

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(`${failure.status} ${failure.code}`);
    this.failure = failure;
  }

  get code(): string {
    return this.failure.code;
  }

  get status(): number {
    return this.failure.status;
  }

  get errors(): Record<string, string> {
    return this.failure.errors ?? {};
  }

  extra<T>(name: string): T | undefined {
    return this.failure.extras[name] as T | undefined;
  }
}

const networkFailure = (): ApiError =>
  new ApiError({ status: 0, code: 'network', extras: {}, network: true });

async function readFailure(response: Response): Promise<ApiError> {
  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const { error, errors, ...extras } = body;
  return new ApiError({
    status: response.status,
    code: typeof error === 'string' ? error : 'unknown',
    errors: (errors as Record<string, string> | undefined) ?? undefined,
    extras,
    network: false,
  });
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  csv?: string;
  idempotencyKey?: string;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (options.form) {
    payload = options.form;
  } else if (options.csv !== undefined) {
    headers['Content-Type'] = 'text/csv; charset=utf-8';
    payload = options.csv;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
    payload = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (payload ? 'POST' : 'GET'),
      headers,
      body: payload,
      credentials: 'same-origin',
    });
  } catch {
    throw networkFailure();
  }
  if (!response.ok) throw await readFailure(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function requestBlob(path: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw networkFailure();
  }
  if (!response.ok) throw await readFailure(response);
  return response.blob();
}

/** A fresh retry key, so a replayed request returns the original record. */
export function newRetryKey(): string {
  return `k-${crypto.randomUUID()}`;
}
