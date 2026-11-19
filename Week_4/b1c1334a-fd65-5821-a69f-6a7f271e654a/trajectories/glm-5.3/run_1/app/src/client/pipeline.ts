/**
 * The commit pipeline: one place sends, retries and applies responses in
 * send order, and owns the pending, muted and failed cell states.
 */
import { api, ApiFailure, Recalc, newKey } from './api.js';

export type RequestKind = 'commit' | 'undo' | 'redo' | 'read';

export interface SendEntry {
  id: number;
  kind: RequestKind;
  method: string;
  path: string;
  body?: unknown;
  key?: string;
  sentAt: number;
  status: 'pending' | 'done' | 'failed';
  result?: { data: unknown; replayed: boolean };
  error?: ApiFailure;
  resent?: boolean;
}

export interface AppliedResult {
  entry: SendEntry;
  data?: unknown;
  error?: ApiFailure;
}

export type ApplyFn = (applied: AppliedResult[]) => void;

export class Pipeline {
  private entries: SendEntry[] = [];
  private nextId = 1;
  private apply: ApplyFn;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(apply: ApplyFn) {
    this.apply = apply;
  }

  get pending(): SendEntry[] {
    return this.entries.filter((e) => e.status === 'pending');
  }

  /** Responses are applied strictly in send order. */
  private maybeApply(): void {
    const applicable = this.entries.filter((e) => e.status !== 'pending');
    const ordered: SendEntry[] = [];
    for (const entry of this.entries) {
      if (entry.status === 'pending') break;
      ordered.push(entry);
    }
    if (ordered.length === 0) return;
    this.entries = this.entries.filter((e) => !ordered.includes(e));
    this.apply(ordered.map((entry) => ({ entry, data: entry.result?.data, error: entry.error })));
    this.scheduleNextCheck();
  }

  private scheduleNextCheck(): void {
    if (this.timer) clearTimeout(this.timer);
    const pending = this.pending;
    if (pending.length === 0) return;
    const next = pending[0]!;
    const deadline = next.sentAt + 10_000 * (next.resent ? 2 : 1);
    const wait = Math.max(50, deadline - Date.now());
    this.timer = setTimeout(() => this.checkTimeouts(), wait);
  }

  private checkTimeouts(): void {
    const now = Date.now();
    for (const entry of this.pending) {
      const deadline = entry.sentAt + 10_000;
      if (now >= deadline && !entry.resent) {
        this.resend(entry);
      } else if (now >= deadline && entry.resent) {
        entry.status = 'failed';
        entry.error = new ApiFailure(0, { code: 'connection', message: 'Could not reach Tallyframe.' }, false);
        this.maybeApply();
        return;
      }
    }
    this.scheduleNextCheck();
  }

  private resend(entry: SendEntry): void {
    entry.resent = true;
    entry.sentAt = Date.now();
    this.fire(entry);
  }

  private fire(entry: SendEntry): void {
    api(entry.method, entry.path, entry.body, { idempotencyKey: entry.key })
      .then((result) => {
        if (entry.status !== 'pending') return;
        entry.status = 'done';
        entry.result = result;
        this.maybeApply();
      })
      .catch((err: unknown) => {
        if (entry.status !== 'pending') return;
        if (err instanceof ApiFailure) {
          entry.status = 'done';
          entry.error = err;
          this.maybeApply();
        } else {
          // network failure: resend once, then fail
          if (!entry.resent) {
            this.resend(entry);
          } else {
            entry.status = 'failed';
            entry.error = new ApiFailure(0, { code: 'connection', message: 'Could not reach Tallyframe.' }, false);
            this.maybeApply();
          }
        }
      });
  }

  /** Send at once; nothing waits behind a pending request. */
  send(kind: RequestKind, method: string, path: string, body?: unknown, key?: string): SendEntry {
    const entry: SendEntry = {
      id: this.nextId++,
      kind,
      method,
      path,
      body,
      key: key ?? newKey(),
      sentAt: Date.now(),
      status: 'pending',
    };
    this.entries.push(entry);
    this.fire(entry);
    this.scheduleNextCheck();
    return entry;
  }

  sendRead(method: string, path: string, body?: unknown): SendEntry {
    const entry: SendEntry = {
      id: this.nextId++,
      kind: 'read',
      method,
      path,
      body,
      sentAt: Date.now(),
      status: 'pending',
    };
    this.entries.push(entry);
    api(method, path, body)
      .then((result) => {
        entry.status = 'done';
        entry.result = result;
        this.maybeApply();
      })
      .catch((err: unknown) => {
        entry.status = 'done';
        entry.error = err instanceof ApiFailure ? err : new ApiFailure(0, { code: 'connection', message: 'Could not reach Tallyframe.' }, false);
        this.maybeApply();
      });
    return entry;
  }
}

/** The pending copy shown while anything is in flight. */
export const PENDING_COPY = 'Saving changes';
