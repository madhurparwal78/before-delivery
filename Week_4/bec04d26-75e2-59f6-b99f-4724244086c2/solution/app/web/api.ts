import type { ConflictBody, FieldErrors } from "../shared/types";

/** Ids of the writes this tab sent, so it can tell which live lines its own actions caused. */
export const ownActions = new Set<string>();

export type Failure =
  | { kind: "fields"; errors: FieldErrors }
  | { kind: "conflict"; body: ConflictBody }
  | { kind: "deadline" }
  | { kind: "illegal" }
  | { kind: "not_found" }
  | { kind: "other"; status: number };

export type Answer<T> = { ok: true; data: T } | { ok: false; failure: Failure };

function failureOf(status: number, body: Record<string, unknown>): Failure {
  if (status === 422) return { kind: "fields", errors: body.errors as FieldErrors };
  if (status === 409 && body.error === "conflict") return { kind: "conflict", body: body as unknown as ConflictBody };
  if (status === 409 && body.error === "deadline_passed") return { kind: "deadline" };
  if (status === 409) return { kind: "illegal" };
  if (status === 404) return { kind: "not_found" };
  return { kind: "other", status };
}

/** One JSON request to the same-origin API; failures come back as values, never thrown. */
export async function request<T>(method: string, path: string, body?: unknown): Promise<Answer<T>> {
  try {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET") {
      const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      ownActions.add(id);
      headers["x-action-id"] = id;
    }
    const response = await fetch(path, {
      method, credentials: "same-origin", headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return { ok: true, data: undefined as T };
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return response.ok ? { ok: true, data: data as T } : { ok: false, failure: failureOf(response.status, data) };
  } catch {
    return { ok: false, failure: { kind: "other", status: 0 } };
  }
}

export const get = <T,>(path: string): Promise<Answer<T>> => request<T>("GET", path);
