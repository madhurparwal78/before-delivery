// Every browser call to the API. A 401 session_expired triggers one shared refresh, then each
// original request is replayed with its payload; a failed refresh ends the session in place.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }

  get errors(): Record<string, string> {
    return (this.body.errors as Record<string, string> | undefined) ?? {};
  }

  get message(): string {
    const error = this.body.error as { message?: string } | undefined;
    return error?.message ?? "";
  }
}

let refreshEpoch = 0;
let refreshing: Promise<boolean> | null = null;
const endedListeners = new Set<() => void>();

export function onSessionEnded(listener: () => void): () => void {
  endedListeners.add(listener);
  return () => endedListeners.delete(listener);
}

async function refreshSince(epoch: number): Promise<boolean> {
  if (refreshEpoch > epoch) return true;
  refreshing ??= fetch("/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((r) => {
      if (r.ok) refreshEpoch += 1;
      return r.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

interface CallOptions {
  method?: string;
  json?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

const codeOf = (body: Record<string, unknown>): string => (body.error as { code?: string } | undefined)?.code ?? (body.errors ? "invalid" : "");

export async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? (options.json !== undefined || options.form ? "POST" : "GET"),
    credentials: "same-origin",
    headers: { ...(options.json !== undefined ? { "Content-Type": "application/json" } : {}), ...options.headers },
    body: options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined),
  };
  const epoch = refreshEpoch;
  let response = await fetch(path, init);
  let body = await readBody(response);
  if (response.status === 401 && codeOf(body) === "session_expired") {
    if (await refreshSince(epoch)) {
      response = await fetch(path, init);
      body = await readBody(response);
    } else {
      endedListeners.forEach((listener) => listener());
      throw new HttpError(401, "signed_out", body);
    }
  }
  if (!response.ok) throw new HttpError(response.status, codeOf(body), body);
  return body as T;
}

export const signInHref = (returnTo: string): string => `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
