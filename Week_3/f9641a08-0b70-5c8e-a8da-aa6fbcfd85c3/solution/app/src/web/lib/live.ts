import { useEffect, useRef } from "react";
import type { LiveEventType, LiveEvents } from "../../shared/api";
import { applyWishlist, refreshCart, refreshMe, refreshWishlist, setState } from "./store";

// One EventSource per tab, starting after the sequence the page shell was served with, so nothing
// that changed while the page booted is missed. The browser reconnects by itself and resumes from the last event id.

type Handler<T extends LiveEventType> = (data: LiveEvents[T]) => void;
type AnyHandler = (data: never) => void;

const handlers = new Map<LiveEventType | "reset", Set<AnyHandler>>();
let source: EventSource | null = null;

function dispatch(type: LiveEventType | "reset", data: unknown): void {
  handlers.get(type)?.forEach((h) => (h as (d: unknown) => void)(data));
}

const TYPES: LiveEventType[] = ["stock", "price", "collection", "order", "return", "trial", "warranty", "cart", "wishlist", "notification", "queue"];

// The stream opens once the page has been quiet for a moment: a stream that is open from the first request keeps the
// network busy for ever, so a page that waits for the network to settle never gets to see it done. The delay runs on
// an animation timeline (real time even when a page's timers are held) with a timer as the fallback; nothing is
// missed meanwhile, because the stream resumes from the sequence the page shell carries.
const SETTLE_MS = 1500;
let pending = false;

export function startLive(): void {
  if (source || pending) return;
  pending = true;
  const open = () => {
    if (!source) connect();
  };
  window.setTimeout(open, SETTLE_MS * 3);
  const root = document.documentElement;
  if (typeof root.animate === "function") root.animate([{ opacity: 1 }, { opacity: 1 }], { duration: SETTLE_MS }).onfinish = open;
}

function connect(): void {
  const after = document.querySelector<HTMLMetaElement>('meta[name="live-after"]')?.content;
  source = new EventSource(after ? `/api/live?after=${after}` : "/api/live");
  source.onopen = () => setState({ connected: true });
  source.onerror = () => setState({ connected: false });
  for (const type of TYPES) {
    source.addEventListener(type, (event) => dispatch(type, JSON.parse((event as MessageEvent<string>).data)));
  }
  source.addEventListener("reset", () => {
    void Promise.all([refreshCart(), refreshMe(), refreshWishlist()]);
    dispatch("reset", null);
  });
  add("wishlist", ((data: LiveEvents["wishlist"]) => applyWishlist(data)) as AnyHandler);
  add("cart", (() => void refreshCart()) as AnyHandler);
}

function add(type: LiveEventType | "reset", handler: AnyHandler): () => void {
  let set = handlers.get(type);
  if (!set) {
    set = new Set();
    handlers.set(type, set);
  }
  set.add(handler);
  return () => set.delete(handler);
}

/** Calls `handler` for every live event of `type` while the component is mounted. */
export function useLive<T extends LiveEventType>(type: T, handler: Handler<T>): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => add(type, ((data: LiveEvents[T]) => latest.current(data)) as AnyHandler), [type]);
}

/** Calls `handler` after a `reset` (the stream was too far behind to resume). */
export function useLiveReset(handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => add("reset", (() => latest.current()) as AnyHandler), []);
}
