// The send-order rule: every commit, undo, redo and workspace read is numbered as it is
// sent, sent at once, resent once (same key and body) after a network failure or 10 s of
// silence, and its answer is applied only after every earlier-sent request has answered.
import type { ApiErrorBody } from "./api.js";
import { newKey, readAnswer } from "./api.js";

const SILENCE_MS = 10_000;

type Outcome =
  | { kind: "success"; status: number; data: unknown }
  | { kind: "refused"; status: number; error: ApiErrorBody | null }
  | { kind: "failed" };

export interface Sent<T = unknown> {
  seq: number;
  method: string;
  url: string;
  commit: boolean; // commits carry an Idempotency-Key; reads do not
  tag: T;
  outcome?: Outcome;
}

export class Sequencer<T> {
  private seq = 0;
  private applied = 0;
  private readonly waiting = new Map<number, Sent<T>>();
  private draining = false;

  constructor(private readonly applyBatch: (batch: Sent<T>[]) => Promise<void>) {}

  get pending(): number {
    return this.seq - this.applied;
  }

  send(method: string, url: string, body: unknown, commit: boolean, tag: T): Sent<T> {
    const sent: Sent<T> = { seq: ++this.seq, method, url, commit, tag };
    const key = commit ? newKey() : null;
    void this.exchange(method, url, body, key).then((outcome) => {
      sent.outcome = outcome;
      this.waiting.set(sent.seq, sent);
      void this.drain();
    });
    return sent;
  }

  private async exchange(method: string, url: string, body: unknown, key: string | null): Promise<Outcome> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SILENCE_MS);
      try {
        const headers: Record<string, string> = {};
        if (body !== undefined) headers["Content-Type"] = "application/json";
        if (key) headers["Idempotency-Key"] = key;
        const response = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (response.status >= 500) {
          clearTimeout(timer);
          return { kind: "failed" };
        }
        const answer = await readAnswer<unknown>(response);
        clearTimeout(timer);
        return answer.ok ? { kind: "success", status: answer.status, data: answer.data } : { kind: "refused", status: answer.status, error: answer.error };
      } catch {
        clearTimeout(timer);
      }
    }
    return { kind: "failed" };
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.waiting.has(this.applied + 1)) {
        const batch: Sent<T>[] = [];
        while (this.waiting.has(this.applied + 1)) {
          const next = this.waiting.get(this.applied + 1)!;
          this.waiting.delete(next.seq);
          this.applied = next.seq;
          batch.push(next);
        }
        await this.applyBatch(batch);
      }
    } finally {
      this.draining = false;
    }
  }
}
