import type { Session } from "../shared/api";

// Same-origin JSON calls. Every value the screens show comes from these responses.

interface ApiResult<T> {
  status: number;
  data: T;
}

export type ApiBody = { error?: string; errors?: Record<string, string> };

/** Fired when a request answers 401 because the session ended (signed out elsewhere or refunded). */
export const SESSION_ENDED = "lanternfish:session-ended";

const REMEMBERED_SESSION = "lanternfish:session";
const PENDING_SIGN_OUT = "lanternfish:pending-sign-out";

function parse<T>(text: string): T {
  return text === "" ? JSON.parse("{}") : JSON.parse(text);
}

/** The session from the last successful session response, so an offline page load knows whose logbook is open. */
export function rememberedSession(): Session | null {
  const stored = localStorage.getItem(REMEMBERED_SESSION);
  return stored === null ? null : parse<Session>(stored);
}

export function rememberSession(session: Session | null): void {
  if (session) localStorage.setItem(REMEMBERED_SESSION, JSON.stringify(session));
  else localStorage.removeItem(REMEMBERED_SESSION);
}

let signingOut: Promise<void> | null = null;

/** Ends a session signed out while offline: the first request once the connection returns. */
function flushSignOut(): Promise<void> {
  if (localStorage.getItem(PENDING_SIGN_OUT) === null || !navigator.onLine) return Promise.resolve();
  signingOut ??= fetch("/api/session", { method: "DELETE", credentials: "same-origin" })
    .then(() => localStorage.removeItem(PENDING_SIGN_OUT))
    .catch(() => undefined)
    .finally(() => {
      signingOut = null;
    });
  return signingOut;
}

window.addEventListener("online", () => void flushSignOut());

/** Signs out at once: the remembered session is forgotten now, and the server is told now or on reconnect. */
export async function signOut(): Promise<void> {
  rememberSession(null);
  localStorage.setItem(PENDING_SIGN_OUT, "1");
  await flushSignOut();
}

async function request<T>(path: string, init: RequestInit): Promise<ApiResult<T & ApiBody>> {
  await flushSignOut();
  const response = await fetch(path, { credentials: "same-origin", ...init });
  const data = parse<T & ApiBody>(await response.text());
  if (response.status === 401 && data.error === "unauthenticated") window.dispatchEvent(new Event(SESSION_ENDED));
  return { status: response.status, data };
}

/** Resolves for every HTTP answer; rejects only when no answer arrived (offline, aborted). */
export function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T & ApiBody>> {
  return request<T>(path, {
    method,
    headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function upload<T>(path: string, data: Blob, headers: Record<string, string>): Promise<ApiResult<T & ApiBody>> {
  return request<T>(path, { method: "PUT", headers, body: data });
}

export const succeeded = (status: number): boolean => status === 200 || status === 201;

/** A device-made id: a version 4 UUID from the browser's random source (works outside secure contexts too). */
export function deviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
