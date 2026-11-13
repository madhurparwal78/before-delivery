import { useEffect, useRef } from "react";
import { LIVE_TYPES, type LiveEvents } from "../shared/live";

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let source: EventSource | undefined;
let recovering = false;

/** True from a lost connection until the stream says how it resumed: events in between are a replay. */
export const isRecovering = (): boolean => recovering;

/**
 * The first stream of a page opens once the page has been quiet for a moment: a stream open from the first request keeps
 * the network busy for ever, so a visitor (or a probe) waiting for the network to settle never sees the page done.
 * Nothing is missed meanwhile: it resumes after the event id the page shell was served with. The delay runs on an
 * animation timeline (real time even when a page's timers are held) with a timer as the fallback.
 */
const SETTLE_MS = 1500;
const BOOT_WINDOW_MS = 5000;
let subscribers = 0;
let pending = false;

function connect(resumeAfter?: string): void {
  source?.close();
  const stream = new EventSource(resumeAfter ? `/api/live?after=${resumeAfter}` : "/api/live");
  source = stream;
  stream.addEventListener("error", () => {
    recovering = true;
  });
  for (const type of LIVE_TYPES) {
    stream.addEventListener(type, (event) => {
      const data: unknown = JSON.parse((event as MessageEvent<string>).data);
      listeners.get(type)?.forEach((listener) => listener(data));
      if (type === "hello") recovering = false;
    });
  }
}

function connectSoon(): void {
  if (source || pending) return;
  if (performance.now() > BOOT_WINDOW_MS) {
    connect();
    return;
  }
  pending = true;
  const open = () => {
    pending = false;
    if (!source) connect(document.querySelector<HTMLMetaElement>('meta[name="cb-live-after"]')?.content);
  };
  window.setTimeout(open, SETTLE_MS * 3);
  const root = document.documentElement;
  if (typeof root.animate === "function") {
    root.animate([{ opacity: 1 }, { opacity: 1 }], { duration: SETTLE_MS }).onfinish = () => {
      if (pending) open();
    };
  }
}

/** The viewer changed: an open stream is bound to the old viewer, so it reconnects as the new one. */
export function openLive(): void {
  if (source) connect();
  else if (subscribers > 0) connectSoon();
}

function onLive<K extends keyof LiveEvents>(type: K, handler: (data: LiveEvents[K]) => void): () => void {
  const wrapped: Listener = (data) => handler(data as LiveEvents[K]);
  const set = listeners.get(type) ?? new Set<Listener>();
  set.add(wrapped);
  listeners.set(type, set);
  return () => set.delete(wrapped);
}

/** Subscribes a component to one live event type for as long as it is mounted. */
export function useLive<K extends keyof LiveEvents>(type: K, handler: (data: LiveEvents[K]) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const off = onLive(type, (data) => latest.current(data));
    subscribers += 1;
    connectSoon();
    return () => {
      subscribers -= 1;
      off();
    };
  }, [type]);
}

/** Runs `reload` when the stream resumes without a replay (a first connect, or too many missed events). */
export function useLiveReload(reload: () => void): void {
  useLive("hello", (data) => {
    if (data.replay === "reload") reload();
  });
}
