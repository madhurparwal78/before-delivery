// Live transport: one SSE stream per page, applied in the message handler.

export interface LiveEvent { world: string; kind: string; payload: unknown }

type Handler = (event: LiveEvent) => void;
const handlers = new Set<Handler>();
let source: EventSource | null = null;

/** Connects the single same-origin stream; every message is dispatched inside its handler. */
export function initLive(): void {
  if (source) return;
  source = new EventSource("/api/live");
  source.onmessage = (ev: MessageEvent<string>) => {
    let parsed: LiveEvent;
    try { parsed = JSON.parse(ev.data) as LiveEvent; } catch { return; }
    for (const fn of handlers) fn(parsed);
  };
}

export function onLive(fn: Handler): void {
  handlers.add(fn);
}
