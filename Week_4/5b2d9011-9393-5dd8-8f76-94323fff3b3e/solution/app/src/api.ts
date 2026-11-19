export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** The request never reached the server. */
export class NetworkError extends Error {}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetworkError("network");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error;
    const { code, message, fields, ...extra } = (error ?? {}) as Record<string, unknown>;
    throw new ApiError(response.status, String(code ?? "internal"), String(message ?? ""), (fields as Record<string, string>) ?? {}, extra);
  }
  return payload as T;
}

export const SERVER_ERROR_COPY = "Something went wrong on the server. Try again.";
