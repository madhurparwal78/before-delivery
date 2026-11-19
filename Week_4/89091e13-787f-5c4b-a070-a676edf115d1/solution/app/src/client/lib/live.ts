import type { LiveEvent } from "../../shared/api.ts";

const RECONNECT_MS = 1500;

type Item = LiveEvent | "open";

let current: { id: string; socket: WebSocket; retry: number } | null = null;
let sink: ((item: Item) => void) | null = null;
const backlog: Item[] = [];

function deliver(item: Item): void {
  if (sink) sink(item);
  else backlog.push(item);
}

function open(id: string): void {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${scheme}://${window.location.host}/api/w/${id}/live`);
  const channel = { id, socket, retry: 0 };
  current = channel;
  socket.addEventListener("open", () => deliver("open"));
  socket.addEventListener("message", (message) => deliver(JSON.parse(String(message.data)) as LiveEvent));
  socket.addEventListener("close", () => {
    if (current === channel) channel.retry = window.setTimeout(() => open(id), RECONNECT_MS);
  });
}

/** Opens the workspace's live channel once; events that arrive before anything listens wait in a backlog. */
export function connectLive(id: string): void {
  if (current?.id === id) return;
  closeLive();
  open(id);
}

export function closeLive(): void {
  if (!current) return;
  const { socket, retry } = current;
  current = null;
  window.clearTimeout(retry);
  socket.close();
  backlog.length = 0;
}

/** Hands the backlog and then every later item to `handler`: `"open"` after each (re)connection, then each event. */
export function listenLive(handler: (item: Item) => void): () => void {
  sink = handler;
  backlog.splice(0).forEach(handler);
  return () => {
    sink = null;
  };
}
