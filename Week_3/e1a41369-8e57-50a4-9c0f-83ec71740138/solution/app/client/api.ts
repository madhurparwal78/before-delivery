interface LineError {
  line: number;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; errors?: Record<string, string> | LineError[] },
  ) {
    super(`HTTP ${status}`);
  }
}

/** The server's per-field validation messages, when a request was refused with 422. */
export function fieldErrors(error: unknown): Record<string, string> | undefined {
  return error instanceof ApiError && error.status === 422 && !Array.isArray(error.body.errors) ? error.body.errors : undefined;
}

/** The server's per-line import errors, when an import file was rejected. */
export function lineErrors(error: unknown): LineError[] | undefined {
  return error instanceof ApiError && Array.isArray(error.body.errors) ? error.body.errors : undefined;
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined || method !== "GET") {
    init.body = JSON.stringify(body ?? {});
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  const response = await fetch(path, init);
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json();
  if (!response.ok) throw new ApiError(response.status, payload as ApiError["body"]);
  return payload as T;
}

export const keyed = (): Record<string, string> => ({ "Idempotency-Key": crypto.randomUUID() });

export const GENERIC_FAILURE = "Something went wrong. Try again.";

/** The copy for a failed request: the server's field message when it sent one, else the generic line. */
export function explain(error: unknown): string {
  return Object.values(fieldErrors(error) ?? {})[0] ?? GENERIC_FAILURE;
}
