// Live updates: a same-origin WebSocket per workspace. Reconnects on drop and
// bumps a version that pages use to refetch server state within 2 seconds.

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

export interface LiveEvent {
  kind: string;
  body: Record<string, unknown>;
}

interface LiveState {
  version: number;
  lastEvent: LiveEvent | null;
  connected: boolean;
}

const LiveContext = createContext<LiveState>({ version: 0, lastEvent: null, connected: false });

export function LiveProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }): JSX.Element {
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry: number | undefined;
    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/w/${workspaceId}/live`);
      socketRef.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as LiveEvent;
          setLastEvent(parsed);
          setVersion((v) => v + 1);
        } catch {
          // Ignore malformed frames.
        }
      };
      socket.onclose = () => {
        setConnected(false);
        if (!closed) {
          retry = window.setTimeout(connect, 1500);
        }
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      closed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socketRef.current?.close();
    };
  }, [workspaceId]);

  const value = useMemo(() => ({ version, lastEvent, connected }), [version, lastEvent, connected]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  return useContext(LiveContext);
}
