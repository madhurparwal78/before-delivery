import { announce } from './live';

export type LineValues<K extends string> = Readonly<Record<K, string>>;

/**
 * Announces poll-found changes the page's own action did not cause. Each change is
 * one separate update, written once, in the published order. While a dialog or sheet
 * is open announcements wait, and when it closes each waiting line is read again from
 * the newest state and compared with the baseline as the page's own reply left it.
 */
export class PollAnnouncer<K extends string> {
  private baseline: Partial<Record<K, string>> = {};
  private waiting = new Set<K>();
  private primed = false;

  constructor(
    private readonly region: () => HTMLElement,
    private readonly order: readonly K[],
  ) {}

  /** The first load announces nothing. */
  prime(values: LineValues<K>): void {
    this.baseline = { ...values };
    this.primed = true;
  }

  check(values: LineValues<K>, blocked: boolean): void {
    if (!this.primed) {
      this.prime(values);
      return;
    }
    for (const key of this.order) {
      if (values[key] === this.baseline[key]) continue;
      if (blocked) {
        this.waiting.add(key);
        continue;
      }
      this.write(key, values[key]);
    }
  }

  /** The baseline moves with the reply to the page's own action, for the lines it changes. */
  refresh(keys: readonly K[], values: LineValues<K>): void {
    for (const key of keys) {
      this.baseline[key] = values[key];
      this.waiting.delete(key);
    }
  }

  /** After the overlay closes, waiting lines that still differ arrive in order. */
  flush(values: LineValues<K>): void {
    for (const key of this.order) {
      if (!this.waiting.has(key)) continue;
      this.waiting.delete(key);
      if (values[key] === this.baseline[key]) continue;
      this.write(key, values[key]);
    }
  }

  private write(key: K, value: string): void {
    this.baseline[key] = value;
    if (value.length === 0) return;
    announce(this.region(), value);
  }
}
