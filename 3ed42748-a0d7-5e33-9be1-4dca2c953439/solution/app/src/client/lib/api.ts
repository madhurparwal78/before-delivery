// Talking to the depot: one fetch wrapper that keeps the server clock offset from every
// response's Date header, and the "retry the identical request" helper for shaky connections.

export interface Answer<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

/** Thrown when no HTTP answer arrived at all. */
export class NetworkFailure extends Error {}

let serverOffsetMs = 0;

/** Now, by the server's clock, judged from the latest response's Date header. */
export const serverNow = (): number => Date.now() + serverOffsetMs;

interface Call {
  method: string;
  path: string;
  body?: unknown;
  raw?: Blob;
  headers?: Record<string, string>;
}

export async function send<T = unknown>(call: Call): Promise<Answer<T>> {
  const headers: Record<string, string> = { ...call.headers };
  let body: BodyInit | undefined;
  if (call.raw) {
    body = call.raw;
    headers["Content-Type"] = "image/png";
  } else if (call.body !== undefined) {
    body = JSON.stringify(call.body);
    headers["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(call.path, { method: call.method, headers, body, credentials: "same-origin" });
  } catch {
    throw new NetworkFailure("no answer");
  }
  const date = response.headers.get("Date");
  if (date) {
    const parsed = Date.parse(date);
    if (Number.isFinite(parsed)) serverOffsetMs = parsed + 500 - Date.now();
  }
  const text = await response.text().catch(() => "");
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  // The body is the server's published contract for this endpoint; callers name its type.
  return { status: response.status, data: data as T, headers: response.headers };
}

export const get = <T = unknown>(path: string): Promise<Answer<T>> => send<T>({ method: "GET", path });

export interface ErrorBody {
  error: { code: string; message: string; fields?: Record<string, string> };
}

export const errorCode = (a: Answer): string => (a.data as Partial<ErrorBody> | null)?.error?.code ?? "";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends the identical request again on a network failure, up to three retries about a second
 * apart. `onRetry` runs before each retry. Throws NetworkFailure after the last one fails.
 */
export async function sendRetrying<T = unknown>(call: Call, onRetry: () => void): Promise<Answer<T>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send<T>(call);
    } catch (error) {
      if (!(error instanceof NetworkFailure) || attempt === 3) throw error;
      onRetry();
      await wait(1000);
    }
  }
}

export function newTicket(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `t-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
