// Same-origin JSON requests. A 401 on a signed-in screen sends the browser to Sign in.

import { navigate } from "./router";

export interface ApiResponse<T> {
  status: number;
  data: T;
  headers: Headers;
}

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Public screens and Sign in handle 401 themselves. */
  allowUnauthenticated?: boolean;
}

export async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...options.headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options.signal,
  });
  const text = await response.text();
  const data = (text && response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : null) as T;
  if (response.status === 401 && !options.allowUnauthenticated) {
    navigate("/signin", { replace: true, state: { next: location.pathname + location.search } });
  }
  return { status: response.status, data, headers: response.headers };
}
