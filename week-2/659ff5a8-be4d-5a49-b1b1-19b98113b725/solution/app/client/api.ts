import type { ApiErrorBody } from "../shared/api.js";

export class ApiFailure extends Error {
  readonly fields: Record<string, string>;
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    fields: Record<string, string> | undefined,
  ) {
    super(message);
    this.fields = fields ?? {};
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json();
  if (!response.ok) {
    const failure = payload as ApiErrorBody;
    throw new ApiFailure(response.status, failure.error, failure.message, failure.fields);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}): Promise<T> => request<T>("POST", path, body),
  delete: (path: string): Promise<void> => request<void>("DELETE", path),
};

/** The CSV export is the one response that is not JSON. */
export async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(path, { credentials: "same-origin" });
  if (!response.ok) {
    const failure = (await response.json()) as ApiErrorBody;
    throw new ApiFailure(response.status, failure.error, failure.message, failure.fields);
  }
  return response.blob();
}
