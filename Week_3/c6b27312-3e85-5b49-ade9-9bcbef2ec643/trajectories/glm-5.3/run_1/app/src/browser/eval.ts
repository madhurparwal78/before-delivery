import { api, ApiError } from "./api.js";
import { announce } from "./dom.js";
import type { Values } from "../shared/records.js";
import { formatFixed } from "../shared/numbers.js";

export type EvalState = "settled" | "dirty" | "stale" | "evaluating" | "settling" | "failed";

export interface EvalSnapshot {
  volume: number;
  bbox: number[];
  faces: number;
  digest: string;
  solid: { ops: Array<Record<string, number | string>> } | null;
}

/**
 * The evaluation lifecycle of one part page: one evaluation per burst, the
 * newest result wins, supersession cancels, and the camera never moves.
 */
export class EvalEngine {
  private seq = 0;
  private appliedSeq = 0;
  private state: EvalState = "settled";
  private timer: number | null = null;
  private abort: AbortController | null = null;
  private slowTimer: number | null = null;
  readonly viewer: string;

  constructor(
    readonly partSlug: string,
    private readonly debounceMs: number,
    private readonly slowMs: number,
    viewer: string,
    private readonly onSettled: (snap: EvalSnapshot) => void,
    private readonly onFailed: (diagnostic: { code: string; message: string; parameter: string | null }) => void,
    private readonly onStateChange: (state: EvalState) => void,
    private readonly viewportRoot: HTMLElement
  ) {
    this.viewer = viewer;
  }

  get currentState(): EvalState { return this.state; }
  get currentSeq(): number { return this.appliedSeq; }

  /** A commit: mark dirty, restart the debounce, supersede anything in flight. */
  commit(): void {
    if (this.state === "evaluating") {
      this.abort?.abort();
      void api.cancel(this.viewer);
      this.setState("stale");
      announce("eval-status", "Superseded by a newer change.");
    } else if (this.state === "settled" || this.state === "failed") {
      this.setState("dirty");
    } else {
      this.setState(this.state === "dirty" ? "dirty" : "stale");
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { void this.evaluate(); }, this.debounceMs);
  }

  private setState(s: EvalState): void {
    this.state = s;
    this.viewportRoot.dataset.evalState = s;
    this.onStateChange(s);
  }

  private async evaluate(): Promise<void> {
    this.timer = null;
    if (this.state === "stale" && this.appliedSeq > 0) {
      // A commit while stale still sends a fresh evaluation after the debounce.
    }
    this.setState("evaluating");
    this.abort = new AbortController();
    this.showSlowNoticeSoon();
    this.seq += 1;
    const seq = this.seq;
    try {
      const values = this.currentValues();
      const res = await api.evaluate(this.partSlug, values, seq, this.viewer, this.abort.signal);
      if (res.status === "cancelled") return;
      if (seq < this.appliedSeq) return;
      if (seq < this.seq) {
        // A newer commit has arrived; drop this response.
        return;
      }
      this.appliedSeq = seq;
      this.hideSlowNotice();
      if (res.status === "failed") {
        const first = res.diagnostics[0]!;
        this.setState("failed");
        this.onFailed(first);
        announce("eval-status", `Could not evaluate: ${first.message}`);
        return;
      }
      this.setState("settling");
      const snap: EvalSnapshot = {
        volume: res.volume,
        bbox: res.bbox,
        faces: res.faces,
        digest: res.geometryDigest ?? "",
        solid: res.solid,
      };
      this.onSettled(snap);
      announce("eval-status", `Updated: ${formatFixed(res.volume, 2)}\u202Fmm\u00b3`);
      // The cross-fade duration; reduced motion swaps at once.
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => this.setState("settled"), reduced ? 0 : 140);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof ApiError && err.status === 0) return;
      if (seq < this.appliedSeq || seq < this.seq) return;
      this.hideSlowNotice();
      this.setState("settled");
    }
  }

  /** The current values; provided by the page. */
  currentValues: () => Values = () => ({});

  private slowNotice: HTMLElement | null = null;

  private showSlowNoticeSoon(): void {
    this.hideSlowNotice();
    this.slowTimer = window.setTimeout(() => {
      this.slowNotice = document.querySelector('[data-ui="slow-notice"]');
      this.slowNotice?.classList.add("shown");
    }, this.slowMs);
  }

  private hideSlowNotice(): void {
    if (this.slowTimer !== null) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
    document.querySelector('[data-ui="slow-notice"]')?.classList.remove("shown");
  }
}
