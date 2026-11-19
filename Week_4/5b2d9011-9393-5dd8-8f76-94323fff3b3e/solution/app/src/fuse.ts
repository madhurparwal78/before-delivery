import { h } from "./dom";
import { formatFuse, formatLapRunning } from "./format";
import { isReduced } from "./state";

interface FuseOptions {
  /** The timer's name: its accessible name and its entry in the Timers list. */
  name: string;
  /** The word that replaces the numeral at zero. */
  outcome: string;
  /** The Lap timer counts up and never resolves by itself. */
  countUp?: boolean;
  /** Between snapshots the numeral never drifts from the latest server value by more than this. */
  maxExtrapolateMs?: number;
  /** Called once when the numeral resolves to its outcome. */
  onResolve?: (fuse: Fuse) => void;
  /** Called when the outcome word has been shown long enough. */
  onDone?: (fuse: Fuse) => void;
}

const OUTCOME_HOLD_MS = 1500;
const SPLIT_MS = 330;
const ROLL_MS = 100;
const REFLOW_MS = 200;
const DEFAULT_EXTRAPOLATE_MS = 100;

/** A Fuse Clock numeral: counts from the latest server value, re-flows to each snapshot and resolves at zero. */
export class Fuse {
  readonly el: HTMLElement;
  serverMs = 0;
  resolved = false;
  private receivedAt = performance.now();
  private shown = "";
  private digits: HTMLElement[] = [];
  private dead = false;

  constructor(private readonly options: FuseOptions) {
    this.el = h("span", { class: "fuse", role: "timer", "aria-label": options.name, "data-server-ms": "0" });
    activeFuses.add(this);
    ensureLoop();
  }

  /** The text the numeral shows right now. */
  get text(): string {
    return this.el.textContent?.trim() ?? "";
  }

  private estimate(): number {
    const elapsed = Math.max(0, performance.now() - this.receivedAt);
    if (this.options.countUp) return this.serverMs + elapsed;
    const limit = this.options.maxExtrapolateMs ?? DEFAULT_EXTRAPOLATE_MS;
    return Math.max(0, this.serverMs - Math.min(elapsed, limit));
  }

  /** The server's latest remaining (or elapsed) milliseconds. */
  set(ms: number | null): void {
    if (this.dead || this.resolved) return;
    if (ms === null || (!this.options.countUp && ms <= 0)) {
      this.resolve();
      return;
    }
    const previous = this.estimate();
    this.serverMs = ms;
    this.receivedAt = performance.now();
    this.el.setAttribute("data-server-ms", String(Math.round(ms)));
    this.paint(Math.abs(previous - ms) > 150 ? REFLOW_MS : ROLL_MS);
  }

  /** Resolve to an outcome word now (default: the timer's own). */
  resolve(word: string = this.options.outcome): void {
    if (this.resolved || this.dead) return;
    this.resolved = true;
    this.el.setAttribute("data-server-ms", "0");
    const show = (): void => {
      this.el.classList.add("is-outcome");
      this.setText(word, 0);
      this.options.onResolve?.(this);
      window.setTimeout(() => {
        this.destroy();
        this.options.onDone?.(this);
      }, OUTCOME_HOLD_MS);
    };
    if (isReduced() || this.digits.length === 0) {
      show();
      return;
    }
    this.digits.forEach((digit, i) => {
      digit.animate(
        [{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${(i - this.digits.length / 2) * 10}px)`, opacity: 0 }],
        { duration: SPLIT_MS, easing: "ease-in", fill: "forwards" },
      );
    });
    window.setTimeout(show, SPLIT_MS);
  }

  destroy(): void {
    this.dead = true;
    activeFuses.delete(this);
  }

  /** Called on every animation frame. */
  tick(): void {
    if (this.dead || this.resolved) return;
    const value = this.estimate();
    if (!this.options.countUp && value <= 0 && performance.now() - this.receivedAt >= this.serverMs) this.resolve();
    else this.paint(ROLL_MS);
  }

  private paint(duration: number): void {
    const value = this.estimate();
    this.setText(this.options.countUp ? formatLapRunning(value) : formatFuse(value), duration);
  }

  private setText(text: string, duration: number): void {
    if (text === this.shown) return;
    const previous = this.shown;
    this.shown = text;
    if (this.digits.length !== text.length || this.resolved) {
      this.el.textContent = "";
      this.digits = Array.from(text, (c) => h("span", { class: "digit" }, c));
      this.el.append(...this.digits);
      return;
    }
    this.digits.forEach((digit, i) => {
      if (text[i] === previous[i]) return;
      digit.textContent = text[i];
      if (!isReduced()) digit.animate([{ transform: "translateY(60%)", opacity: 0.2 }, { transform: "translateY(0)", opacity: 1 }], { duration, easing: "ease-out" });
    });
  }
}

const activeFuses = new Set<Fuse>();

function ensureLoop(): void {
  if (activeFuses.size === 0) return;
  cancelAnimationFrame(loopHandle);
  const run = (): void => {
    for (const fuse of [...activeFuses]) fuse.tick();
    loopHandle = activeFuses.size > 0 ? requestAnimationFrame(run) : 0;
  };
  loopHandle = requestAnimationFrame(run);
}

let loopHandle = 0;
