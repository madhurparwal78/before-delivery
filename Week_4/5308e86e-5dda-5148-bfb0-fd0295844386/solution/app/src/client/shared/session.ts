/** The browser session: the stored token, the last opened account, and what ends a session. */
import { DEFAULT_LANDING, safeNext } from "../../shared/redirect.js";

const TOKEN_KEY = "tallwind.token";
const ACCOUNT_KEY = "tallwind.lastAccount";

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function storeSession(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function rememberAccount(id: string): void {
  localStorage.setItem(ACCOUNT_KEY, id);
}

export function clearStored(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_KEY);
}

/** Where to go after signing in: the safe `next` of this address, else the cockpit home. */
export function landingAfterSignIn(): string {
  return safeNext(new URLSearchParams(location.search).get("next")) ?? DEFAULT_LANDING;
}

export function loginAddress(next: string): string {
  return `/login?next=${encodeURIComponent(next)}`;
}

/** The session has ended on this page: nothing may be sent, painted or retried any more. */
export const ending = { ended: false };

const disposers: Array<() => void> = [];

/** Registers something that must stop when the session ends (timers, streams, in-flight requests). */
export function onSessionEnd(stop: () => void): void {
  disposers.push(stop);
}

function stopEverything(): void {
  ending.ended = true;
  for (const stop of disposers.splice(0)) stop();
}

/** The server refused our token: replace this page with Log in, carrying where we were. Happens once. */
export function revoke(): void {
  if (ending.ended) return;
  stopEverything();
  clearStored();
  location.replace(loginAddress(location.pathname + location.search));
}

/** The user pressed Log out. */
export async function signOut(): Promise<void> {
  if (ending.ended) return;
  const token = storedToken();
  stopEverything();
  clearStored();
  if (token) {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` }, keepalive: true });
    } catch {
      // The token is already gone from this browser; the server expires nothing else.
    }
  }
  location.replace("/");
}
