interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string>;
  retry_after?: number;
  [key: string]: unknown;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

type Json = Record<string, unknown>;

interface Options {
  headers?: Record<string, string>;
  form?: FormData;
}

let refreshing: Promise<boolean> | null = null;
let signedInProbe: () => boolean = () => false;
let onSessionLost: () => void = () => undefined;

/** The auth context registers how to tell whether a shopper is signed in and what to do when the session cannot be refreshed. */
export function bindSession(isSignedIn: () => boolean, lost: () => void): void {
  signedInProbe = isSignedIn;
  onSessionLost = lost;
}

/** Calls that fail at the same moment share one refresh. */
function refreshOnce(): Promise<boolean> {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
    .then((response) => response.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function send(method: string, path: string, body: string | FormData | undefined, headers: Record<string, string>): Promise<Response> {
  return fetch(path, { method, headers: body instanceof FormData ? headers : { "Content-Type": "application/json", ...headers }, body });
}

export async function api<T = Json>(method: string, path: string, payload?: unknown, options: Options = {}): Promise<T> {
  const body = options.form ?? (payload === undefined ? undefined : JSON.stringify(payload));
  const headers = options.headers ?? {};
  let response = await send(method, path, body, headers);
  if (response.status === 401 && !path.startsWith("/api/auth/") && signedInProbe()) {
    const text = await response.clone().json().catch(() => ({}) as ApiErrorBody);
    if ((text as ApiErrorBody).error === "signed_out") {
      if (await refreshOnce()) response = await send(method, path, body, headers);
      else {
        onSessionLost();
        throw new ApiFailure(401, text as ApiErrorBody);
      }
    }
  }
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({ error: "unreadable", message: "Something went wrong. Try again." }))) as T & ApiErrorBody;
  if (!response.ok) throw new ApiFailure(response.status, json);
  return json;
}

export const get = <T = Json>(path: string): Promise<T> => api<T>("GET", path);
export const post = <T = Json>(path: string, payload: unknown = {}, options?: Options): Promise<T> => api<T>("POST", path, payload, options);
export const put = <T = Json>(path: string, payload: unknown = {}): Promise<T> => api<T>("PUT", path, payload);
export const patch = <T = Json>(path: string, payload: unknown): Promise<T> => api<T>("PATCH", path, payload);
export const del = <T = Json>(path: string): Promise<T> => api<T>("DELETE", path);

export function failureMessage(error: unknown): string {
  return error instanceof ApiFailure ? error.body.message : "Something went wrong. Try again.";
}
