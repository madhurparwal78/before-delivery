// The live sync channel client: reconnect, resume, event dispatch.

export interface SyncEvent {
  event: string;
  data: Record<string, unknown>;
  id: number | null;
}

export type SyncListener = (ev: SyncEvent) => void;

export class LiveSyncClient {
  private source: EventSource | null = null;
  private lastId: number | null = null;
  private closed = false;
  private statusEl: HTMLElement | null = null;

  constructor(
    private onEvent: SyncListener,
    private onReset: () => void,
    statusEl: HTMLElement | null
  ) {
    this.statusEl = statusEl;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.source !== null) {
      this.source.close();
      this.source = null;
    }
  }

  private connect(): void {
    if (this.closed) return;
    // the browser EventSource reconnects by itself, resuming from the last
    // event id the stream sent
    const source = new EventSource("/api/events");
    this.source = source;
    source.onopen = () => {
      this.setStatus("Live");
    };
    source.onerror = () => {
      this.setStatus("Live updates paused. Reconnecting.");
    };
    const handler = (event: string, dataStr: string, id: string | null): void => {
      let data: Record<string, unknown> = {};
      try {
        data = dataStr.length > 0 ? (JSON.parse(dataStr) as Record<string, unknown>) : {};
      } catch {
        data = {};
      }
      if (id !== null && /^\d+$/.test(id)) this.lastId = Number(id);
      if (event === "sync.reset") {
        this.onReset();
        return;
      }
      this.onEvent({ event, data, id: id !== null && /^\d+$/.test(id) ? Number(id) : null });
    };
    const names = [
      "block.saved",
      "block.removed",
      "backlinks.changed",
      "object.saved",
      "object.removed",
      "board.saved",
      "settings.saved",
      "share_link.changed",
      "sessions.changed",
      "presence.changed",
      "sync.reset",
      "session.ended",
    ];
    for (const name of names) {
      source.addEventListener(name, (e: MessageEvent) => {
        handler(name, typeof e.data === "string" ? e.data : "", (e as MessageEvent & { lastEventId?: string }).lastEventId ?? null);
      });
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl !== null) this.statusEl.textContent = text;
  }
}
