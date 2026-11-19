// Poll-found changes. A fetch that finds a change this page's own action did not cause announces
// it once; while a dialog or sheet is open the announcements wait, and are read again from the
// newest state when it closes.

import { announceSteps } from './status.js';

export class Announcer {
  private baseline = new Map<string, string>();
  private waiting = new Set<string>();
  private held = false;
  private started = false;

  constructor(
    private readonly region: () => HTMLElement | null,
    private readonly order: string[],
  ) {}

  /** The first load announces nothing. */
  start(values: Map<string, string>): void {
    for (const [key, value] of values) this.baseline.set(key, value);
    this.started = true;
  }

  /** The baseline moves with the page's own action, for the lines that action changes. */
  own(values: Map<string, string>, keys: string[]): void {
    for (const key of keys) {
      if (values.has(key)) this.baseline.set(key, values.get(key) as string);
      this.waiting.delete(key);
    }
  }

  setHeld(held: boolean, values: Map<string, string>): void {
    const wasHeld = this.held;
    this.held = held;
    if (wasHeld && !held) void this.release(values);
  }

  /** Compares a fresh reply with the baseline and announces what changed. */
  found(values: Map<string, string>): void {
    if (!this.started) {
      this.start(values);
      return;
    }
    const changed: string[] = [];
    for (const key of this.order) {
      if (!values.has(key)) continue;
      const value = values.get(key) as string;
      if (this.baseline.get(key) === value) continue;
      if (this.held) {
        this.waiting.add(key);
        continue;
      }
      this.baseline.set(key, value);
      changed.push(value);
    }
    if (changed.length > 0) void announceSteps(this.region(), changed);
  }

  /** After a dialog closes, each waiting line is read again from the newest state. */
  async release(values: Map<string, string>): Promise<void> {
    const lines: string[] = [];
    for (const key of this.order) {
      if (!this.waiting.has(key)) continue;
      this.waiting.delete(key);
      const value = values.get(key);
      if (value === undefined || this.baseline.get(key) === value) continue;
      this.baseline.set(key, value);
      lines.push(value);
    }
    if (lines.length > 0) await announceSteps(this.region(), lines);
  }
}
