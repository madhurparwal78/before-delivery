/** The server's event stream, shared by all open pages. */

type EventListener = (data: Record<string, unknown>) => void;

class ClientEvents {
  private source: EventSource | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();
  private connecting = false;

  private ensure(): void {
    if (this.source !== null || this.connecting) return;
    this.connecting = true;
    const source = new EventSource('/api/events');
    this.source = source;
    source.onopen = () => {
      this.connecting = false;
    };
    source.onerror = () => {
      // Reconnect: the page keeps listening after a hiccup.
      source.close();
      this.source = null;
      this.connecting = false;
      setTimeout(() => this.ensure(), 2000);
    };
    const names = [
      'rule-in-force',
      'access-changed',
      'session-ended',
      'billing-changed',
      'check-finished',
      'review-opened',
      'review-changed',
      'seat-confirmed'
    ];
    for (const name of names) {
      source.addEventListener(name, (event) => {
        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse((event as MessageEvent).data as string) as Record<string, unknown>;
        } catch {
          data = {};
        }
        this.emit(name, data);
      });
    }
  }

  on(name: string, listener: EventListener): () => void {
    this.ensure();
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
    };
  }

  private emit(name: string, data: Record<string, unknown>): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of set) {
      listener(data);
    }
  }
}

let singleton: ClientEvents | null = null;

export function getEvents(): ClientEvents {
  if (!singleton) singleton = new ClientEvents();
  return singleton;
}
