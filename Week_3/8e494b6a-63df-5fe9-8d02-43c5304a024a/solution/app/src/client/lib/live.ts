// Live messages from GET /api/events: applied in the message handler, never behind a timer.
import { useEffect, useRef } from "react";
import { announce, update } from "./store";

type LiveType = "clock" | "alert" | "inbox" | "case" | "upload" | "lifecycle";
type LiveData = Record<string, unknown> & { seq: number };
type Handler = (data: LiveData) => void;

const TYPES: LiveType[] = ["clock", "alert", "inbox", "case", "upload", "lifecycle"];
const handlers = new Map<LiveType, Set<Handler>>();
let source: EventSource | null = null;
let connected = "";

function apply(type: LiveType, data: LiveData): void {
  for (const handler of handlers.get(type) ?? []) handler(data);
  if (type === "clock") update({ serverNowMs: data.now_ms as number });
  if (typeof data.stored_total === "number") update({ ingest: { stored: data.stored_total, failed: data.failure_total as number } });
  const sentences = data.announcements;
  if (type !== "upload" && Array.isArray(sentences) && sentences.length > 0) announce(sentences.join(" "));
  update({ seq: data.seq });
}

/** Opens (or reopens, on a space switch) the space's event stream from the sequence the page loaded at. */
export function connectLive(slug: string, since: number): void {
  if (connected === slug && source) return;
  source?.close();
  connected = slug;
  source = new EventSource(`/api/events?space=${encodeURIComponent(slug)}&since=${since}`);
  for (const type of TYPES) {
    source.addEventListener(type, (event) => apply(type, JSON.parse((event as MessageEvent<string>).data) as LiveData));
  }
}

export function disconnectLive(): void {
  source?.close();
  source = null;
  connected = "";
}

export function useLive(types: LiveType[], handler: Handler): void {
  const latest = useRef(handler);
  latest.current = handler;
  const key = types.join(",");
  useEffect(() => {
    const wrapper: Handler = (data) => latest.current(data);
    for (const type of types) {
      const set = handlers.get(type) ?? new Set();
      set.add(wrapper);
      handlers.set(type, set);
    }
    return () => {
      for (const type of types) handlers.get(type)?.delete(wrapper);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
