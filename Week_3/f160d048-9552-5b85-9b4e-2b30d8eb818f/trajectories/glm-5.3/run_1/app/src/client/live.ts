// The live stream: SSE with replay and per-page subscriptions.
export interface LiveEventEnvelope {
  type: string;
  data: Record<string, unknown>;
  id?: number;
}

type Listener = (event: LiveEventEnvelope) => void;

class LiveConnection {
  private source: EventSource | null = null;
  private listeners = new Set<Listener>();
  private static instance: LiveConnection | null = null;

  static get(): LiveConnection {
    if (!LiveConnection.instance) LiveConnection.instance = new LiveConnection();
    return LiveConnection.instance;
  }

  connect(): void {
    if (this.source) return;
    this.open();
  }

  private open(): void {
    const source = new EventSource('/api/live');
    this.source = source;
    source.addEventListener('hello', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { replay: string };
      if (data.replay === 'reload') {
        window.dispatchEvent(new CustomEvent('cb-reload'));
      }
    });
    const types = [
      'queue.changed',
      'queue.history',
      'post.state',
      'member.unlocked',
      'company.changed',
      'application.stage',
      'channel.post',
      'alert.matched',
    ];
    for (const type of types) {
      source.addEventListener(type, (event) => {
        const message = event as MessageEvent;
        const data = JSON.parse(message.data) as Record<string, unknown>;
        const id = (message as unknown as { lastEventId?: string }).lastEventId;
        const envelope: LiveEventEnvelope = {
          type,
          data,
          id: id ? Number.parseInt(id, 10) : undefined,
        };
        for (const listener of this.listeners) listener(envelope);
      });
    }
    source.onerror = () => {
      source.close();
      this.source = null;
      // EventSource reconnects through a new stream; retry after a beat.
      setTimeout(() => this.open(), 1000);
    };
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const live = {
  subscribe(listener: Listener): () => void {
    return LiveConnection.get().on(listener);
  },
};

export function onReload(callback: () => void): () => void {
  const handler = () => callback();
  window.addEventListener('cb-reload', handler);
  return () => window.removeEventListener('cb-reload', handler);
}
