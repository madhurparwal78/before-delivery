import { useEffect, useRef } from "preact/hooks";
import type { LiveMessage } from "../shared/api.ts";

// One same-origin WebSocket per open page. Every (re)connect re-reads the page, so nothing is missed.
type Listener = (message: LiveMessage) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

function emit(message: LiveMessage): void {
  for (const listener of listeners) listener(message);
}

export function connectLive(): void {
  if (socket) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/live`);
  socket = ws;
  ws.onopen = () => emit({ t: "gameweek" });
  ws.onmessage = (event) => emit(JSON.parse(String(event.data)) as LiveMessage);
  ws.onclose = () => {
    socket = null;
    setTimeout(connectLive, 1000);
  };
}

export function useLive(listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const relay: Listener = (message) => latest.current(message);
    listeners.add(relay);
    return () => void listeners.delete(relay);
  }, []);
}
