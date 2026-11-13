import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LiveMessage } from "../shared/types.js";

type EventHandler = (message: LiveMessage) => void;

type LiveContextValue = {
  open: boolean;
  everClosed: boolean;
  topics: Record<string, number>;
  subscribe: (handler: EventHandler) => () => void;
};

const LiveContext = createContext<LiveContextValue | null>(null);
const ClockContext = createContext<string>("");

/** The latest server time received: from the page's data, then from the socket's clock once a second. */
export const useServerTime = (): string => useContext(ClockContext);

export function useLive(): LiveContextValue {
  const value = useContext(LiveContext);
  if (!value) throw new Error("useLive outside LiveProvider");
  return value;
}

/** Runs `handler` for every live event applied after this component mounted. */
export function useLiveEvent(handler: EventHandler): void {
  const { subscribe } = useLive();
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribe((message) => latest.current(message)), [subscribe]);
}

const RECONNECT_STEP_MS = 1000;
const RECONNECT_MAX_MS = 5000;

/** The page's one socket: it sends nothing, replays what it missed after a drop and applies each event once. */
export function LiveProvider({ startSeq, startTime, children }: { startSeq: number; startTime: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [everClosed, setEverClosed] = useState(false);
  const [serverTime, setServerTime] = useState(startTime);
  const first = useRef(startSeq);
  const [topics, setTopics] = useState<Record<string, number>>({});
  const handlers = useRef(new Set<EventHandler>());

  const subscribe = useCallback((handler: EventHandler) => {
    handlers.current.add(handler);
    return () => {
      handlers.current.delete(handler);
    };
  }, []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let attempts = 0;
    let seq = first.current;
    let stopped = false;

    const apply = (message: LiveMessage) => {
      if (message.type === "clock") {
        setServerTime(String(message.data.server_time));
        return;
      }
      if (message.seq <= seq) return;
      seq = message.seq;
      if (message.type === "changed") {
        const names = message.data.topics as string[];
        setTopics((previous) => {
          const next = { ...previous };
          for (const name of names) next[name] = (next[name] ?? 0) + 1;
          return next;
        });
      }
      handlers.current.forEach((handler) => handler(message));
      if (message.type === "access.removed") stopped = true;
    };

    const connect = () => {
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${scheme}//${window.location.host}/api/live?since=${seq}`);
      socket.onopen = () => {
        attempts = 0;
        setOpen(true);
      };
      socket.onmessage = (event) => apply(JSON.parse(String(event.data)) as LiveMessage);
      socket.onclose = () => {
        setOpen(false);
        setEverClosed(true);
        if (stopped) return;
        attempts += 1;
        timer = window.setTimeout(connect, Math.min(RECONNECT_MAX_MS, RECONNECT_STEP_MS * attempts));
      };
    };
    connect();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const value = useMemo(() => ({ open, everClosed, topics, subscribe }), [open, everClosed, topics, subscribe]);
  return (
    <LiveContext.Provider value={value}>
      <ClockContext.Provider value={serverTime}>{children}</ClockContext.Provider>
    </LiveContext.Provider>
  );
}
