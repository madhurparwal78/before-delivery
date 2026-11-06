interface ApiFailure {
  status: number;
  code: string;
  message: string;
  fields: Record<string, string>;
}

type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiFailure };

/** Call the JSON API on this origin. Network failures come back as status 0. */
export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined || body instanceof FormData ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: { status: 0, code: "network", message: "The server could not be reached.", fields: {} } };
  }
  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : undefined;
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = (parsed as { error?: Partial<ApiFailure> } | undefined)?.error ?? {};
  return {
    ok: false,
    status: response.status,
    error: { status: response.status, code: error.code ?? "error", message: error.message ?? "Something went wrong.", fields: error.fields ?? {} },
  };
}
