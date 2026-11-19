export interface Reply<T> {
  ok: boolean;
  status: number;
  data: T;
  /** The server's exact refusal text, when it refused. */
  error: string;
}

async function parse(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  return type.includes("json") ? response.json() : null;
}

/** One call to the app's own origin, JSON in and out; a refusal carries its exact text. */
export async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  const init: RequestInit = { method, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  const data = (await parse(response)) as T;
  const error = !response.ok && data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : "";
  return { ok: response.ok, status: response.status, data, error };
}

