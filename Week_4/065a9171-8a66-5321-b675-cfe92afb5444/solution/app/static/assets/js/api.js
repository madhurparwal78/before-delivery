// The one client for /api: JSON in and out, errors surfaced as ApiError with the server's body.

export const OFFLINE = "Couldn't reach Tallow. Check your connection and try again.";

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message ?? OFFLINE);
    this.status = status;
    this.code = body?.error ?? "offline";
    this.body = body ?? {};
  }

  fieldMessages() {
    return Object.values(this.body.errors ?? {}).join(" ");
  }
}

export async function request(method, path, { body, headers = {}, form } = {}) {
  const init = { method, headers: { ...headers }, credentials: "same-origin" };
  if (form) init.body = form;
  else if (method !== "GET" && method !== "DELETE") {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, null);
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && payload?.error === "not_signed_in" && location.pathname !== "/sign-in") {
      location.assign("/sign-in");
    }
    throw new ApiError(response.status, payload);
  }
  return payload;
}

export const get = (path) => request("GET", path);
export const post = (path, body, headers) => request("POST", path, { body, headers });
export const patch = (path, body, headers) => request("PATCH", path, { body, headers });
export const del = (path) => request("DELETE", path);

export function query(params) {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined)).toString();
}
