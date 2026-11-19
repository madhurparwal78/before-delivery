export interface ApiFieldErrors {
  readonly [field: string]: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly fields: ApiFieldErrors | null,
    readonly limit: number | null,
    readonly used: number | null,
    readonly plan: string | null,
    readonly retryAfter: number | null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Raised when the request did not reach the server, so the copy can say "you're offline". */
export class OfflineError extends Error {
  constructor() {
    super("you're offline");
    this.name = 'OfflineError';
  }
}

interface ErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: ApiFieldErrors;
    limit?: number;
    used?: number;
    plan?: string;
  };
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: signal ?? null,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new OfflineError();
  }
  return readResponse<T>(response);
}

export async function apiUpload<T>(path: string, file: File): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
      credentials: 'same-origin',
    });
  } catch {
    throw new OfflineError();
  }
  return readResponse<T>(response);
}

async function readResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload: unknown = text === '' ? null : safeParse(text);
  if (response.ok) return payload as T;
  const error = (payload as ErrorPayload | null)?.error;
  const retryAfterHeader = response.headers.get('Retry-After');
  throw new ApiError(
    error?.code ?? 'unknown',
    error?.message ?? 'Something went wrong',
    response.status,
    error?.fields ?? null,
    error?.limit ?? null,
    error?.used ?? null,
    error?.plan ?? null,
    retryAfterHeader === null ? null : Number.parseInt(retryAfterHeader, 10),
  );
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `<reason>` is "you're offline" when the request did not reach the server. */
export function reasonOf(error: unknown): string {
  if (error instanceof OfflineError) return "you're offline";
  if (error instanceof ApiError) return error.message;
  return 'something went wrong';
}

let operationCounter = 0;

/** A client operation id of 8 to 64 letters, digits, - or _. */
export function newOperationId(): string {
  operationCounter += 1;
  const random = Math.random().toString(36).slice(2, 10);
  return `op-${Date.now().toString(36)}-${operationCounter.toString(36)}-${random}`.slice(0, 64);
}
