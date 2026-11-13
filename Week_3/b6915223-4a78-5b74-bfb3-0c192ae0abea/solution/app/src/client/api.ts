import type { ErrorBody } from "../shared/api.ts";
import { setState } from "./store.ts";

// Every call goes to this app's own /api; the browser never talks to a backing service.
export type Result<T> =
  | { ok: true; status: number; data: T; replayed: boolean; headers: Headers }
  | { ok: false; status: number; error: ErrorBody };

export async function request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = response.headers.get("Content-Type")?.startsWith("application/json") ? await response.text() : "";
  const data: unknown = text ? JSON.parse(text) : null;
  if (response.ok) return { ok: true, status: response.status, data: data as T, replayed: response.headers.get("Idempotent-Replayed") === "true", headers: response.headers };
  // A session that has ended sends the visitor back to Sign in.
  if (response.status === 401 && path !== "/api/auth/signin") setState({ me: null });
  return { ok: false, status: response.status, error: (data as ErrorBody | null) ?? { error: "unknown", message: response.statusText } };
}


export function messagesOf(error: ErrorBody): string {
  return (error.rules ?? []).map((rule) => rule.message).join("; ");
}
