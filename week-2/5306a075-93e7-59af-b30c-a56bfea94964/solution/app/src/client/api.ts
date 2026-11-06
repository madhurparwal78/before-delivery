// The browser's only way to the API: same-origin JSON, the brief's error shape, a shared pending count.
import type { ApiErrorBody } from "../shared/api.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
    readonly body: ApiErrorBody["error"],
  ) {
    super(message);
  }
}

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();
let pending = 0;
let onSessionEnded: () => void = () => undefined;

export function onPendingChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

function track(delta: number): void {
  pending += delta;
  for (const listener of listeners) listener(pending);
}

export async function request<T>(method: string, path: string, options: { json?: unknown; form?: FormData; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.json);
  }
  track(1);
  try {
    const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
    if (response.status === 204) return undefined as T;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("application/json")) {
      if (!response.ok) throw new ApiFailure(response.status, "unexpected", "Something went wrong on our side. Nothing was saved.", {}, { code: "unexpected", message: "" });
      return (await response.blob()) as T;
    }
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = (data as ApiErrorBody).error;
      if (response.status === 401 && path !== "/api/session") onSessionEnded();
      throw new ApiFailure(response.status, error.code, error.message, error.fields ?? {}, error);
    }
    return data as T;
  } finally {
    track(-1);
  }
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, json?: unknown, headers?: Record<string, string>) => request<T>("POST", path, { json, headers }),
  patch: <T>(path: string, json: unknown) => request<T>("PATCH", path, { json }),
  delete: <T>(path: string) => request<T>("DELETE", path),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, { form }),
};

export const isFailure = (error: unknown, status?: number): error is ApiFailure =>
  error instanceof ApiFailure && (status === undefined || error.status === status);
