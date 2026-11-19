/** Typed JSON fetch helpers shared by all pages. */

export interface FetchResult<T> {
  status: number;
  body: T | null;
  headers: Headers;
  ok: boolean;
}

export async function jsonFetch<T>(url: string, options: RequestInit = {}): Promise<FetchResult<T>> {
  const response = await fetch(url, options);
  const text = await response.text();
  let body: T | null = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: response.status, body, headers: response.headers, ok: response.ok };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly extras: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const result = await jsonFetch<T>(url, options);
  if (result.status >= 400) {
    const payload = (result.body || {}) as { error?: string; message?: string };
    throw new ApiError(
      result.status,
      payload.error || "unknown",
      payload.message || "Something went wrong.",
      (payload || {}) as Record<string, unknown>,
    );
  }
  return result.body as T;
}

/** A request that ends with no HTTP response at all (connection lost). */
export class NoResponseError extends Error {
  constructor() {
    super("The request ended without a response.");
  }
}

export async function fetchOrNoResponse(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new NoResponseError();
    }
    throw error;
  }
}
