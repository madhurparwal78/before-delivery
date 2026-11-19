// The Fuse Clock: one family of numerals for every server-decided timer.
//
// A numeral counts down from the latest server value between snapshots, re-flows
// when a snapshot disagrees, and at zero splits apart and is replaced by its
// outcome word. The value shown is always the server's: data-server-ms carries
// the snapshot value, and the displayed value never runs more than 150 ms of
// countdown ahead of it.

import { clear, el, formatCountUp, formatRemaining } from './core';
import { comfort } from './comfort';

/** Outcome words, by timer name. */
const outcomes: Record<string, string> = {
  Reload: 'reloaded',
  'Grenade fuse': 'detonated',
  Countdown: 'go',
  Intermission: 'go',
  Reset: 'reset',
  'Invite expires': 'expired',
  'Reconnect grace': 'released',
  'Sign-ups close': 'closed',
};

/** outcomeWord reports the word a timer resolves to at zero. */
export function outcomeWord(name: string, variant?: string): string {
  if (name.startsWith('Revive window')) return variant === 'out' ? 'out' : 'revived';
  if (name.startsWith('Price change')) return 'new price';
  return outcomes[name] ?? '';
}

const maxDrift = 150;
const outcomeHold = 1600;

export interface FuseOptions {
  /** countUp drives the Lap timer, which counts up and never resolves. */
  countUp?: boolean;
  /** onOutcome fires once when a countdown reaches zero. */
  onOutcome?: (word: string) => void;
}

/** FuseClock is one timer numeral. */
export class FuseClock {
  readonly root: HTMLElement;
  private name: string;
  private options: FuseOptions;
  private serverMS = 0;
  private serverAt = 0;
  private shown = '';
  private resolved = false;
  private resolvedAt = 0;
  private outcome = '';
  private live = true;

  constructor(name: string, options: FuseOptions = {}) {
    this.name = name;
    this.options = options;
    this.root = el('span', { class: 'fuse', role: 'timer', 'aria-label': name, 'data-server-ms': '0' });
  }

  /** rename retitles a timer whose name carries a callsign or item. */
  rename(name: string): void {
    if (this.name === name) return;
    this.name = name;
    this.root.setAttribute('aria-label', name);
  }

  /** update takes a snapshot's remaining milliseconds. */
  update(ms: number | null | undefined): void {
    if (ms === null || ms === undefined) {
      this.live = false;
      return;
    }
    this.live = true;
    const estimate = this.estimate();
    this.serverMS = ms;
    this.serverAt = performance.now();
    this.root.setAttribute('data-server-ms', String(Math.round(ms)));

    if (this.resolved && ms > 0) {
      this.resolved = false;
      this.outcome = '';
      this.root.classList.remove('splitting');
    }
    if (!this.options.countUp && !comfort.reduced() && Math.abs(estimate - ms) > maxDrift) {
      this.reflow();
    }
    this.tick();
  }

  /** resolve stamps a timer's outcome word, such as a revive window going out. */
  resolve(word: string): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolvedAt = performance.now();
    this.outcome = word;
    this.paintOutcome();
    this.options.onOutcome?.(word);
  }

  /** tick redraws the numeral between snapshots. */
  tick(): void {
    if (!this.live) return;
    if (this.resolved) {
      if (performance.now() - this.resolvedAt > outcomeHold) {
        clear(this.root);
        this.shown = '';
      }
      return;
    }
    const value = this.estimate();
    if (!this.options.countUp && value <= 0) {
      this.resolve(outcomeWord(this.name));
      return;
    }
    this.paint(this.options.countUp ? formatCountUp(value) : formatRemaining(value));
  }

  /** estimate reports the local countdown from the latest server value. */
  private estimate(): number {
    const since = performance.now() - this.serverAt;
    if (this.options.countUp) return this.serverMS + since;
    return Math.max(0, this.serverMS - since);
  }

  private reflow(): void {
    if (comfort.reduced()) return;
    this.root.classList.remove('reflow');
    void this.root.offsetWidth;
    this.root.classList.add('reflow');
  }

  private paint(text: string): void {
    if (text === this.shown) return;
    const previous = this.shown;
    this.shown = text;
    const rolling = !comfort.reduced();
    this.root.classList.toggle('rolling', rolling);
    clear(this.root);
    for (let i = 0; i < text.length; i += 1) {
      const changed = rolling && previous[i] !== text[i];
      this.root.appendChild(el('span', { class: changed ? 'digit changed' : 'digit' }, text[i]));
    }
  }

  private paintOutcome(): void {
    this.shown = this.outcome;
    if (!comfort.reduced()) {
      this.root.classList.add('splitting');
      window.setTimeout(() => {
        this.root.classList.remove('splitting');
        this.showOutcomeWord();
      }, 300);
      return;
    }
    this.showOutcomeWord();
  }

  private showOutcomeWord(): void {
    clear(this.root);
    this.root.appendChild(el('span', { class: 'outcome' }, this.outcome));
  }
}

/** FuseGroup keeps the open timers so the Timers list and the HUD agree. */
export class FuseGroup {
  private clocks = new Map<string, FuseClock>();
  private names = new Map<string, string>();

  get(key: string, name: string, options?: FuseOptions): FuseClock {
    let clock = this.clocks.get(key);
    if (!clock) {
      clock = new FuseClock(name, options);
      this.clocks.set(key, clock);
    }
    clock.rename(name);
    this.names.set(key, name);
    return clock;
  }

  drop(key: string): void {
    this.clocks.delete(key);
    this.names.delete(key);
  }

  keys(): string[] {
    return Array.from(this.clocks.keys());
  }

  tick(): void {
    for (const clock of this.clocks.values()) clock.tick();
  }

  /** entries reports each open timer's name and its shown value, for the Timers
   *  list, which shows the same values without motion. */
  entries(): { name: string; value: string }[] {
    const rows: { name: string; value: string }[] = [];
    for (const [key, clock] of this.clocks) {
      rows.push({ name: this.names.get(key) ?? '', value: clock.root.textContent ?? '' });
    }
    return rows;
  }
}
