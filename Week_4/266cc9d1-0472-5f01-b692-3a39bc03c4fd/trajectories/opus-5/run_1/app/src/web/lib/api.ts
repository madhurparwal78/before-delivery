import type { ApiErrorBody } from "./types.js";

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, body: ApiErrorBody | null, fallback: string) {
    super(body?.error.message ?? fallback);
    this.status = status;
    this.code = body?.error.code ?? "network_error";
    this.fields = body?.error.fields ?? {};
  }
}

interface RequestOptions {
  body?: unknown;
  rawBody?: BodyInit;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body,
      credentials: "same-origin",
      signal: options.signal,
    });
  } catch {
    throw new ApiFailure(0, null, "The request could not be sent.");
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    throw new ApiFailure(
      response.status,
      (parsed as ApiErrorBody | null)?.error ? (parsed as ApiErrorBody) : null,
      "The request failed.",
    );
  }
  return parsed as T;
}

/** A browser-side SHA-256, used to declare an upload manifest. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
