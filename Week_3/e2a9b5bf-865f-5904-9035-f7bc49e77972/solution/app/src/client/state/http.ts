import { api, Unreachable, type ApiResult } from "../lib/api";
import { app } from "./model";
import { handleUnauthorized } from "./unauth";

/** An authenticated call: tracks whether the server can be reached and what a 401 means. Null when unreachable. */
export async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult<T> | null> {
  try {
    const result = await api<T>(method, path, body);
    if (!app.get().reachable) app.set({ reachable: true });
    if (result.status === 401) handleUnauthorized();
    return result;
  } catch (error) {
    if (error instanceof Unreachable) {
      app.set({ reachable: false });
      return null;
    }
    throw error;
  }
}
