// Same-origin JSON calls. A request that gets no HTTP response rejects with NoResponse.

export class NoResponse extends Error {}

interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

interface ApiError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

interface Options {
  body?: unknown;
  raw?: Blob | File;
  contentType?: string;
  key?: string;
  ifMatch?: string;
}

let session = 0;

/** Sign-out ends the session: the answer to any request sent before it is never delivered. */
export function endSession(): void {
  session += 1;
}

export async function api<T = any>(method: string, path: string, options: Options = {}): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw !== undefined) {
    body = options.raw;
    headers["Content-Type"] = options.contentType ?? "application/octet-stream";
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  if (options.key) headers["Idempotency-Key"] = options.key;
  if (options.ifMatch) headers["If-Match"] = options.ifMatch;
  const sentIn = session;
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new NoResponse();
  }
  const text = await response.text().catch(() => "");
  if (sentIn !== session) await new Promise<never>(() => undefined);
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, body: parsed as T, headers: response.headers };
}

export function errorCode(r: ApiResponse): string {
  return (r.body as ApiError | null)?.error?.code ?? "";
}

export function errorFields(r: ApiResponse): Record<string, string> {
  return (r.body as ApiError | null)?.error?.fields ?? {};
}

/** A fresh idempotency key for one attempt of an action. */
export function newKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `k-${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}
