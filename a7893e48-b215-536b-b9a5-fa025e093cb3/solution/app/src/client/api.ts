export interface ErrorBody { error: string; message: string; fields?: Record<string, string>; [extra: string]: unknown }

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly body: ErrorBody) {
    super(body.message);
  }

  get code(): string {
    return this.body.error;
  }

  /** The first field message of a validation error, or the error's sentence. */
  get detail(): string {
    return Object.values(this.body.fields ?? {})[0] ?? this.body.message;
  }
}

let serverOffset = 0;

/** The server's clock, from the Date header of the latest response (the browser's own clock may differ). */
export function serverNow(): number {
  return Date.now() + serverOffset;
}

/** A fresh Idempotency-Key (getRandomValues works outside secure contexts too). */
export function idempotencyKey(): string {
  return `hs-${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function finish<T>(response: Response): Promise<T> {
  const stamp = response.headers.get("date");
  if (stamp) serverOffset = Date.parse(stamp) - Date.now();
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as unknown;
  if (!response.ok) throw new ApiFailure(response.status, body as ErrorBody);
  return body as T;
}

export async function api<T>(method: "GET" | "POST" | "DELETE", path: string, body?: object, key?: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  return finish<T>(await fetch(path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
}

export async function upload<T>(path: string, form: FormData): Promise<T> {
  return finish<T>(await fetch(path, { method: "POST", body: form, headers: { Accept: "application/json" } }));
}
