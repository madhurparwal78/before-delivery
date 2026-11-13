import type { ApiErrorBody } from "../shared/types.js";

type Result<T> = { ok: boolean; status: number; data: T; code: string | null };

/** One place for requests: an HTTP refusal is a value to read, a dropped connection is status 0. */
export async function call<T = Record<string, never>>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  try {
    const reply = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await reply.text();
    let data = {} as T;
    try {
      data = text ? (JSON.parse(text) as T) : data;
    } catch {
      // a non-JSON body carries nothing to read
    }
    const code = (data as Partial<ApiErrorBody>).error?.code ?? null;
    if (code === "session_ended") sessionEndedHook?.();
    return { ok: reply.ok, status: reply.status, data, code };
  } catch {
    return { ok: false, status: 0, data: {} as T, code: null };
  }
}

let sessionEndedHook: (() => void) | null = null;
/** Any 401 that names an ended session opens the sign-in prompt, whichever call met it. */
export const onSessionEnded = (hook: () => void): void => {
  sessionEndedHook = hook;
};
