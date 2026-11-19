export interface ApiError {
  error: string;
  message: string;
  fields?: Record<string, string>;
  lot?: unknown;
}

export interface ApiResult<T> {
  status: number;
  body: T & Partial<ApiError>;
}

const BID_TIMEOUT_MS = 10000;

/** request sends one JSON call from the saleroom's own origin. */
export const request = async <T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 0,
): Promise<ApiResult<T>> => {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const sendsBody = method !== "GET" && method !== "HEAD";
    const response = await fetch(path, {
      method,
      headers: sendsBody ? { "Content-Type": "application/json", ...headers } : headers,
      body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
      credentials: "same-origin",
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as T & Partial<ApiError>) : ({} as T & Partial<ApiError>);
    return { status: response.status, body: parsed };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

export const get = <T>(path: string): Promise<ApiResult<T>> =>
  request<T>("GET", path, undefined, {}, 0);

/** bid sends one bid with its idempotency key, so a retry counts once. */
export const bid = <T>(
  lotID: string,
  key: string,
  body: unknown,
): Promise<ApiResult<T>> =>
  request<T>("POST", `/api/lots/${encodeURIComponent(lotID)}/bids`, body, {
    "Idempotency-Key": key,
  }, BID_TIMEOUT_MS);
