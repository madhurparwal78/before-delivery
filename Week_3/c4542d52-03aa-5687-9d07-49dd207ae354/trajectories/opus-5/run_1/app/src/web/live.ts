import type { LiveEvent } from "../shared/types.js";

type EventListener = (event: LiveEvent) => void;
type StateListener = (open: boolean) => void;

const eventListeners = new Set<EventListener>();
const stateListeners = new Set<StateListener>();

let socket: WebSocket | null = null;
let lastSequence = 0;
let open = false;
let serverTime = new Date();
let reconnectTimer: number | null = null;

export function serverNow(): Date {
  return serverTime;
}

export function isSocketOpen(): boolean {
  return open;
}

export function onLiveEvent(listener: EventListener): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

export function onSocketState(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

function setOpen(value: boolean): void {
  if (open === value) return;
  open = value;
  for (const listener of stateListeners) listener(value);
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connectLive();
  }, 1500);
}

/** One socket per page: it is only read from, never written to. */
export function connectLive(): void {
  if (socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const url = new URL("/api/live", window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  if (lastSequence > 0) url.searchParams.set("since", String(lastSequence));
  const connection = new WebSocket(url.href);
  socket = connection;
  connection.addEventListener("open", () => setOpen(true));
  connection.addEventListener("close", () => {
    setOpen(false);
    scheduleReconnect();
  });
  connection.addEventListener("error", () => {
    connection.close();
  });
  connection.addEventListener("message", (message: MessageEvent<string>) => {
    const event = JSON.parse(message.data) as LiveEvent;
    if (event.type === "clock") {
      const value = event.data["server_time"];
      if (typeof value === "string") serverTime = new Date(value);
      for (const listener of eventListeners) listener(event);
      return;
    }
    if (event.seq <= lastSequence) return;
    lastSequence = event.seq;
    serverTime = new Date(event.at);
    for (const listener of eventListeners) listener(event);
  });
}

export function closeLive(): void {
  if (reconnectTimer !== null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  const connection = socket;
  socket = null;
  setOpen(false);
  if (connection !== null) connection.close();
}
