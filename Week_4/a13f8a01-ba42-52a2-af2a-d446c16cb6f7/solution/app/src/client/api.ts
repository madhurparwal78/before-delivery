import type { ErrorBody } from "../shared/types.js";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
  ) {
    super(body.message);
  }
}

async function failure(response: Response): Promise<ApiFailure> {
  const body = (await response.json()) as ErrorBody;
  return new ApiFailure(response.status, body);
}

async function send<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method,
    signal,
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

export const api = {
  get: <T,>(path: string, signal?: AbortSignal): Promise<T> => send<T>("GET", path, undefined, {}, signal),
  post: <T,>(path: string, body: unknown = {}, headers?: Record<string, string>): Promise<T> => send<T>("POST", path, body, headers),
  put: <T,>(path: string): Promise<T> => send<T>("PUT", path),
  patch: <T,>(path: string, body: unknown): Promise<T> => send<T>("PATCH", path, body),
  delete: <T,>(path: string): Promise<T> => send<T>("DELETE", path),
};

export async function download(path: string): Promise<{ blob: Blob; filename: string }> {
  const response = await fetch(path);
  if (!response.ok) throw await failure(response);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  return { blob: await response.blob(), filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? "pen.zip" };
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
