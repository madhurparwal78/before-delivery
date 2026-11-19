import type { LiveMessage } from "../shared/api";
import { createStore } from "./store";

const RECONNECT_MS = 2000;

/** Whether the live channel is down; the info strip turns this into the Service notice. */
export const liveChannel = createStore({ paused: false });

const messageListeners = new Set<(message: LiveMessage) => void>();
const catchUpListeners = new Set<() => void>();

export function onLiveMessage(listener: (message: LiveMessage) => void): () => void {
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

/** Runs after the channel comes back, so a screen can re-read what it missed. */
export function onLiveCatchUp(listener: () => void): () => void {
  catchUpListeners.add(listener);
  return () => catchUpListeners.delete(listener);
}

let socket: WebSocket | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;
let wanted = false;
let missedSomething = false;

function connect(): void {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const next = new WebSocket(`${scheme}://${window.location.host}/api/live`);
  socket = next;
  next.onopen = () => {
    liveChannel.set({ paused: false });
    if (missedSomething) catchUpListeners.forEach((listener) => listener());
    missedSomething = false;
  };
  next.onmessage = (event: MessageEvent<string>) => {
    const message = JSON.parse(event.data) as LiveMessage;
    messageListeners.forEach((listener) => listener(message));
  };
  next.onclose = () => {
    if (socket !== next) return;
    socket = null;
    if (!wanted) return;
    missedSomething = true;
    liveChannel.set({ paused: true });
    retry = setTimeout(connect, RECONNECT_MS);
  };
}

export function startLive(): void {
  if (wanted) return;
  wanted = true;
  connect();
}

export function stopLive(): void {
  wanted = false;
  missedSomething = false;
  if (retry) clearTimeout(retry);
  retry = null;
  const closing = socket;
  socket = null;
  closing?.close();
  liveChannel.set({ paused: false });
}
