// The browser's one way to talk to the API: JSON in and out, errors as ApiFailure carrying the catalogue code.
import type { ApiErrorBody } from "../../shared/api.ts";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function settle<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const failure = body as ApiErrorBody;
    throw new ApiFailure(response.status, failure.error, failure.message);
  }
  return body as T;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  return settle<T>(response);
}

export const get = <T>(path: string): Promise<T> => api<T>("GET", path);

/** A multipart upload with the single `file` field and optional text fields. */
export async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  form.append("file", file);
  return settle<T>(await fetch(path, { method: "POST", body: form, credentials: "same-origin" }));
}

export const messageOf = (error: unknown): string => (error instanceof ApiFailure ? error.message : "Something went wrong.");
