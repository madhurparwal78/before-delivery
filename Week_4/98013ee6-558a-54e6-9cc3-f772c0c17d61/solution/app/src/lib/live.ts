import { isRecord } from "../../shared/guards";
import { syncClock } from "./clock";
import type { ClientMessage, LiveMessage } from "../../shared/types";

type Listener = (message: LiveMessage) => void;

/** Every server message is an object with a string `type`; the handlers read the rest by that type. */
const isLiveMessage = (value: unknown): value is LiveMessage => isRecord(value) && typeof value["type"] === "string";

const listeners = new Set<Listener>();
const watching = new Map<string, { message: ClientMessage; count: number }>();
let socket: WebSocket | null = null;
let wanted = false;

const keyOf = (message: ClientMessage): string => JSON.stringify({ ...message, type: "watch" });

function open(): void {
  if (!wanted || socket) return;
  const url = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/live`;
  const next = new WebSocket(url);
  socket = next;
  next.addEventListener("open", () => {
    for (const { message } of watching.values()) next.send(JSON.stringify(message));
  });
  next.addEventListener("message", (event: MessageEvent<string>) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!isLiveMessage(parsed)) return;
    if (parsed.type === "clock") syncClock(parsed.now);
    listeners.forEach((listener) => listener(parsed));
  });
  next.addEventListener("close", () => {
    socket = null;
    if (wanted) setTimeout(open, 1000);
  });
}

export function connectLive(): void {
  wanted = true;
  open();
}

export function disconnectLive(): void {
  wanted = false;
  watching.clear();
  socket?.close();
  socket = null;
}

/** Watches a board, pin, user or the feed until the returned function is called. Watches are shared and counted. */
type WatchTarget = { board: number } | { pin: number } | { user: number } | { feed: true };

export function watch(target: WatchTarget): () => void {
  const message: ClientMessage = { type: "watch", ...target };
  const key = keyOf(message);
  const entry = watching.get(key);
  if (entry) entry.count += 1;
  else {
    watching.set(key, { message, count: 1 });
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  return () => {
    const held = watching.get(key);
    if (!held) return;
    held.count -= 1;
    if (held.count > 0) return;
    watching.delete(key);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ ...message, type: "unwatch" }));
  };
}

export function onLive(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
