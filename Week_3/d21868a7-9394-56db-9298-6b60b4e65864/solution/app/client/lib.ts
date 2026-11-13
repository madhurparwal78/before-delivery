// Client plumbing: the API wrapper, the router, polling and display formatting. No domain rule lives
// here: every figure, status and rate shown comes from the server as it sent it.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { signInFor, type Role } from "../shared/roles.ts";

interface ApiErrorBody {
  error?: string;
  message?: string;
  errors?: Record<string, string>;
  [extra: string]: unknown;
}

export type Reply<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiErrorBody };

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<Reply<T>> {
  const method = options.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(options.body ?? {}),
    });
  } catch {
    return { ok: false, status: 0, error: { error: "offline", message: "The server is not answering. Check the connection and try again." } };
  }
  // Signing in, and the app's own "who is signed in" probe (App decides from it), are not open screens.
  if (response.status === 401 && path !== "/api/session" && path !== "/api/me" && location.pathname !== "/sign-in") endSession();
  const type = response.headers.get("content-type") ?? "";
  const payload: unknown = type.includes("application/json") ? await response.json() : await response.text();
  if (response.ok) return { ok: true, status: response.status, data: payload as T };
  return { ok: false, status: response.status, error: (typeof payload === "object" && payload ? payload : {}) as ApiErrorBody };
}

/** An ended session: the open screen goes to sign-in with its return path (Signed-out rule), and
 * screens that keep a draft hear about it first. */
export const SESSION_ENDED = "ditchbook:session-ended";
function endSession(): void {
  window.dispatchEvent(new Event(SESSION_ENDED));
  navigate(signInFor(location.pathname + location.search), true);
}

// Router: the address bar is the state; pushState adds one history entry per change.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());
window.addEventListener("popstate", notify);

/** Goes to `to`, adding one history entry (or replacing the current one). A move to the address
 * already shown does nothing unless `always` is set (Show totals adds one entry per press). */
export function navigate(to: string, replace = false, always = false): void {
  if (!always && to === location.pathname + location.search) return;
  history[replace ? "replaceState" : "pushState"](null, "", to);
  notify();
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
}

// First paint: the first screen of a load stays hidden until its first loads have answered and the
// fonts are in, so it appears whole instead of growing and reflowing under the reader.
let firstLoads = 0;
let revealed = false;
const revealListeners = new Set<() => void>();
const reveal = () => {
  if (revealed) return;
  revealed = true;
  revealListeners.forEach((listener) => listener());
};
setTimeout(reveal, 4000);
// A task hop that a paused page clock cannot hold back (timers can be frozen; message events are not).
const nextTask = () =>
  new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
function settleFirstPaint() {
  if (revealed || firstLoads > 0) return;
  // A load that answers can start the next one (an order, then its window): let React render and run
  // its effects for a couple of tasks before deciding nothing else is loading.
  void nextTask()
    .then(nextTask)
    .then(() => document.fonts.ready)
    .then(() => firstLoads === 0 && reveal());
}

/** For a screen's <main>: false until its first loads have answered (it renders hidden till then). */
export function useRevealed(): boolean {
  useEffect(settleFirstPaint, []);
  return useSyncExternalStore(
    (listener) => {
      revealListeners.add(listener);
      return () => revealListeners.delete(listener);
    },
    () => revealed,
  );
}

/** Every poll request takes the next number when it starts, so a screen can tell whether a reply it
 * shows was asked for after some moment (`pollMark()`). */
let pollSequence = 0;
export const pollMark = () => pollSequence;

/** Loads now, then again every `intervalMs` and whenever `reload` is called (Live updates). */
export function usePoll<T>(load: () => Promise<Reply<T>>, deps: readonly unknown[], intervalMs = 2000) {
  const [reply, setReply] = useState<Reply<T> | null>(null);
  const [seq, setSeq] = useState(0);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let holding = !revealed;
    if (holding) firstLoads += 1;
    const release = () => {
      if (!holding) return;
      holding = false;
      firstLoads -= 1;
      settleFirstPaint();
    };
    const run = async () => {
      const asked = ++pollSequence;
      const next = await loadRef.current();
      if (!alive) return;
      if (next.ok || next.status !== 0) {
        setReply(next);
        setSeq(asked);
      }
      release();
      timer = setTimeout(run, intervalMs);
    };
    void run();
    return () => {
      alive = false;
      release();
      clearTimeout(timer);
    };
  }, [...deps, tick, intervalMs]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data: reply?.ok ? reply.data : null, failure: reply && !reply.ok ? reply : null, reload, seq };
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = matchMedia(query);
      list.addEventListener("change", listener);
      return () => list.removeEventListener("change", listener);
    },
    () => matchMedia(query).matches,
  );
}

export type Layout = "phone" | "tablet" | "desk";

export function useLayout(): Layout {
  const desk = useMedia("(min-width: 1100px)");
  const tablet = useMedia("(min-width: 600px)");
  return desk ? "desk" : tablet ? "tablet" : "phone";
}

export const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");

// Display only: three-decimal strings from the server tweened in integer thousandths.
export function toMilli(text: string): bigint {
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const value = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
  return negative ? -value : value;
}

export function fromMilli(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const size = value < 0n ? -value : value;
  return `${sign}${size / 1000n}.${(size % 1000n).toString().padStart(3, "0")}`;
}

export const capitalised = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

/** What Order status announces when the server changes one of the grower's orders. */
function orderChangedCopy(o: { number: string; status: string; conflict: string | null }): string {
  return o.status === "closed" && o.conflict === "lapsed"
    ? `Order ${o.number} lapsed when the window closed.`
    : `Order ${o.number} is now ${capitalised(o.status)}.`;
}

/** Calls `announce` with the copy for each order whose server status changed since the last reply
 * (orders seen for the first time are not changes). */
export function useOrderChanges(
  orders: readonly { number: string; status: string; conflict: string | null }[] | undefined,
  announce: (copy: string) => void,
): void {
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!orders) return;
    const before = seen.current;
    seen.current = new Map(orders.map((o) => [o.number, o.status]));
    if (!before) return;
    const changed = orders.filter((o) => before.has(o.number) && before.get(o.number) !== o.status);
    if (changed.length) announce(changed.map(orderChangedCopy).join(" "));
  }, [orders]);
}

export const WINDOW_STATUS_LABEL: Record<string, string> = {
  upcoming: "Not yet open",
  open: "Open",
  closing: "Closing: final 30 minutes",
  closed: "Closed",
};

const shortStamp = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** A server instant shown in the district zone, for record details. */
export const districtTime = (iso: string) => shortStamp.format(new Date(iso));

export const ROLE_LABEL: Record<Role, string> = {
  grower: "Grower",
  operator: "Channel operator",
  dispatcher: "Dispatcher",
  clerk: "Records clerk",
  reviewer: "Regulator reviewer",
};

/** One-shot announcements carried across a navigation (the next screen's live region shows them). */
const flashes = new Map<string, string>();
export const setFlash = (key: string, text: string) => flashes.set(key, text);
export function takeFlash(key: string): string {
  const text = flashes.get(key) ?? "";
  flashes.delete(key);
  return text;
}
