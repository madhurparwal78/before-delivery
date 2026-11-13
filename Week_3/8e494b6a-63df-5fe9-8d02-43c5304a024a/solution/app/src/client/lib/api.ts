// The browser's one way to talk to the API: JSON in and out, the one error shape, and a count of writes in flight.
import { update } from "./store";

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
    readonly position: number | null = null,
    readonly network = false,
  ) {
    super(message);
  }
}

const NETWORK_SENTENCE = "Spoorline can't reach the server. Retry when your connection is back.";

type Body = Record<string, unknown> | FormData | undefined;

async function call<T>(method: string, path: string, body: Body): Promise<T> {
  const counted = method !== "GET";
  if (counted) update((s) => ({ pending: s.pending + 1 }));
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: body && !(body instanceof FormData) ? { "content-type": "application/json" } : undefined,
        body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure(0, "network", NETWORK_SENTENCE, {}, null, true);
    }
    if (response.status === 204) return undefined as T;
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new ApiFailure(
        response.status, String(payload.error ?? "error"), String(payload.message ?? NETWORK_SENTENCE),
        (payload.fields as Record<string, string> | undefined) ?? {}, typeof payload.position === "number" ? payload.position : null,
      );
    }
    return payload as T;
  } finally {
    if (counted) update((s) => ({ pending: s.pending - 1 }));
  }
}

export const api = {
  get: <T>(path: string) => call<T>("GET", path, undefined),
  post: <T>(path: string, body?: Body) => call<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: Body) => call<T>("PUT", path, body),
  patch: <T>(path: string, body: Body) => call<T>("PATCH", path, body),
  del: <T>(path: string) => call<T>("DELETE", path, undefined),
};

export const query = (params: Record<string, string | number | undefined | null>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
