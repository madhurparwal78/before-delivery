import { errorCopy } from "../../shared/copy";
import type { ApiErrorBody } from "../../shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  get code(): string {
    return this.body.error;
  }

  get fields(): Record<string, string> {
    return this.body.errors ?? {};
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: BodyInit; type: string }): Promise<T> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (raw) {
    init.body = raw.data;
    init.headers = { "content-type": raw.type };
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new ApiError(response.status, (parsed as ApiErrorBody | undefined) ?? { error: "internal", message: errorCopy("internal") });
  }
  return parsed as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>("GET", path),
  post: <T>(path: string, body?: unknown): Promise<T> => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown): Promise<T> => request<T>("PUT", path, body),
  del: <T>(path: string): Promise<T> => request<T>("DELETE", path),
  putRaw: <T>(path: string, data: BodyInit, type: string): Promise<T> => request<T>("PUT", path, undefined, { data, type }),
  postRaw: <T>(path: string, data: BodyInit, type: string): Promise<T> => request<T>("POST", path, undefined, { data, type }),
};

/** A client-made unique id of 32 hex digits; getRandomValues works outside secure contexts too. */
export function newOpId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
