// The API client: one error type, session-ended handling, and keyed requests that retry with the same key.

export class ApiError extends Error {
  constructor(status, error) {
    super(error.message);
    this.status = status;
    this.code = error.code;
    this.extra = error;
  }
}

export class Offline extends Error {}

let onSessionEnded = () => {};
export function whenSessionEnds(fn) {
  onSessionEnded = fn;
}

export async function request(method, path, { json, raw, contentType, key, quietAuth = false } = {}) {
  const headers = {};
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (raw !== undefined) {
    headers["Content-Type"] = contentType;
    body = raw;
  }
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(path, { method, headers, body, credentials: "same-origin" });
  const type = response.headers.get("content-type") || "";
  const data = type.startsWith("application/json") ? await response.json() : null;
  if (response.ok) return { status: response.status, body: data };
  const error = new ApiError(response.status, data?.error || { code: "unknown", message: "Something went wrong." });
  if (error.code === "unauthenticated" && !quietAuth) onSessionEnded();
  throw error;
}

export const get = (path) => request("GET", path).then((r) => r.body);

function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return "tb-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A press that was never confirmed keeps its key, so pressing again retries the same request.
const unconfirmed = new Map();
const RETRY_DELAYS = [1000, 3000, 5000];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function keyed(method, path, options, { signature, onRetry }) {
  const id = `${method} ${path} ${signature ?? JSON.stringify(options.json ?? null)}`;
  const key = unconfirmed.get(id) || newKey();
  unconfirmed.set(id, key);
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await request(method, path, { ...options, key });
      unconfirmed.delete(id);
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        unconfirmed.delete(id);
        throw error;
      }
      if (attempt >= RETRY_DELAYS.length) throw new Offline("offline");
      onRetry?.();
      await sleep(RETRY_DELAYS[attempt]);
    }
  }
}
