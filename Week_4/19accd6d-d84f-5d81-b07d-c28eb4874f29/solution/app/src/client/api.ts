import type { ApiErrorBody, AppConfig } from "../shared/api";

/** A failed API call, carrying the single error body the server answers with. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorBody["error"]["details"],
  ) {
    super(message);
  }
}

async function failureOf(response: Response): Promise<ApiFailure> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  return body
    ? new ApiFailure(response.status, body.error.code, body.error.message, body.error.details)
    : new ApiFailure(response.status, "internal_error", "Something went wrong.");
}

async function send(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> }): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { method, ...init });
  } catch {
    throw new ApiFailure(0, "network", "The server could not be reached.");
  }
  if (!response.ok) throw await failureOf(response);
  return response;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await send(method, path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function apiBytes(path: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const response = await send("GET", path, {});
  const disposition = response.headers.get("content-disposition") ?? "";
  return { bytes: new Uint8Array(await response.arrayBuffer()), filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? "download.bin" };
}

export async function uploadFile(name: string, bytes: Uint8Array): Promise<{ id: string; name: string; bytes: number }> {
  const response = await send("POST", "/api/files", {
    body: bytes as unknown as BodyInit,
    headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) },
  });
  return ((await response.json()) as { file: { id: string; name: string; bytes: number } }).file;
}

let loaded: AppConfig | null = null;

export const config = (): AppConfig => loaded as AppConfig;

export async function loadConfig(): Promise<AppConfig> {
  loaded = await api<AppConfig>("GET", "/api/config");
  return loaded;
}
