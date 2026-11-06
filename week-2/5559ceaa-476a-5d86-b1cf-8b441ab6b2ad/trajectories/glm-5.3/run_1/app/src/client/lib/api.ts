export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
}

export class ApiCallError extends Error {
  code: string;
  status: number;
  extra: Record<string, unknown>;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? "Something went wrong.");
    this.status = status;
    this.code = body?.error.code ?? "unexpected";
    this.extra = body?.error as Record<string, unknown>;
  }
}

export async function api<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: T | null }> {
  const isJson = body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer);
  const init: RequestInit = {
    method,
    credentials: "same-origin",
  };
  const headers: Record<string, string> = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers[k] = v;
  if (Object.keys(headers).length > 0) init.headers = headers;
  if (body !== undefined) init.body = isJson ? JSON.stringify(body) : (body as BodyInit);
  const res = await fetch(path, init);
  if (res.status === 204) return { status: 204, data: null };
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("json") ? ((await res.json()) as T) : null;
  if (!res.ok) {
    throw new ApiCallError(res.status, data as unknown as ApiErrorBody | null);
  }
  return { status: res.status, data };
}
