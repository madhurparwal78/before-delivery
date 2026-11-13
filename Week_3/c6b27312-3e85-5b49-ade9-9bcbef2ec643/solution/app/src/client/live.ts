// The server event stream: a native EventSource reconnects by itself and resends the last event id it saw.
import { useEffect, useRef } from "react";
import type { LiveEvent } from "../shared/api";

const TYPES = ["revision", "comment", "approvals", "like"] as const;

export function useLiveEvents(parts: string | null, onEvent: (event: LiveEvent) => void): void {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!parts) return;
    const source = new EventSource(`/api/events?parts=${encodeURIComponent(parts)}`);
    const listeners = TYPES.map((type) => {
      const listener = (event: MessageEvent<string>) => handler.current(JSON.parse(event.data) as LiveEvent);
      source.addEventListener(type, listener as EventListener);
      return [type, listener] as const;
    });
    return () => {
      for (const [type, listener] of listeners) source.removeEventListener(type, listener as EventListener);
      source.close();
    };
  }, [parts]);
}
