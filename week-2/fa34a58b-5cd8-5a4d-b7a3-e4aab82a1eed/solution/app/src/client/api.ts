// Same-origin JSON calls. A request that gets no HTTP answer shows the unreachable-hub alert.

import type { ApiErrorBody } from "../shared/types.ts";

type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ApiErrorBody["error"] };

/** Thrown when a request got no HTTP answer at all. */
export class HubUnreachable extends Error {}

let unreachableAlert: HTMLElement | null = null;
export function useUnreachableAlert(element: HTMLElement): void {
  unreachableAlert = element;
}

const UNREACHABLE = "Nightplan can't reach the hub. Your last change was not saved.";

export async function api<T>(method: "GET" | "POST" | "PUT", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? null : JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    if (unreachableAlert) {
      unreachableAlert.hidden = false;
      unreachableAlert.textContent = UNREACHABLE;
    }
    throw new HubUnreachable(UNREACHABLE);
  }
  if (unreachableAlert && !unreachableAlert.hidden) {
    unreachableAlert.hidden = true;
    unreachableAlert.textContent = "";
  }
  const payload: unknown = await response.json().catch(() => null);
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  const error = (payload as ApiErrorBody | null)?.error ?? { code: "unknown", message: "The hub could not answer." };
  return { ok: false, status: response.status, error };
}

/** GET that must succeed (page data); failures surface through the unreachable alert. */
export async function load<T>(path: string): Promise<T> {
  const result = await api<T>("GET", path);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A request key for one guest-scene submission: 32 visible characters. */
export function requestKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
