import type { FieldErrors } from "../shared/types";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; errors?: FieldErrors; post?: { section_id: string; position: number; version: number }; moved_by?: string },
  ) {
    super(`${status}`);
  }

  /** The first field message of a 422, for the dialog alert. */
  get firstError(): string {
    return Object.values(this.body.errors ?? {})[0] ?? "";
  }
}

export async function call<T = undefined>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined || isForm ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiFailure(response.status, data as ApiFailure["body"]);
  return data as T;
}

export const get = <T>(path: string): Promise<T> => call<T>("GET", path);
