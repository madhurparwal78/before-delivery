/** The server-sent event stream and the page state it updates. */
import { state, serverNow } from "./i18n.js";

type Handler = (name: string, data: Record<string, unknown>) => void;
const handlers = new Map<Handler, string | null>();

/** Subscribe to one event name, or to all events when the name is omitted. */
export function onEvent(h: Handler, name?: string): () => void {
  handlers.set(h, name ?? null);
  return () => { handlers.delete(h); };
}

let es: EventSource | null = null;
let retryTimer: number | null = null;

function dispatch(name: string, raw: string): void {
  let data: Record<string, unknown> = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { /* ignore malformed */ }
  if (name === "clock" && typeof data.now === "string") {
    state.serverNow = Date.parse(data.now);
    state.serverNowAt = Date.now();
  }
  if (name === "account.changed") {
    if (typeof data.lang === "string") state.lang = data.lang as typeof state.lang;
    if (typeof data.cur === "string") state.cur = data.cur as typeof state.cur;
    if (typeof data.tier === "string") state.tier = data.tier;
    if (typeof data.completed_stays === "number") state.completedStays = data.completed_stays;
  }
  for (const [h, want] of handlers) { if (want === null || want === name) h(name, data); }
}

export function connectEvents(): void {
  if (es) return;
  es = new EventSource("/api/events");
  for (const name of ["clock", "availability", "quote.changed", "hold.expired", "account.changed"]) {
    es.addEventListener(name, (ev) => dispatch(name, (ev as MessageEvent).data));
  }
  es.onerror = () => {
    es?.close();
    es = null;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = window.setTimeout(connectEvents, 2000);
  };
}

export async function syncTime(): Promise<void> {
  try {
    const res = await fetch("/api/time");
    const data = await res.json() as { now: string };
    state.serverNow = Date.parse(data.now);
    state.serverNowAt = Date.now();
  } catch { /* offline; keep last known */ }
}

/** Remaining hold time in whole seconds, rounded up, never below zero. */
export function holdSecondsLeft(expiresAt: string): number {
  const ms = Date.parse(expiresAt) - serverNow().getTime();
  return Math.max(0, Math.ceil(ms / 1000));
}
