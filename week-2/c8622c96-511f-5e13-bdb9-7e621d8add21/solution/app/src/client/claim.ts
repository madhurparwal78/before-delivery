// The grease-pencil claim hold. Progress is driven only by elapsed hold time measured with performance.now()
// and animation frames: empty at press, half at 450 ms, closed (the commit point) at 900 ms. An early release
// retracts it step by step to twelve o'clock over 250 ms. Pointer, touch and Space/Enter all drive the same hold.

export const COMMIT_MS = 900;
const RETRACT_MS = 250;
const TOUCH_SLOP_PX = 10;

type Phase = "idle" | "holding" | "retracting";

export interface HoldView {
  /** 0..1 ring and progressbar position. */
  draw(progress: number): void;
  commit(): void;
}

export class ClaimHold {
  private phase: Phase = "idle";
  private started = 0;
  private from = 0;
  private progress = 0;
  private frame = 0;
  private touchOrigin: { x: number; y: number } | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(button: HTMLButtonElement, private readonly view: HoldView,
    private readonly enabled: () => boolean) {
    const listen = <K extends keyof HTMLElementEventMap>(target: HTMLElement | Document, type: K,
      handler: (event: HTMLElementEventMap[K]) => void, options: AddEventListenerOptions = {}): void => {
      target.addEventListener(type, handler as EventListener, options);
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
    };
    listen(button, "pointerdown", (event) => {
      if (event.pointerType === "touch" || event.button !== 0 || !this.enabled()) return;
      event.preventDefault();
      this.start();
    });
    for (const type of ["pointerup", "pointerleave", "pointercancel"] as const) {
      listen(button, type, (event) => {
        if (event.pointerType !== "touch") this.release();
      });
    }
    listen(button, "keydown", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      if (!this.enabled()) return;
      event.preventDefault();
      if (event.repeat || this.phase === "holding") return;
      this.start();
    });
    listen(button, "keyup", (event) => {
      if (event.key !== " " && event.key !== "Enter") return;
      if (!this.enabled()) return;
      event.preventDefault();
      this.release();
    });
    listen(button, "touchstart", (event) => {
      if (!this.enabled()) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (event.touches.length !== 1 || !touch) {
        this.release();
        return;
      }
      this.touchOrigin = { x: touch.clientX, y: touch.clientY };
      this.start();
    }, { passive: false });
    listen(button, "touchmove", (event) => {
      if (!this.enabled()) return;
      event.preventDefault();
      const touch = event.touches[0];
      if (this.touchOrigin && touch
        && Math.hypot(touch.clientX - this.touchOrigin.x, touch.clientY - this.touchOrigin.y) > TOUCH_SLOP_PX) {
        this.release();
      }
    }, { passive: false });
    listen(button, "touchend", (event) => {
      if (!this.enabled()) return;
      event.preventDefault();
      this.release();
    }, { passive: false });
    listen(button, "touchcancel", () => this.release());
    // A second finger anywhere cancels the hold.
    listen(document, "touchstart", (event) => {
      if (event.touches.length > 1) this.release();
    }, { capture: true, passive: true });
    listen(document, "keydown", (event) => {
      if (event.key === "Escape" && this.phase === "holding") {
        event.preventDefault();
        event.stopPropagation();
        this.release();
      }
    }, { capture: true });
  }

  get holding(): boolean {
    return this.phase === "holding";
  }

  private start(): void {
    cancelAnimationFrame(this.frame);
    this.phase = "holding";
    this.started = performance.now();
    this.progress = 0;
    this.view.draw(0);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private release(): void {
    if (this.phase !== "holding") return;
    this.touchOrigin = null;
    this.phase = "retracting";
    this.from = this.progress;
    this.started = performance.now();
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    const elapsed = performance.now() - this.started;
    if (this.phase === "holding") {
      this.progress = Math.min(1, elapsed / COMMIT_MS);
      this.view.draw(this.progress);
      if (elapsed >= COMMIT_MS) {
        this.phase = "idle";
        this.touchOrigin = null;
        this.view.commit();
        return;
      }
    } else if (this.phase === "retracting") {
      this.progress = Math.max(0, this.from * (1 - elapsed / RETRACT_MS));
      this.view.draw(this.progress);
      if (this.progress === 0) {
        this.phase = "idle";
        return;
      }
    } else return;
    this.frame = requestAnimationFrame(() => this.tick());
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    for (const undo of this.cleanups) undo();
  }
}
