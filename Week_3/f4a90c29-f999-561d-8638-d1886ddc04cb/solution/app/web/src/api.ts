export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly current: unknown = null,
  ) {
    super(message);
  }
}

interface ApiResult<T> {
  data: T;
  version: number | null;
}

export async function call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (response.status === 204) return { data: null as T, version: null };
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, data?.error ?? "error", data?.message ?? "Something went wrong.", data?.fields ?? {}, data?.current ?? null);
  }
  const tag = response.headers.get("ETag");
  return { data: data as T, version: tag ? Number(tag.replaceAll('"', "")) : null };
}

export const get = <T>(path: string) => call<T>("GET", path).then((r) => r.data);
export const send = <T>(method: string, path: string, body?: unknown, version?: number | null) =>
  call<T>(method, path, body, version == null ? {} : { "If-Match": `"${version}"` });

export function describe(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Try again.";
}
