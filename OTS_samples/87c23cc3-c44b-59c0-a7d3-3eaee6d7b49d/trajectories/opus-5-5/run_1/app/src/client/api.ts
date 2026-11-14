export interface ApiErrorBody {
  error: string;
  message: string;
  fields?: Record<string, string>;
  lines?: string[];
  revision?: number;
  text?: string;
  conflicts?: { unit: string; by: string }[];
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody | null };

/** Calls the API on this origin. A transport failure has status 0 and no error body. */
export async function api<T>(method: string, path: string, body?: unknown, raw?: { data: BodyInit; type: string }): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: "same-origin", headers: {} };
  if (raw) {
    init.body = raw.data;
    (init.headers as Record<string, string>)["Content-Type"] = raw.type;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const type = response.headers.get("Content-Type") ?? "";
  const data: unknown =
    response.status === 204 ? null : type.includes("json") ? await response.json().catch(() => null) : await response.text();
  if (response.ok) return { ok: true, status: response.status, data: data as T };
  return { ok: false, status: response.status, error: (data as ApiErrorBody | null) ?? null };
}
