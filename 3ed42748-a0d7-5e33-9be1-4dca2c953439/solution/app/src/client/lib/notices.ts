// The Notices region: every pending and outcome copy goes here. A new notice fades in while
// sliding down 10px in 200ms; a cleared one fades out in 200ms. Phases are exposed on the region.
import { h, setData } from "./dom";
import { clamp01, easePrint, now, onReducedMotionChange, reducedMotion } from "./motion";

const ENTER_MS = 200;
const LEAVE_MS = 200;
const SLIDE_PX = 10;
const OUTCOME_LINGER_MS = 7000;

type Phase = "idle" | "entering" | "shown" | "leaving";

export class Notices {
  readonly el = h("div", { role: "status", "aria-live": "polite", "aria-label": "Notices", class: "notices" });
  private readonly line = h("p", { class: "notices-line" });
  private phase: Phase = "idle";
  /** Visual progress 0..1 of the current entry; leaving runs it back down. */
  private progressAt = 0;
  private changedAt = 0;
  private clearAt = Infinity;
  private frame = 0;

  constructor() {
    this.el.append(this.line);
    setData(this.el, "data-notice-phase", "idle");
    onReducedMotionChange(() => this.tick());
    document.addEventListener("visibilitychange", () => this.tick());
  }

  /** Shows copy; outcome copy clears itself after a while, pending copy stays until replaced. */
  say(text: string, pending = false): void {
    const t = now();
    const visual = this.visual(t);
    if (this.line.textContent !== text || this.phase === "leaving" || this.phase === "idle") {
      const moving = this.phase === "entering" || this.phase === "leaving";
      this.line.textContent = text;
      this.phase = "entering";
      this.progressAt = moving ? visual : 0;
      this.changedAt = t;
    }
    this.clearAt = pending ? Infinity : t + OUTCOME_LINGER_MS;
    this.tick();
  }

  clear(): void {
    if (this.phase === "idle" || this.phase === "leaving") return;
    const t = now();
    this.progressAt = this.visual(t);
    this.phase = "leaving";
    this.changedAt = t;
    this.clearAt = Infinity;
    this.tick();
  }

  current(): string {
    return this.phase === "idle" || this.phase === "leaving" ? "" : (this.line.textContent ?? "");
  }

  /** How far in the notice is drawn, 0 (hidden, raised) to 1 (resting). */
  private visual(t: number): number {
    if (this.phase === "shown") return 1;
    if (this.phase === "idle") return 0;
    if (this.phase === "entering") return clamp01(this.progressAt + (t - this.changedAt) / ENTER_MS);
    return clamp01(this.progressAt - (t - this.changedAt) / LEAVE_MS);
  }

  private tick = (): void => {
    cancelAnimationFrame(this.frame);
    const t = now();
    if (t >= this.clearAt && this.phase !== "leaving" && this.phase !== "idle") {
      this.progressAt = this.visual(t);
      this.phase = "leaving";
      this.changedAt = this.clearAt;
      this.clearAt = Infinity;
    }
    if (reducedMotion()) {
      if (this.phase === "entering") this.phase = "shown";
      if (this.phase === "leaving") this.phase = "idle";
    }
    const v = this.visual(t);
    if (this.phase === "entering" && v >= 1) this.phase = "shown";
    if (this.phase === "leaving" && v <= 0) this.phase = "idle";
    if (this.phase === "idle") this.line.textContent = "";
    const shown = this.phase === "shown" ? 1 : this.phase === "idle" ? 0 : easePrint(v);
    this.line.style.opacity = String(shown);
    this.line.style.transform = `translateY(${((shown - 1) * SLIDE_PX).toFixed(2)}px)`;
    setData(this.el, "data-notice-phase", this.phase);
    if (this.phase === "entering" || this.phase === "leaving" || this.clearAt !== Infinity)
      this.frame = requestAnimationFrame(this.tick);
  };
}
