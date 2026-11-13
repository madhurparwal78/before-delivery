/** JSON over fetch. A refusal is an ApiFail carrying the published error code. */

export class ApiFail extends Error {
  readonly status: number;
  readonly code: string;
  readonly body: Record<string, unknown>;

  constructor(status: number, code: string, body: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFail(0, "NETWORK");
  }
  if (response.status === 204) return undefined as T;
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new ApiFail(response.status, String(parsed.error ?? "ERROR"), parsed);
  return parsed as T;
}

export const get = <T>(path: string): Promise<T> => request<T>("GET", path);
export const post = <T>(path: string, body: unknown = {}): Promise<T> => request<T>("POST", path, body);
export const del = <T>(path: string): Promise<T> => request<T>("DELETE", path);
