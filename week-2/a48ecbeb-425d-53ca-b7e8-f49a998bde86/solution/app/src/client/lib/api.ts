// The browser's one way to call the shop's API. Errors arrive in the published error shape.

interface ErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  stock_left?: number;
  limit?: "crate" | "drop";
  committed?: number;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
  }
  get code(): string {
    return this.body.error;
  }
}

/** Network failures look like an outage of the whole shop. */
const offline = (): ApiFailure => new ApiFailure(503, { error: "store_unavailable", message: "The shop can't update right now. Try again in a moment." });

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw offline();
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw offline();
  }
  if (!response.ok) throw new ApiFailure(response.status, parsed as ErrorBody);
  return parsed as T;
}

export async function upload<T>(path: string, form: FormData): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", body: form, credentials: "same-origin" });
  } catch {
    throw offline();
  }
  const parsed: unknown = await response.json().catch(() => ({ error: "store_unavailable", message: "" }));
  if (!response.ok) throw new ApiFailure(response.status, parsed as ErrorBody);
  return parsed as T;
}
