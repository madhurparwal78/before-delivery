import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { LiveEvent } from "../../shared/types";
import { whenQuiet } from "./quiet";

type Handler = (event: LiveEvent) => void;

interface LiveValue {
  services: { mail: boolean; storage: boolean };
  subscribe: (handler: Handler) => () => void;
}

const LiveContext = createContext<LiveValue | null>(null);

export function LiveProvider({ children, source = "/api/live" }: { children: ReactNode; source?: string }) {
  const handlers = useRef(new Set<Handler>());
  const [services, setServices] = useState({ mail: true, storage: true });
  useEffect(() => {
    let stream: EventSource | null = null;
    let closed = false;
    const emit = (event: LiveEvent) => {
      if (event.type === "services") setServices({ mail: event.mail, storage: event.storage });
      for (const handler of handlers.current) handler(event);
    };
    void whenQuiet().then(() => {
      if (closed) return;
      stream = new EventSource(source);
      // Whatever changed while the channel was not yet open (or while it reconnected) is read again.
      stream.onopen = () => emit({ type: "resync" });
      stream.onmessage = (message: MessageEvent<string>) => emit(JSON.parse(message.data) as LiveEvent);
    });
    return () => {
      closed = true;
      stream?.close();
    };
  }, [source]);
  const value = useMemo<LiveValue>(
    () => ({
      services,
      subscribe: (handler) => {
        handlers.current.add(handler);
        return () => handlers.current.delete(handler);
      },
    }),
    [services],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("LiveProvider is missing");
  return value;
}

export function useLiveEvents(handler: Handler): void {
  const { subscribe } = useLive();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}
