// Typed fetch helpers. Nothing here caches; the server is the source of truth
// for every time-dependent value.

export type User = {
  id: string;
  email: string;
  name: string;
  role: "operator" | "shift_lead" | "renter";
  renter_id: string | null;
  renter_status: string | null;
};

export type ApiErrorShape = {
  error: string;
  errors?: Record<string, string>;
  balance_minutes?: number;
  needed_minutes?: number;
  date?: string;
  legal_end?: string | null;
  blocked_by?: string;
  blocked_at?: string;
  from?: string;
  to?: string;
};

export class ApiFailure {
  constructor(readonly status: number, readonly body: ApiErrorShape) {}
  get code(): string {
    return this.body.error;
  }
}

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const headers = new Headers(init?.headers);
  if (!(init?.body instanceof FormData) && init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  if (!response.ok) {
    let body: ApiErrorShape = { error: "unknown" };
    try {
      body = (await response.json()) as ApiErrorShape;
    } catch {
      /* non-JSON body */
    }
    throw new ApiFailure(response.status, body);
  }
  return response;
};

export const apiJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await request(path, init);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const apiMaybe = async <T>(path: string, init?: RequestInit): Promise<T | ApiFailure> => {
  try {
    return await apiJson<T>(path, init);
  } catch (err) {
    if (err instanceof ApiFailure) return err;
    throw err;
  }
};

export const apiRedirect = async (path: string): Promise<string | null> => {
  const response = await request(path);
  return response.redirected ? response.url : response.headers.get("Location");
};

export const postJson = <T>(path: string, body: unknown): Promise<T> =>
  apiJson<T>(path, { method: "POST", body: JSON.stringify(body) });

export const postJsonWithKey = <T>(path: string, body: unknown, idempotencyKey: string): Promise<T> =>
  apiJson<T>(path, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });

export const deleteJson = <T>(path: string): Promise<T> => apiJson<T>(path, { method: "DELETE" });

