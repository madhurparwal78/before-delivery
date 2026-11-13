// Browser side of the API: one fetch wrapper, the session and service stores.
import { useSyncExternalStore } from "react";
import type { ApiErrorBody, Services, User } from "../shared/api";
import type { Unit } from "../shared/domain";

type Result<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

const NETWORK_ERROR: ApiErrorBody = { error: "network", message: "The server could not be reached." };

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Result<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? headers : { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (response.ok) return { ok: true, status: response.status, data: parsed as T };
  const error = typeof parsed === "object" && parsed !== null && "error" in parsed ? (parsed as ApiErrorBody) : { error: "unknown", message: text };
  return { ok: false, status: response.status, error };
}

export async function upload<T>(path: string, file: Blob, contentType: string): Promise<Result<T>> {
  try {
    const response = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": contentType }, body: file });
    const parsed: unknown = await response.json().catch(() => null);
    if (response.ok) return { ok: true, status: response.status, data: parsed as T };
    return { ok: false, status: response.status, error: (parsed as ApiErrorBody | null) ?? NETWORK_ERROR };
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }
}

/** A tiny observable value for state shared across screens. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: (): T => value,
    set(next: T): void {
      value = next;
      for (const l of listeners) l();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

// ---- session ----

export const sessionStore = store<{ loaded: boolean; user: User | null }>({ loaded: false, user: null });

export async function loadSession(): Promise<User | null> {
  const r = await api<{ user: User }>("GET", "/api/session");
  const user = r.ok ? r.data.user : null;
  sessionStore.set({ loaded: true, user });
  return user;
}

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get);
}

// ---- services ----

const servicesStore = store<Services>({ billing: "up", storage: "up" });

export async function refreshServices(): Promise<void> {
  const r = await api<Services>("GET", "/api/services");
  if (!r.ok) return;
  const now = servicesStore.get();
  if (now.billing !== r.data.billing || now.storage !== r.data.storage) servicesStore.set(r.data);
}

export function useServices(): Services {
  return useSyncExternalStore(servicesStore.subscribe, servicesStore.get);
}

// ---- units ----

const UNIT_KEY = "kerfwell.units";
const readUnit = (): Unit => (localStorage.getItem(UNIT_KEY) === "in" ? "in" : "mm");
const unitStore = store<Unit>(readUnit());

export function setUnit(unit: Unit): void {
  localStorage.setItem(UNIT_KEY, unit);
  unitStore.set(unit);
}

export function useUnit(): Unit {
  return useSyncExternalStore(unitStore.subscribe, unitStore.get);
}

// ---- navigation ----

const locationStore = store<string>(window.location.pathname + window.location.search);

export function navigate(to: string, replace = false): void {
  if (replace) window.history.replaceState(null, "", to);
  else window.history.pushState(null, "", to);
  window.scrollTo(0, 0);
  locationStore.set(window.location.pathname + window.location.search);
}

window.addEventListener("popstate", () => locationStore.set(window.location.pathname + window.location.search));

export function useLocationPath(): string {
  return useSyncExternalStore(locationStore.subscribe, locationStore.get);
}

export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Sends the visitor to sign in, coming back to `path` afterwards. */
export function signInPath(path: string): string {
  return `/sign-in?next=${encodeURIComponent(path)}`;
}
