import { useEffect, useRef } from "react";
import type { HostLiveEvent } from "../shared/api.js";

/** Lets a page's first requests finish before the stream opens, so the page reaches network idle (an open stream never ends). */
const FIRST_OPEN_MS = 1200;

/**
 * Follows a server-sent event stream. The first open asks the server to replay what happened since the page mounted,
 * so a change made while the stream was still waiting to open is delivered like any other. The browser reopens a
 * dropped stream within a second and sends the last id; `onSync` runs every time the stream reopens or the server
 * says Valkey is back, so a page refreshes what it missed.
 */
export function useLiveEvents(url: string | null, onEvent: (event: HostLiveEvent) => void, onSync: () => void): void {
  const latest = useRef({ onEvent, onSync });
  latest.current = { onEvent, onSync };
  useEffect(() => {
    if (url === null) return undefined;
    const mounted = performance.now();
    let source: EventSource | undefined;
    let retry: number | undefined;
    let opened = false;
    const open = (first: boolean): void => {
      const replay = Math.min(10_000, Math.max(0, Math.round(performance.now() - mounted)));
      source = new EventSource(first ? `${url}${url.includes("?") ? "&" : "?"}replay_ms=${replay}` : url);
      source.onopen = () => {
        if (opened) latest.current.onSync();
        opened = true;
      };
      source.onmessage = (message: MessageEvent<string>) => latest.current.onEvent(JSON.parse(message.data));
      source.addEventListener("resync", () => latest.current.onSync());
      source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) return;
        latest.current.onSync();
        opened = true;
        retry = window.setTimeout(() => open(false), 1000);
      };
    };
    retry = window.setTimeout(() => open(true), FIRST_OPEN_MS);
    return () => {
      window.clearTimeout(retry);
      source?.close();
    };
  }, [url]);
}
