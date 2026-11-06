import { ApiFailure, NoResponse, request } from './api.js';

export type QueuedAction = 'afloat' | 'recovered' | 'service';

export interface QueuedItem {
  id: string;
  vesselId: string;
  vesselName: string;
  action: QueuedAction;
  queuedAt: string;
  idempotencyKey: string;
  note?: string;
}

const STORAGE_KEY = 'swathdeck.slipway.queue';

export interface QueueEvents {
  changed(items: QueuedItem[]): void;
  /** A queued action that answered, with the row outcome to show. */
  settled(item: QueuedItem, outcome: { ok: true } | { ok: false; message: string }): void;
}

/**
 * Slipway actions taken while the phone is offline. Each keeps the idempotency
 * key it was given when queued, survives a reload in local storage, and is sent
 * in order once the phone is online again.
 */
export class SlipwayQueue {
  private items: QueuedItem[] = [];
  private sending = false;

  constructor(private readonly events: QueueEvents) {
    this.load();
    window.addEventListener('online', () => void this.flush());
  }

  private load(): void {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      this.items = raw ? (JSON.parse(raw) as QueuedItem[]) : [];
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    try {
      if (this.items.length === 0) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // Without local storage the queue simply lives for this page only.
    }
    this.events.changed([...this.items]);
  }

  list(): QueuedItem[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }

  pendingFor(vesselId: string): boolean {
    return this.items.some((item) => item.vesselId === vesselId);
  }

  clearAll(): void {
    this.items = [];
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  enqueue(entry: Omit<QueuedItem, 'id' | 'queuedAt' | 'idempotencyKey'>): QueuedItem {
    const item: QueuedItem = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      queuedAt: new Date().toISOString(),
      idempotencyKey: `slipway-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    this.items.push(item);
    this.persist();
    return item;
  }

  discard(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.persist();
  }

  /** Sends the queue one at a time, in the order the actions were taken. */
  async flush(): Promise<void> {
    if (this.sending || !navigator.onLine) return;
    this.sending = true;
    try {
      while (this.items.length > 0 && navigator.onLine) {
        const item = this.items[0]!;
        try {
          await this.send(item);
          this.items.shift();
          this.persist();
          this.events.settled(item, { ok: true });
        } catch (error) {
          if (error instanceof NoResponse) return;
          const message = error instanceof ApiFailure ? error.message : 'Could not send';
          this.items.shift();
          // A refused action drops the vessel's later queued actions.
          const dropped = this.items.filter((other) => other.vesselId === item.vesselId);
          this.items = this.items.filter((other) => other.vesselId !== item.vesselId);
          this.persist();
          this.events.settled(item, { ok: false, message });
          for (const other of dropped) {
            this.events.settled(other, {
              ok: false,
              message: `an earlier action for ${item.vesselName} was refused`,
            });
          }
        }
      }
    } finally {
      this.sending = false;
    }
  }

  private async send(item: QueuedItem): Promise<void> {
    if (item.action === 'service') {
      await request(`/api/vessels/${item.vesselId}/services`, {
        method: 'POST',
        body: { note: item.note ?? '' },
        headers: { 'idempotency-key': item.idempotencyKey },
      });
      return;
    }
    await request(`/api/vessels/${item.vesselId}/${item.action}`, {
      method: 'POST',
      body: {},
    });
  }
}
