import { track } from "./quiet";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; fields?: Record<string, string>; [key: string]: unknown },
  ) {
    super(body.error ?? `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await track(fetch(path, init));
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiFailure["body"]);
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>("POST", path, body, headers),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function failureCopy(error: unknown, fallback: string): string {
  if (error instanceof ApiFailure && error.body.fields) return Object.values(error.body.fields)[0] ?? fallback;
  return fallback;
}
