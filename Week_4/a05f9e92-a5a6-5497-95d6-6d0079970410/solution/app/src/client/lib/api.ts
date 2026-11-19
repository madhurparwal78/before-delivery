export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> | undefined,
    readonly extra: Record<string, unknown>,
  ) {
    super(message);
  }
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string; fields?: Record<string, string>; [extra: string]: unknown };
}

let onUnauthenticated: () => void = () => undefined;

export function whenUnauthenticated(handler: () => void): void {
  onUnauthenticated = handler;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["content-type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    const envelope: ErrorEnvelope = type.includes("json") ? ((await response.json()) as ErrorEnvelope) : {};
    const { code = "error", message = "Switchyard could not load this. Try again.", fields, ...extra } = envelope.error ?? {};
    if (response.status === 401 && path !== "/api/session") onUnauthenticated();
    throw new ApiFailure(response.status, code, message, fields, extra);
  }
  return (type.includes("json") ? await response.json() : await response.text()) as T;
}

export const get = <T>(path: string): Promise<T> => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> => api<T>("POST", path, body ?? {}, headers);
export const put = <T>(path: string, body?: unknown): Promise<T> => api<T>("PUT", path, body ?? {});
export const patch = <T>(path: string, body?: unknown): Promise<T> => api<T>("PATCH", path, body ?? {});
export const del = <T>(path: string): Promise<T> => api<T>("DELETE", path);

export function failureText(error: unknown): string {
  return error instanceof ApiFailure ? error.message : "Switchyard could not load this. Try again.";
}
