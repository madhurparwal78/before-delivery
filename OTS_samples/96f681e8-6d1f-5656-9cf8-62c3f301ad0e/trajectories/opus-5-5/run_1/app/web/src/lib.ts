import { useEffect, useRef, useState } from "preact/hooks";

export type Me = {
  username: string;
  name: string;
  email: string;
  roles: string[];
  level: number | null;
  coach_id: string | null;
  push_topic: string | null;
};

export type Club = {
  timezone: string;
  hold_seconds: number;
  match_cutoff_seconds: number;
  free_cancel_seconds: number;
  share_settle_seconds: number;
  late_fee_percent: number;
  rule_description: string;
  opening_hours: string;
  coaches: { coach_id: string; name: string; level_min: number; level_max: number; line: string }[];
};

export type ApiError = { code: string; message: string; errors?: Record<string, string> };

export type Answer<T> = { status: number; data: T; error: ApiError | null; headers: Headers };

/** status 0 means the request got no answer at all. */
export async function api<T = any>(method: string, path: string, body?: unknown, key?: string): Promise<Answer<T>> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  let resp: Response;
  try {
    resp = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { status: 0, data: null as T, error: null, headers: new Headers() };
  }
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    data = null;
  }
  const error = resp.ok ? null : (data as ApiError) ?? { code: "UNKNOWN", message: "Something went wrong. Try again." };
  return { status: resp.status, data, error, headers: resp.headers };
}

export const get = <T = any>(path: string) => api<T>("GET", path);

/**
 * A request key for one async action: the same key is sent again only when the
 * previous press answered 503 or got no answer, with the same body.
 */
export class RequestKey {
  private key = "";
  private body = "";
  private reusable = false;
  next(body: unknown): string {
    const b = JSON.stringify(body);
    if (!this.reusable || b !== this.body) this.key = crypto.randomUUID();
    this.body = b;
    return this.key;
  }
  settle(status: number) {
    this.reusable = status === 0 || status === 503;
  }
}

export function loginURL(returnPath: string) {
  return "/login?return=" + encodeURIComponent(returnPath);
}

export function goSignIn(returnPath = location.pathname + location.search) {
  location.assign(loginURL(returnPath));
}

export const networkMessage = "We could not reach the club. Check your connection and try again.";

export function errorText(a: Answer<unknown>): string {
  if (a.status === 0) return networkMessage;
  return a.error?.message ?? "Something went wrong. Try again.";
}

// ---- club time ----

let clubZone = "Europe/Madrid";
let serverOffset = 0;

export function setClubZone(z: string) {
  clubZone = z;
}

/** Records the server clock from an answer, so "today" never depends on the device clock. */
export function syncServerClock(serverNow: string | undefined) {
  if (serverNow) serverOffset = Date.parse(serverNow) - Date.now();
}

export function serverNowMs() {
  return Date.now() + serverOffset;
}

function parts(ms: number) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: clubZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value;
  return p;
}

export function clubDate(iso: string | number) {
  const p = parts(typeof iso === "number" ? iso : Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}`;
}

export function clubTime(iso: string | number) {
  const p = parts(typeof iso === "number" ? iso : Date.parse(iso));
  return `${p.hour}:${p.minute}`;
}

export function clubDateTime(iso: string) {
  return `${clubDate(iso)} ${clubTime(iso)}`;
}

export function todayClub() {
  return clubDate(serverNowMs());
}

export function addDays(date: string, n: number) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function validDate(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export const dateMessage = "Use a date like 2027-03-28.";

export function euros(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(cents);
  return `${sign}€${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

export function mmss(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function level(v: number) {
  return v.toFixed(1);
}

export function codePoints(s: string) {
  return Array.from(s).length;
}

/** Writes seconds in the largest of hours, minutes and seconds that divides them evenly. */
export function durationPhrase(secs: number) {
  let n = secs;
  let unit = "second";
  if (secs % 3600 === 0) {
    n = secs / 3600;
    unit = "hour";
  } else if (secs % 60 === 0) {
    n = secs / 60;
    unit = "minute";
  }
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// ---- announcements ----

type Listener = (text: string) => void;
let announceListener: Listener = () => {};
const queue: string[] = [];
let busyUntil = 0;
let timer: number | undefined;

export function onAnnounce(l: Listener) {
  announceListener = l;
}

/** Queues one status announcement; each one stays readable for a moment before the next. */
export function announce(text: string) {
  queue.push(text);
  pump();
}

function pump() {
  if (timer !== undefined) return;
  const wait = Math.max(0, busyUntil - performance.now());
  timer = window.setTimeout(() => {
    timer = undefined;
    const next = queue.shift();
    if (next === undefined) return;
    announceListener("");
    window.setTimeout(() => announceListener(next), 30);
    busyUntil = performance.now() + 1500;
    if (queue.length) pump();
  }, wait);
}

export function clearAnnouncements() {
  queue.length = 0;
  announceListener("");
}

// ---- routing ----

type RouteListener = () => void;
const routeListeners = new Set<RouteListener>();

export function navigate(url: string, replace = false) {
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  routeListeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

window.addEventListener("popstate", () => routeListeners.forEach((l) => l()));

export function useLocation() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    routeListeners.add(l);
    return () => {
      routeListeners.delete(l);
    };
  }, []);
  return { path: location.pathname, query: new URLSearchParams(location.search) };
}

export function onLinkClick(e: MouseEvent) {
  const a = (e.target as HTMLElement).closest("a");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute("href");
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/login") || a.target) return;
  if (href.includes("#")) return;
  e.preventDefault();
  navigate(href);
}

// ---- hooks ----

export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = window.setInterval(() => ref.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

export function useReducedMotion() {
  const q = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const l = () => setReduced(m.matches);
    m.addEventListener("change", l);
    return () => m.removeEventListener("change", l);
  }, []);
  return reduced;
}

export function useWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const l = () => setW(window.innerWidth);
    window.addEventListener("resize", l);
    return () => window.removeEventListener("resize", l);
  }, []);
  return w;
}

/** Keeps Tab and Shift+Tab inside a dialog, closes it on Escape. */
export function trapKeys(e: KeyboardEvent, root: HTMLElement | null, close: () => void) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    close();
    return;
  }
  if (e.key !== "Tab" || !root) return;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>(
      'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

export const statusWords: Record<string, string> = {
  held: "Held",
  paid: "Paid",
  released: "Released",
  open: "Open",
  "checked-in": "Checked in",
  "no-show": "No-show",
  cancelled: "Cancelled",
  full: "Full",
};

export const paymentWords: Record<string, string> = { due: "Due", paid: "Paid", void: "Void", covered: "Covered" };

export const levelOptions = Array.from({ length: 13 }, (_, i) => 1 + i * 0.5);

export const DRAFT_KEY = "yardline-slot-draft";
