// Same-origin JSON calls. A request that never reaches the server is "offline"; anything else is the API's own error.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string>,
    readonly extra: Record<string, unknown>,
    readonly retryAfter: string | null,
  ) {
    super(message);
  }

  get offline(): boolean {
    return this.status === 0;
  }
}

const OFFLINE = "you're offline";

/** The "<reason>" placeholder of the feedback copy. */
export function reason(error: unknown): string {
  return error instanceof ApiFailure && !error.offline ? error.message : OFFLINE;
}

/** The page's copy for a failure: the API's message (or its first field message), else the page's offline line. */
export function failureText(error: unknown, offline: string): string {
  if (!(error instanceof ApiFailure) || error.offline) return offline;
  return error.code === "validation" ? (Object.values(error.fields)[0] ?? error.message) : error.message;
}

/** "Too many attempts — try again in <wait> seconds." for sign-in and join. */
export function tooManyAttempts(error: ApiFailure): string {
  return `Too many attempts — try again in ${error.retryAfter ?? "a few"} seconds.`;
}

type Listener = (failure: ApiFailure) => void;
const listeners = new Set<Listener>();

/** Called for every session_ended answer, so the room can switch to the session-ended page. */
export function onFailure(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function api<T>(method: string, path: string, body?: unknown, raw?: { bytes: Blob; type: string }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: raw ? { "Content-Type": raw.type } : body === undefined ? {} : { "Content-Type": "application/json" },
      ...(raw ? { body: raw.bytes } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiFailure(0, "offline", OFFLINE, {}, {}, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const data: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = (data as { error?: Record<string, unknown> } | undefined)?.error ?? {};
    const { code, message, fields, ...extra } = error;
    const failure = new ApiFailure(
      response.status,
      typeof code === "string" ? code : "error",
      typeof message === "string" ? message : "Something went wrong",
      (fields as Record<string, string> | undefined) ?? {},
      extra,
      response.headers.get("Retry-After"),
    );
    for (const listener of listeners) listener(failure);
    throw failure;
  }
  return data as T;
}

export function opId(): string {
  return `op-${crypto.randomUUID().replace(/-/g, "")}`;
}
