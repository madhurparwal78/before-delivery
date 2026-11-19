// The inspector's capture queue. It lives on the device so it survives a reload with no signal,
// every tab of the link shares it, and only one batch is ever in flight.

type CaptureState = 'queued' | 'sending' | 'synced' | 'rejected' | 'conflict';

export interface QueueItem {
  clientId: string;
  kind: 'reading' | 'finding';
  panelId: string;
  panelLabel: string;
  microns?: number;
  u?: number;
  v?: number;
  wording?: string;
  capturedAt: string;
  state: CaptureState;
  reason?: string;
}

const LEASE_MS = 20000;

export class CaptureQueue {
  private readonly key: string;
  private readonly leaseKey: string;
  private readonly listeners = new Set<() => void>();
  private readonly mine = Math.random().toString(36).slice(2);

  constructor(token: string) {
    this.key = `open-bonnet-capture:${token}`;
    this.leaseKey = `open-bonnet-capture-lease:${token}`;
    window.addEventListener('storage', (event) => {
      if (event.key === this.key) this.tell();
    });
  }

  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  private tell(): void {
    for (const listener of this.listeners) listener();
  }

  items(): QueueItem[] {
    try {
      const raw = localStorage.getItem(this.key);
      const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(items: QueueItem[]): void {
    localStorage.setItem(this.key, JSON.stringify(items));
    this.tell();
  }

  /** A row found as sending on reload is queued again. */
  settleOnLoad(): void {
    const items = this.items();
    let changed = false;
    for (const item of items) {
      if (item.state === 'sending') {
        item.state = 'queued';
        changed = true;
      }
    }
    if (changed) this.save(items);
  }

  add(item: QueueItem): void {
    const items = this.items();
    items.push(item);
    this.save(items);
  }

  waiting(): QueueItem[] {
    return this.items().filter((item) => item.state === 'queued');
  }

  private leaseHeld(): boolean {
    const raw = localStorage.getItem(this.leaseKey);
    if (!raw) return false;
    const [owner, at] = raw.split(':');
    if (owner === this.mine) return false;
    return Date.now() - Number(at) < LEASE_MS;
  }

  private takeLease(): boolean {
    if (this.leaseHeld()) return false;
    localStorage.setItem(this.leaseKey, `${this.mine}:${Date.now()}`);
    return true;
  }

  private releaseLease(): void {
    const raw = localStorage.getItem(this.leaseKey);
    if (raw && raw.startsWith(`${this.mine}:`)) localStorage.removeItem(this.leaseKey);
  }

  /**
   * Runs the send with one batch in flight across every tab of this link on this device. The
   * browser's own lock decides who goes; the stored lease covers a browser without one.
   */
  async alone(work: () => Promise<void>): Promise<void> {
    const locks = navigator.locks;
    if (locks) {
      await locks.request(this.leaseKey, { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await work();
      });
      return;
    }
    if (!this.takeLease()) return;
    try {
      await work();
    } finally {
      this.releaseLease();
    }
  }

  mark(clientIds: string[], state: CaptureState, reason?: string): void {
    const items = this.items();
    for (const item of items) {
      if (!clientIds.includes(item.clientId)) continue;
      item.state = state;
      if (reason !== undefined) item.reason = reason;
    }
    this.save(items);
  }

  applyResults(results: { clientId: string; state: string; errors?: Record<string, string> }[]): void {
    const items = this.items();
    for (const result of results) {
      const item = items.find((row) => row.clientId === result.clientId);
      if (!item) continue;
      if (result.state === 'applied' || result.state === 'duplicate') item.state = 'synced';
      else if (result.state === 'conflict') item.state = 'conflict';
      else {
        item.state = 'rejected';
        item.reason = Object.values(result.errors ?? {}).join(' ');
      }
    }
    this.save(items);
  }
}
