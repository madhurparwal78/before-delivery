export type ApiErrorShape = {
  error: { code: string; message: string; fields?: Record<string, string>; state?: string; retryAfter?: number };
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

async function request(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const text = await res.text();
  const parsed = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const shape = parsed as ApiErrorShape | null;
    if (shape?.error) {
      throw new ApiError(res.status, shape.error.code, shape.error.message, shape.error.fields);
    }
    throw new ApiError(res.status, "unexpected", "Something went wrong. Try again.");
  }
  return parsed;
}

export const api = {
  get: <T>(path: string): Promise<T> => request(path, "GET") as Promise<T>,
  post: <T>(path: string, body?: unknown): Promise<T> => request(path, "POST", body ?? {}) as Promise<T>,
  del: <T>(path: string): Promise<T> => request(path, "DELETE") as Promise<T>
};
