import type { ApiError, Session, Task } from "../shared/types.js";

/** A refused or failed request: the API's error code, or "network" when nothing came back. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly current: Task | Session | null = null,
  ) {
    super(message);
  }
}

type Options = { body?: unknown; raw?: { text: string; type: string }; headers?: Record<string, string> };

export async function api<T>(method: string, path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: string | undefined;
  if (options.raw) {
    headers["Content-Type"] = options.raw.type;
    body = options.raw.text;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(options.body);
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  } catch {
    throw new ApiFailure(0, "network", "No response");
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = (data ?? {}) as Partial<ApiError>;
    throw new ApiFailure(response.status, error.error ?? "server_error", error.message ?? "", error.fields ?? {}, error.current ?? null);
  }
  return data as T;
}

/** Rejection reasons chosen by the API's error code (Feedback states). */
export function reason(error: unknown): string {
  const code = error instanceof ApiFailure ? error.code : "";
  switch (code) {
    case "version_conflict":
      return "it was changed on another device";
    case "workspace_read_only":
      return "this workspace is read-only";
    case "day_in_past":
      return "that day has already passed";
    case "already_scheduled":
      return "it's already on the calendar";
    case "estimate_required":
      return "add an estimate first";
    case "crosses_midnight":
      return "it would run past midnight";
    default:
      return "the server didn't respond";
  }
}

export const SERVER_ERROR = "Something went wrong on our side. Nothing was changed.";

/** True when the failure is a server error or no response, which gets the generic copy. */
export function isServerFault(error: unknown): boolean {
  return !(error instanceof ApiFailure) || error.status === 0 || error.status >= 500;
}

export function newKey(): string {
  return crypto.randomUUID();
}
