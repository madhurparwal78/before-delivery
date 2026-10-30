// The browser's only door to the server: same-origin JSON calls under /api.

export interface ErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  state?: string;
  from?: string;
  to?: string;
  taken?: { station_id: string; start: string; date?: string }[];
  dates?: string[];
  quote?: unknown;
}

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ErrorBody };

const NETWORK: ErrorBody = { error: "network", message: "The server could not be reached." };

async function errorOf(response: Response): Promise<ErrorBody> {
  try {
    const body: ErrorBody = await response.json();
    return body;
  } catch {
    return { error: "unknown", message: response.statusText };
  }
}

export async function call<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  if (!response.ok) return { ok: false, status: response.status, error: await errorOf(response) };
  const text = await response.text();
  const data: T = JSON.parse(text === "" ? "null" : text);
  return { ok: true, status: response.status, data };
}

export async function upload<T>(form: FormData): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch("/api/documents", { method: "POST", credentials: "same-origin", body: form });
  } catch {
    return { ok: false, status: 0, error: NETWORK };
  }
  if (!response.ok) return { ok: false, status: response.status, error: await errorOf(response) };
  const data: T = await response.json();
  return { ok: true, status: response.status, data };
}

export const idempotencyKey = (): string => crypto.randomUUID();
