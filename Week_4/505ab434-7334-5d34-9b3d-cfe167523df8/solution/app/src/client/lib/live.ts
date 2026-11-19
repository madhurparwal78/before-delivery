// The live channel: one WebSocket to /api/live shared by every subscriber; screens refetch on the messages they name.
import { useEffect, useRef } from "react";
import type { LiveMessage } from "../../shared/api.ts";

type Listener = (message: LiveMessage) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;

function connect(): void {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const next = new WebSocket(`${scheme}://${window.location.host}/api/live`);
  socket = next;
  next.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as LiveMessage;
    listeners.forEach((listener) => listener(message));
  };
  next.onclose = () => {
    if (socket === next) socket = null;
    if (listeners.size > 0) window.setTimeout(() => socket === null && listeners.size > 0 && connect(), 1500);
  };
}

/** Calls `handler` for every live message of the given types while the component is mounted. */
export function useLive(types: readonly LiveMessage["type"][], handler: (message: LiveMessage) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = types.join(",");
  useEffect(() => {
    const listener: Listener = (message) => {
      if (key.split(",").includes(message.type)) latest.current(message);
    };
    listeners.add(listener);
    if (socket === null) connect();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        const closing = socket;
        socket = null;
        closing?.close();
      }
    };
  }, [key]);
}
