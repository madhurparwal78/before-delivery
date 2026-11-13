export interface ErrorBody {
  error: string;
  errors?: Record<string, string>;
  holder?: { userId: string; displayName: string };
  label?: string;
  deletedBy?: { userId: string; displayName: string };
  current?: unknown;
  retryAfterSeconds?: number;
  state?: string;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.error);
  }
}

/** A request that got no answer at all: the editor is offline. */
export class NoAnswer extends Error {}

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  raw?: Blob | ArrayBuffer | FormData;
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw as BodyInit;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new NoAnswer('no answer');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text.length > 0 ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) throw new ApiFailure(response.status, parsed as ErrorBody);
  return parsed as T;
}

export function failureOf(error: unknown): ApiFailure | null {
  return error instanceof ApiFailure ? error : null;
}

export function firstFieldMessage(error: unknown): string | null {
  const failure = failureOf(error);
  if (!failure || failure.body.errors === undefined) return null;
  const values = Object.values(failure.body.errors);
  return values.length > 0 ? values[0] : null;
}
