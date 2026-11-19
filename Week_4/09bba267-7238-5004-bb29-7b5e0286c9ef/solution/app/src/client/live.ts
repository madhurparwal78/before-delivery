// Live updates: one same-origin WebSocket per page. Views refetch when an event concerns them; a reconnect asks
// every view to refetch, since events may have been missed meanwhile.
import { useEffect, useRef } from "preact/hooks";
import type { LiveEvent } from "../shared/types.js";

type ClientEvent = LiveEvent | { type: "resync" };

const listeners = new Set<(event: ClientEvent) => void>();
let socket: WebSocket | null = null;
let socketOffer: string | null = null;

function dispatch(event: ClientEvent): void {
  for (const listener of [...listeners]) listener(event);
}

/**
 * Opens (or reopens, when the offer shown changes) the page's same-origin WebSocket; offer pages also hear about
 * their offer. After a dropped connection it reconnects and asks every view to refetch what it may have missed.
 */
export function connectLive(offerToken: string | null): void {
  if (socket && socketOffer === offerToken) return;
  const previous = socket;
  socket = null;
  previous?.close();
  socketOffer = offerToken;
  const open = (resync: boolean): void => {
    const query = offerToken ? `?offer=${encodeURIComponent(offerToken)}` : "";
    const next = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/events${query}`);
    next.onopen = () => {
      if (resync) dispatch({ type: "resync" });
    };
    next.onmessage = (message: MessageEvent<string>) => dispatch(JSON.parse(message.data) as LiveEvent);
    next.onclose = () => {
      if (socket === next) setTimeout(() => open(true), 1000);
    };
    socket = next;
  };
  open(false);
}

/** Calls the latest `handler` for every live event while the component is mounted. */
export function useLive(handler: (event: ClientEvent) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener = (event: ClientEvent): void => latest.current(event);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
}

/**
 * Returns `refresh()`, which runs `load` but never twice at once: a refresh asked for while a load runs starts one
 * more load when it ends, so the view always ends on the newest server state.
 */
export function useLoader(load: () => Promise<void>): () => void {
  const state = useRef({ running: false, again: false });
  const latest = useRef(load);
  latest.current = load;
  const refresh = useRef(() => {
    const s = state.current;
    if (s.running) {
      s.again = true;
      return;
    }
    s.running = true;
    void latest.current().finally(() => {
      s.running = false;
      if (s.again) {
        s.again = false;
        refresh.current();
      }
    });
  });
  return refresh.current;
}
