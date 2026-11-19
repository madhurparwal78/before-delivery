import { useEffect, useRef } from "react";
import type { BoardLiveEvent, StaffLiveEvent } from "../shared/api";

type LiveEvent = StaffLiveEvent | BoardLiveEvent;
type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let opened = false;

/** One stream per page; a reconnect asks every screen to read again, since events may have been missed. */
export function connectLive(): void {
  if (source) return;
  source = new EventSource("/api/live");
  source.addEventListener("open", () => {
    if (opened) listeners.forEach((listener) => listener({ type: "report", notice: null }));
    opened = true;
  });
  source.addEventListener("change", (message) => {
    const event = JSON.parse((message as MessageEvent<string>).data) as LiveEvent;
    listeners.forEach((listener) => listener(event));
  });
}

export function disconnectLive(): void {
  source?.close();
  source = null;
  opened = false;
}

/** Calls the handler for every pushed change while the component is mounted. */
export function useLive(handler: Listener): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const listener: Listener = (event) => latest.current(event);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, []);
}
