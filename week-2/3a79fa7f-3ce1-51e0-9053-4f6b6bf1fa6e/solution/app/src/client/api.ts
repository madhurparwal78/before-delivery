// JSON calls to the same-origin API. Refusals keep the API's code, message and field messages.
export interface Refusal {
  error: string;
  message: string;
  fields?: Record<string, string>;
}

export type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: Refusal };

const FAULT = "Something went wrong. Please try again.";

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: { error: "network", message: FAULT } };
  }
  const data: unknown = await res.json().catch(() => null);
  if (res.ok) return { ok: true, status: res.status, data: data as T };
  const refusal = data as Refusal | null;
  if (res.status >= 500 && res.status !== 503) return { ok: false, status: res.status, error: { error: "internal_error", message: FAULT } };
  return { ok: false, status: res.status, error: refusal?.message ? refusal : { error: "internal_error", message: FAULT } };
}
