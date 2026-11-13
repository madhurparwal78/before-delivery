// Same-origin JSON calls. A 401 on a signed-in call ends the session in the UI.
import type { ErrorBody } from "../shared/api";

export type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorBody }
  | { ok: false; status: 0; error: null };

let onSessionEnded: () => void = () => undefined;

export function whenSessionEnds(handler: () => void): void {
  onSessionEnded = handler;
}

export async function call<T>(method: string, path: string, options: { body?: unknown; key?: string; guest?: boolean } = {}): Promise<Result<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.key) headers["Request-Key"] = options.key;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    return { ok: false, status: 0, error: null };
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = parsed as ErrorBody;
  if (response.status === 401 && error.error === "unauthenticated" && !options.guest) onSessionEnded();
  return { ok: false, status: response.status, error };
}

/** Saves the latest stored evidence snapshot under the file name the API gives. */
export async function download(path: string): Promise<Result<null>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, error: null };
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as ErrorBody | null;
    if (!error) return { ok: false, status: 0, error: null };
    if (response.status === 401) onSessionEnded();
    return { ok: false, status: response.status, error };
  }
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "keelson-evidence.json";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { ok: true, status: 200, data: null };
}
