// Same-origin JSON calls. A refusal comes back as a value, never a thrown string, so screens pick the copy.
type ApiFailure = { status: number; error?: string; errors?: Record<string, string>; body: Record<string, unknown> };
type ApiResult<T> = { ok: true; status: number; data: T } | ({ ok: false } & ApiFailure);

async function send<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const isForm = body instanceof FormData;
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined || isForm ? headers : { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: "network", body: {} };
  }
  const text = response.status === 204 ? "" : await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  return { ok: false, status: response.status, body: parsed, error: parsed.error as string | undefined, errors: parsed.errors as Record<string, string> | undefined };
}

// GETs in flight, so a screen can stay hidden until the loads it opened with have landed.
const inFlight = new Set<Promise<unknown>>();

function counted<T>(request: Promise<T>): Promise<T> {
  inFlight.add(request);
  const landed = () => { inFlight.delete(request); };
  request.then(landed, landed);
  return request;
}

/** Calls `done` once every GET in flight right now has landed. Loads that start later (polls, refreshes) are not
 * waited for, so the call always comes; it settles on promises, never a timer, so a paused clock cannot hold it. */
export function whenLoaded(done: () => void): () => void {
  let cancelled = false;
  void Promise.allSettled([...inFlight]).then(() => { if (!cancelled) done(); });
  return () => { cancelled = true; };
}

export const api = {
  get: <T>(path: string) => counted(send<T>("GET", path)),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => send<T>("POST", path, body, headers),
  put: <T>(path: string, body: unknown, headers?: Record<string, string>) => send<T>("PUT", path, body, headers),
  patch: <T>(path: string, body: unknown, headers?: Record<string, string>) => send<T>("PATCH", path, body, headers),
  delete: <T>(path: string) => send<T>("DELETE", path),
};

/** Fetches a file; returns its blob or the failure so the screen can show the outage copy. */
export async function download(path: string): Promise<{ ok: true; blob: Blob } | { ok: false; status: number }> {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, blob: await response.blob() };
  } catch {
    return { ok: false, status: 0 };
  }
}
