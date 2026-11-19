export type Fields = Record<string, string>;

export class RequestError extends Error {
  status: number;
  code: string;
  fields: Fields;
  requestId: string | null;
  retryAfter: number | null;
  currentVersion: number | null;
  httpStatus: number | null;

  constructor(
    status: number,
    code: string,
    options: {
      fields?: Fields;
      requestId?: string | null;
      retryAfter?: number | null;
      currentVersion?: number | null;
      httpStatus?: number | null;
    } = {},
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.fields = options.fields ?? {};
    this.requestId = options.requestId ?? null;
    this.retryAfter = options.retryAfter ?? null;
    this.currentVersion = options.currentVersion ?? null;
    this.httpStatus = options.httpStatus ?? null;
  }

  get outcomeUnknown(): boolean {
    return this.status === 0 || this.status >= 500 || this.code === "idempotency_key_in_flight";
  }
}

const TOKEN_KEY = "wayline.token";
let unauthenticatedHandler: (() => void) | null = null;

export function readToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function writeToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token === null) window.localStorage.removeItem(TOKEN_KEY);
  else window.localStorage.setItem(TOKEN_KEY, token);
}

export function onUnauthenticated(handler: () => void): void {
  unauthenticatedHandler = handler;
}

export interface Options {
  body?: unknown;
  idempotencyKey?: string | null;
  ifMatch?: string | null;
  anonymous?: boolean;
  onHeaders?: (headers: Headers) => void;
}

export async function api<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const token = options.anonymous ? null : readToken();
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;
  if (options.ifMatch) headers["If-Match"] = options.ifMatch;
  let answer: Response;
  try {
    answer = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new RequestError(0, "no_answer");
  }
  options.onHeaders?.(answer.headers);
  const requestId = answer.headers.get("X-Request-Id");
  if (answer.status === 204) return undefined as T;
  let payload: Record<string, unknown> = {};
  const text = await answer.text();
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!answer.ok) {
    if (answer.status === 401 && token) unauthenticatedHandler?.();
    const retryAfter = answer.headers.get("Retry-After");
    throw new RequestError(answer.status, (payload.error as string) ?? "no_answer", {
      fields: (payload.fields as Fields) ?? {},
      requestId,
      retryAfter: retryAfter ? Number(retryAfter) : null,
      currentVersion: (payload.current_version as number) ?? null,
      httpStatus: (payload.http_status as number) ?? null,
    });
  }
  return payload as T;
}
