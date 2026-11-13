import type { ApiErrorBody } from "../shared/api";

/** A refused request, carrying the API's one error body. `status` is 0 when the server could not be reached. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

async function send(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<Response> {
  try {
    return await fetch(path, {
      method,
      credentials: "same-origin",
      headers: raw ? undefined : body === undefined ? undefined : { "content-type": "application/json" },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiFailure(0, { error: "network", message: "Could not reach the server." });
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const response = await send(method, path, body, raw);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) throw new ApiFailure(response.status, parsed as ApiErrorBody);
  return parsed as T;
}

export const get = <T>(path: string): Promise<T> => api<T>("GET", path);
export const post = <T>(path: string, body?: unknown): Promise<T> => api<T>("POST", path, body ?? {});
export const del = <T = void>(path: string, body?: unknown): Promise<T> => api<T>("DELETE", path, body);

/** Fetches a file the server builds (an export or the original) and hands the bytes to the browser as a download. */
export async function download(path: string, filename: string): Promise<void> {
  const response = await send("GET", path);
  if (!response.ok) throw new ApiFailure(response.status, (await response.json()) as ApiErrorBody);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
