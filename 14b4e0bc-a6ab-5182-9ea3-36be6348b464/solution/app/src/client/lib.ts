import { useLayoutEffect, useReducer } from "preact/hooks";

export type Role = "Admin" | "Steward" | "Analyst" | "Viewer";
export type Tag = "PII" | "Confidential";
export const TAGS: Tag[] = ["PII", "Confidential"];

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export const mayCurate = (role: Role) => role === "Admin" || role === "Steward";
export const isAdmin = (role: Role) => role === "Admin";

/** A small observable value shared by screens. */
interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(fn: () => void): () => void;
}

export function store<T>(initial: T): Store<T> {
  let value = initial;
  const subscribers = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      value = next;
      for (const fn of [...subscribers]) fn();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

export function useStore<T>(s: Store<T>): T {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => s.subscribe(() => force(undefined)), [s]);
  return s.get();
}

export const enc = (id: string) => encodeURIComponent(id);

export class ApiFailure extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields: Record<string, string> = {}) {
    super(message);
  }
}

/** After sign-in, any 401 ends the visit on the sign-in screen with the session-ended copy. */
export function sessionEnded(): void {
  sessionStorage.setItem("strata-session-ended", "1");
  location.assign("/signin");
}

export async function api<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const init: RequestInit = { method, headers: { ...headers }, credentials: "same-origin" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFailure(0, "network", "The request could not reach Strata. Try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (res.ok) return data as T;
  if (res.status === 401 && !(method === "POST" && path === "/api/session")) sessionEnded();
  const error = data?.error ?? {};
  throw new ApiFailure(res.status, error.code ?? "unknown", error.message ?? "Something went wrong. Try again.", error.fields ?? {});
}

export function newKey(): string {
  return crypto.randomUUID();
}

/** `YYYY-MM-DD HH:mm:ss.sss UTC±HH:MM` in the viewer's own zone, from the `at` string alone (DP-51). */
export function viewerTime(at: string): string {
  const d = new Date(at);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)} UTC${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

const chicago = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", timeZoneName: "longOffset" });

function chicagoOffsetMinutes(instant: number): number {
  const name = chicago.formatToParts(new Date(instant)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
}

/**
 * Business time (DP-88): an America/Chicago wall time to an RFC 3339 time with the offset in force,
 * the earlier offset on a repeated hour, shifted forward across a skipped hour. Null when malformed.
 */
export function businessTime(wall: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const probe = new Date(asUtc);
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  const candidates = [...new Set([chicagoOffsetMinutes(asUtc - 6 * 3600_000), chicagoOffsetMinutes(asUtc + 6 * 3600_000)])].sort((a, b) => b - a);
  const valid = candidates.filter((o) => chicagoOffsetMinutes(asUtc - o * 60_000) === o);
  let offset: number;
  let wallMs = asUtc;
  if (valid.length) offset = valid[0];
  else {
    offset = candidates[0];
    wallMs = asUtc + (candidates[0] - candidates[candidates.length - 1]) * 60_000;
  }
  const w = new Date(wallMs);
  const p = (n: number) => String(n).padStart(2, "0");
  const abs = Math.abs(offset);
  return `${w.getUTCFullYear()}-${p(w.getUTCMonth() + 1)}-${p(w.getUTCDate())}T${p(w.getUTCHours())}:${p(w.getUTCMinutes())}:${p(w.getUTCSeconds())}${offset >= 0 ? "+" : "-"}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

/** Pending render work flushes on microtasks (never on timers: the page clock may be paused); this resolves after it. */
export function afterRender(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve()).then(() => undefined);
}
