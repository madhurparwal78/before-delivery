/** API client: one fetch wrapper, the error body, and the idempotency keys. */

import type { ApiErrorBody } from "../shared/api-types.js";

export interface ApiErrorDetail {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

export class ApiClientError extends Error {
  constructor(readonly detail: ApiErrorDetail) {
    super(detail.message);
  }
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<{ status: number; body: unknown; text: string; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (body !== undefined && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (idempotencyKey !== undefined) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body)
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      code: "network",
      message: "",
      details: {}
    });
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const errorBody = (parsed as ApiErrorBody | null)?.error;
    if (res.status === 401 && !path.startsWith("/api/session")) {
      // The session ended: go to Sign in and show the copy.
      sessionStorage.setItem("sk_session_ended", "1");
      window.location.assign("/signin");
    }
    throw new ApiClientError({
      status: res.status,
      code: errorBody?.code ?? "unknown",
      message: errorBody?.message ?? "",
      details: errorBody?.details ?? {}
    });
  }
  return { status: res.status, body: parsed, text, headers: res.headers };
}

export async function apiJson<T>(
  method: string,
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<T> {
  const res = await request(method, path, body, idempotencyKey);
  return res.body as T;
}

export async function apiDownload(path: string): Promise<void> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (res.status === 401) {
    sessionStorage.setItem("sk_session_ended", "1");
    window.location.assign("/signin");
  }
  if (!res.ok) {
    let code = "unknown";
    let message = "";
    try {
      const parsed = (await res.json()) as ApiErrorBody;
      code = parsed.error.code;
      message = parsed.error.message;
    } catch {
      /* not json */
    }
    throw new ApiClientError({ status: res.status, code, message, details: {} });
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = match?.[1] ?? "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Open a file (document or invoice) in a new context. */
export async function apiOpenFile(path: string): Promise<void> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) {
    let code = "unknown";
    try {
      const parsed = (await res.json()) as ApiErrorBody;
      code = parsed.error.code;
    } catch {
      /* not json */
    }
    throw new ApiClientError({ status: res.status, code, message: "", details: {} });
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** One Idempotency-Key per confirm attempt on a hold; reused when the same attempt is retried. */
export class IdempotencyKeys {
  private confirmKeys = new Map<string, string>();

  confirmKey(holdRef: string, payWith: string): string {
    const composite = `${holdRef}|${payWith}`;
    const existing = this.confirmKeys.get(composite);
    if (existing) return existing;
    const key = crypto.randomUUID();
    this.confirmKeys.set(composite, key);
    return key;
  }

  clearConfirm(holdRef: string): void {
    for (const key of [...this.confirmKeys.keys()]) {
      if (key.startsWith(`${holdRef}|`)) this.confirmKeys.delete(key);
    }
  }
}

export const idempotencyKeys = new IdempotencyKeys();
