/** The browser's one way of talking to the app's own API. */

export type ApiFailure = {
  ok: false;
  status: number;
  code: string;
  errors: Record<string, string>;
  message: string | null;
  retryAfter: number | null;
  /** The whole error body, for the extra keys a code publishes. */
  body: Record<string, unknown>;
};

export type ApiSuccess<T> = { ok: true; status: number; data: T; headers: Headers };

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export type NetworkFailure = ApiFailure & { code: "network" };

async function toResult<T>(response: Response): Promise<ApiResult<T>> {
  if (response.status === 204) {
    return { ok: true, status: 204, data: undefined as T, headers: response.headers };
  }
  const text = await response.text();
  const body: unknown = text.length > 0 ? JSON.parse(text) : null;
  if (response.ok) {
    return { ok: true, status: response.status, data: body as T, headers: response.headers };
  }
  const failure = (body ?? {}) as {
    error?: string;
    errors?: Record<string, string>;
    message?: string;
  };
  const retryAfter = response.headers.get("retry-after");
  return {
    ok: false,
    status: response.status,
    code: failure.error ?? "error",
    errors: failure.errors ?? {},
    message: failure.message ?? null,
    retryAfter: retryAfter === null ? null : Number(retryAfter),
    body: (body ?? {}) as Record<string, unknown>,
  };
}

export async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; contentType?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: {
        ...(options.body === undefined
          ? {}
          : { "content-type": options.contentType ?? "application/json" }),
        ...(options.headers ?? {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return await toResult<T>(response);
  } catch {
    return {
      ok: false,
      status: 0,
      code: "network",
      errors: {},
      message: null,
      retryAfter: null,
      body: {},
    };
  }
}

export const getJson = <T>(path: string): Promise<ApiResult<T>> => request<T>("GET", path);

/** A share data request answered 429 is tried once more after its `Retry-After`. */
export async function getJsonRetrying<T>(path: string): Promise<ApiResult<T>> {
  const first = await getJson<T>(path);
  if (first.ok || first.status !== 429) {
    return first;
  }
  await new Promise((resolve) => setTimeout(resolve, (first.retryAfter ?? 1) * 1000));
  return getJson<T>(path);
}

export function requestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Percent-encodes a capture name as UTF-8 for `X-Capture-Filename`. */
export function encodeCaptureName(name: string): string {
  return [...new TextEncoder().encode(name.normalize("NFC"))]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return /[A-Za-z0-9!$&'()*+,.;=@_~-]/.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");
}
