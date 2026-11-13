import type { ErrorCode } from "../../shared/copy.js";

/** The one fetch wrapper: JSON in, JSON out, every failure as an ApiFailure carrying the published error body. */

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | "network",
    message: string,
    readonly body: Record<string, unknown>,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

export interface ApiReply<T> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestInitJson {
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

export const request = async <T>(method: string, path: string, init: RequestInitJson = {}): Promise<ApiReply<T>> => {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  let response: Response;
  try {
    response = await fetch(path, {
      method, headers, credentials: "same-origin",
      body: init.form ?? (init.json === undefined ? undefined : JSON.stringify(init.json)),
    });
  } catch {
    throw new ApiFailure(0, "network", "", {}, {});
  }
  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  if (!response.ok) {
    const error = (body.error ?? {}) as { code?: ErrorCode; message?: string; fields?: Record<string, string> };
    throw new ApiFailure(response.status, error.code ?? "internal_error", error.message ?? "", body, error.fields ?? {});
  }
  return { status: response.status, body: body as T, headers: response.headers };
};

export const get = <T>(path: string, headers?: Record<string, string>): Promise<ApiReply<T>> => request<T>("GET", path, { headers });
export const post = <T>(path: string, json?: unknown, headers?: Record<string, string>): Promise<ApiReply<T>> =>
  request<T>("POST", path, { json, headers });
