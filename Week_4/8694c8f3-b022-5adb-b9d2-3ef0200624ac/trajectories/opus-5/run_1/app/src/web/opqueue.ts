import { api, ApiFailure, NetworkFailure, type ApiErrorBody, type OpRequest } from './api.js';
import type { OpResult } from '../shared/types.js';

export interface QueueHandlers {
  onChange: () => void;
  onAcknowledged: (op: OpRequest, result: OpResult) => void;
  onRefused: (op: OpRequest, failure: ApiFailure) => void;
}

/** Edits queue in the browser while offline and replay in order, exactly once. */
export class OpQueue {
  private setId: string;
  private handlers: QueueHandlers;
  private pending: OpRequest[] = [];
  private flushing = false;
  offline = false;
  inFlight = false;
  lastError: ApiErrorBody | null = null;

  constructor(setId: string, handlers: QueueHandlers) {
    this.setId = setId;
    this.handlers = handlers;
    this.pending = this.read();
    window.addEventListener('online', () => void this.flush());
    window.addEventListener('offline', () => {
      this.offline = true;
      this.handlers.onChange();
    });
    setInterval(() => {
      if (this.pending.length > 0) void this.flush();
    }, 3000);
  }

  private get storageKey(): string {
    return `afterglass.queue.${this.setId}`;
  }

  private read(): OpRequest[] {
    const raw = window.localStorage.getItem(this.storageKey);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OpRequest[]) : [];
  }

  private write(): void {
    window.localStorage.setItem(this.storageKey, JSON.stringify(this.pending));
  }

  get count(): number {
    return this.pending.length;
  }

  push(op: OpRequest): void {
    this.pending.push(op);
    this.write();
    this.handlers.onChange();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const op = this.pending[0] as OpRequest;
        this.inFlight = true;
        this.handlers.onChange();
        try {
          const result = await api.sendOp(this.setId, op);
          this.pending.shift();
          this.write();
          this.offline = false;
          this.inFlight = false;
          this.handlers.onAcknowledged(op, result);
          this.handlers.onChange();
        } catch (error) {
          this.inFlight = false;
          if (error instanceof NetworkFailure) {
            this.offline = true;
            this.handlers.onChange();
            return;
          }
          if (error instanceof ApiFailure) {
            this.pending.shift();
            this.write();
            this.offline = false;
            this.lastError = error.body;
            this.handlers.onRefused(op, error);
            this.handlers.onChange();
            continue;
          }
          throw error;
        }
      }
      this.offline = false;
      this.handlers.onChange();
    } finally {
      this.flushing = false;
    }
  }
}
