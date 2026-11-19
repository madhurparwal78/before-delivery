import { useEffect, useRef, useState } from "react";
import type { LiveEvent, LiveEventType } from "../../shared/events";

const TYPES: LiveEventType[] = [
  "hello", "seat", "ride", "booking", "notice", "message", "presence", "rating", "id_review", "wallet", "clock",
];

const FIRST_OPEN_DELAY_MS = 1500;

/**
 * The document's first stream waits until the load has gone quiet (an open stream is a request that never ends, so
 * opening at once would keep the load from ever going network-idle), then asks for everything published since the
 * server sent the document. `AbortSignal.timeout` runs on real time, off the (pausable) page clock.
 */
const loadQuiet = new Promise<void>((resolve) => {
  AbortSignal.timeout(FIRST_OPEN_DELAY_MS).addEventListener("abort", () => resolve());
});
let replayFrom: number | null = (() => {
  const from = Number(document.querySelector<HTMLMetaElement>('meta[name="longseat-live-from"]')?.content);
  return Number.isFinite(from) && from > 0 ? from : null;
})();

interface Subscription {
  ride?: string | undefined;
  thread?: string | undefined;
  onEvent: (event: LiveEvent) => void;
}

/** One event stream per page. Every `hello` is delivered to `onEvent` so the page can fetch its state again. */
export function useLive({ ride, thread, onEvent }: Subscription): { paused: boolean } {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    let source: EventSource | null = null;
    let closed = false;
    let retry = 0;
    let from = replayFrom;
    const params = new URLSearchParams();
    if (ride) params.set("ride", ride);
    if (thread) params.set("thread", thread);

    const open = (): void => {
      const query = new URLSearchParams(params);
      if (from !== null) query.set("from", String(from));
      from = null;
      source = new EventSource(`/api/live${query.size ? `?${query}` : ""}`);
      for (const type of TYPES) {
        source.addEventListener(type, (message) => {
          let data: unknown = null;
          try {
            data = JSON.parse((message as MessageEvent<string>).data);
          } catch {
            return;
          }
          if (type === "hello") setPaused(false);
          handler.current({ type, data } as LiveEvent);
        });
      }
      source.onerror = () => {
        setPaused(true);
        if (source && source.readyState === EventSource.CLOSED && !closed) {
          source.close();
          retry = window.setTimeout(open, 2000);
        }
      };
    };

    if (from === null) {
      open();
    } else {
      void loadQuiet.then(() => {
        if (closed) return;
        replayFrom = null;
        open();
      });
    }
    return () => {
      closed = true;
      window.clearTimeout(retry);
      source?.close();
    };
  }, [ride, thread]);

  return { paused };
}
