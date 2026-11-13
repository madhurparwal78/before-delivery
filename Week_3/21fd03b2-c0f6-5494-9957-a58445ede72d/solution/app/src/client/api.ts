import { signInReturnPath } from "../shared/safeReturn";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: Uint8Array;
  /** A 401 on a public screen does not send the person to sign in. */
  quiet?: boolean;
  signal?: AbortSignal;
}

interface Answer<T> {
  data: T;
  response: Response;
}

function endSession(): never {
  const target = signInReturnPath(`${location.pathname}${location.search}`);
  location.assign(target);
  throw new ApiFailure(401, "unauthenticated", "Sign in to continue.");
}

/** Fetches JSON; a TypeError from fetch (the network is down) propagates as is. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<Answer<T>> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (options.raw) {
    headers["content-type"] = "application/octet-stream";
    body = options.raw as unknown as BodyInit;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { method: options.method ?? "GET", headers, body, credentials: "same-origin", signal: options.signal });
  if (response.ok) {
    // Read the body even when it is empty (204): a fetch whose body is never consumed stays open in the
    // browser and is torn down as an aborted request when the page goes away.
    const text = await response.text();
    return { data: (text ? JSON.parse(text) : null) as T, response };
  }
  const parsed = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } };
  const error = parsed.error ?? {};
  if (response.status === 401 && !options.quiet) endSession();
  throw new ApiFailure(response.status, error.code ?? "error", error.message ?? "Something went wrong.", error.fields, error.details);
}

export const get = <T>(path: string, options: RequestOptions = {}): Promise<T> => request<T>(path, options).then((a) => a.data);
export const send = <T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> => request<T>(path, { ...options, method, body }).then((a) => a.data);

/** Server time of a response, so lease lifetimes are measured on the server's clock. */
export function serverTime(response: Response): number {
  const stamp = response.headers.get("x-server-time");
  return stamp ? Date.parse(stamp) : Date.now();
}

export interface Me {
  user: { id: string; email: string; displayName: string };
  workspaces: Array<{ id: string; name: string; role: "owner" | "editor" | "viewer" }>;
  lastWorkspaceId: string | null;
}

export const fetchMe = (quiet = false): Promise<Me> => get<Me>("/api/me", { quiet });

export function isOffline(error: unknown): boolean {
  return error instanceof TypeError;
}
