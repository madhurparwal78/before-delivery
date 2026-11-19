import { session } from "./session.js";

export const OUTAGE = "Wayline couldn't confirm this action. Check the list before trying again.";
export const DB_OUTAGE = "Wayline can't reach its database right now. It keeps retrying on its own.";
export const PERMISSION = "You don't have permission to do that.";

// The copy for a request whose outcome is unknown: the database outage when the server says so, otherwise the
// generic outage copy (no answer or any other 5xx).
export function outageCopy(result) {
  return result.status === 503 && result.body?.error === "service_unavailable" ? DB_OUTAGE : OUTAGE;
}

export function toLogin() {
  const next = window.location.pathname + window.location.search;
  session.clear();
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

// Every console request: bearer session, JSON in and out. A 401 forgets the token and sends the person to sign in,
// after `beforeLogin` has kept whatever must survive; no answer or a 5xx is reported as an outage so the caller
// shows the outage copy and keeps its values.
export async function api(path, { method = "GET", body, headers = {}, beforeLogin } = {}) {
  const token = session.get();
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, outage: true, status: 0, body: null };
  }
  if (response.status === 401) {
    beforeLogin?.();
    toLogin();
    return { ok: false, status: 401, body: null, redirected: true };
  }
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { ok: response.ok, outage: response.status >= 500, status: response.status, body: data, headers: response.headers };
}

export function freshKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
