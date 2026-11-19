export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `status ${status}`);
  }

  get code(): string {
    return typeof this.body.error === "string" ? this.body.error : "";
  }

  /** The published copy the server sent with a refusal. */
  get notice(): string {
    return typeof this.body.message === "string" ? this.body.message : "";
  }

  get errors(): Record<string, string> {
    const errors = this.body.errors;
    return typeof errors === "object" && errors !== null ? (errors as Record<string, string>) : {};
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiFailure(response.status, payload);
  return payload as T;
}

export const get = <T,>(path: string) => api<T>("GET", path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>("POST", path, body);
export const patch = <T,>(path: string, body: unknown) => api<T>("PATCH", path, body);
export const del = <T,>(path: string) => api<T>("DELETE", path);
