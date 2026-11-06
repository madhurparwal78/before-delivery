/** The Server-Sent Events clients with gap-free resume. */

export interface StreamHandle {
  close(): void;
}

export interface SseEvent {
  id: string;
  event: string;
  data: unknown;
}

/** Connects an event stream, resuming with Last-Event-ID on reconnect. */
export function stream(path: string, handlers: { onEvent: (event: SseEvent) => void; onOpen?: () => void }): StreamHandle {
  let lastId = "";
  let closed = false;
  let es: EventSource | null = null;
  let retry: number | undefined;

  const connect = (): void => {
    if (closed) return;
    const url = lastId === "" ? path : `${path}${path.includes("?") ? "&" : "?"}lastEventId=${encodeURIComponent(lastId)}`;
    es = new EventSource(url);
    es.onopen = () => handlers.onOpen?.();
    es.onerror = () => {
      es?.close();
      if (!closed) {
        retry = window.setTimeout(connect, 2000);
      }
    };
    es.onmessage = (ev: MessageEvent) => dispatch("message", ev);
    const names = ["snapshot", "server", "presence", "friends", "party", "leaderboard", "weather", "invite", "trade", "achievement", "world", "chat", "table", "announcement"];
    for (const name of names) {
      es.addEventListener(name, (ev: MessageEvent) => dispatch(name, ev));
    }
  };

  const dispatch = (name: string, ev: MessageEvent): void => {
    const id = (ev as MessageEvent & { lastEventId?: string }).lastEventId ?? "";
    if (id !== "") lastId = id;
    let data: unknown = null;
    try {
      data = JSON.parse(ev.data);
    } catch {
      data = null;
    }
    handlers.onEvent({ id, event: name, data });
  };

  connect();
  return {
    close(): void {
      closed = true;
      es?.close();
      if (retry !== undefined) window.clearTimeout(retry);
    },
  };
}
