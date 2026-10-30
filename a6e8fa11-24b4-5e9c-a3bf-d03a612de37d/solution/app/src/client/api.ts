// The browser's API client: JSON over same-origin fetch, errors in the API's one shape.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly limit: number | null = null,
  ) {
    super(message);
  }
}

/** Thrown when the request never reached the server (offline, connection dropped). */
export class NetworkFailure extends Error {}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string>; limit?: number };
}

async function failure(res: Response): Promise<ApiFailure> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    body = {};
  }
  const e = body.error ?? {};
  return new ApiFailure(res.status, e.code ?? "unknown", e.message ?? res.statusText, e.fields ?? {}, e.limit ?? null);
}

export async function request<T>(method: string, path: string, options: { body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: options.raw !== undefined ? options.headers : { "Content-Type": "application/json", ...options.headers },
      body: options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
  } catch {
    throw new NetworkFailure("The request did not reach the server.");
  }
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, { body: body ?? {}, headers }),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, { body }),
  del: <T>(path: string) => request<T>("DELETE", path),
};

/** A random UUID, also where `crypto.randomUUID` is unavailable (plain-http hosts other than localhost). */
export function uuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
