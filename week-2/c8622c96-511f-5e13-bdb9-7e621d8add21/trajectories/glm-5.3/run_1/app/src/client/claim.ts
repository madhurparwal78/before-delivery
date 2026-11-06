// The grease-pencil claim: press and hold draws a safelight-red ring in step
// with hold time; 900 ms commits exactly one licence request. The ring and the
// progress bar are driven from elapsed hold time on the page's own timers.
import { el, prefersReducedMotion } from "./dom.js";

export const HOLD_MS = 900;
const RETRACT_MS = 250;

export interface ClaimCallbacks {
  onCommit: () => Promise<void>;
  onProgress: (value: number) => void;
  onStart: () => void;
  onCancel: () => void;
}

// One claim controller per essay screen, bound to the claim button. Reduced
// motion replaces the ring with the two-step pair.
export class ClaimControl {
  readonly button: HTMLButtonElement;
  private container: HTMLElement;
  private callbacks: ClaimCallbacks;
  private holding = false;
  private startAt = 0;
  private rafId = 0;
  private committed = false;
  private ring: SVGCircleElement | null = null;
  private twoStep = false;
  private keyHeld = false;
  private pointerActive = false;

  constructor(container: HTMLElement, callbacks: ClaimCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.twoStep = prefersReducedMotion();
    this.button = el("button", { class: "btn claim", type: "button", text: "Claim exclusive window" }) as HTMLButtonElement;
    this.button.setAttribute("aria-label", "Claim exclusive window");
    this.bindPointer();
    this.bindKeys();
  }

  render(target: HTMLElement): void {
    target.append(this.button);
    if (this.twoStep) {
      this.button.addEventListener("click", () => {
        if (this.button.disabled) return;
        this.showTwoStep();
      });
    }
  }

  private showTwoStep(): void {
    const pair = el("div", { class: "claim-twostep", role: "group", "aria-label": "Confirm claim" });
    const confirmBtn = el("button", { class: "btn claim", type: "button", text: "Confirm claim" }) as HTMLButtonElement;
    const cancelBtn = el("button", { class: "btn ghost", type: "button", text: "Cancel claim" }) as HTMLButtonElement;
    const label = el("span", { class: "mono dim", text: "Step 2 of 2" });
    pair.append(label, confirmBtn, cancelBtn);
    const restore = (): void => {
      this.container.querySelectorAll(".claim-twostep").forEach((n) => n.remove());
      this.button.style.display = "";
      this.button.focus();
    };
    confirmBtn.addEventListener("click", () => {
      pair.remove();
      this.button.style.display = "";
      void this.commit();
    });
    cancelBtn.addEventListener("click", restore);
    this.button.style.display = "none";
    this.container.append(pair);
    confirmBtn.focus();
    this.escapeStack.push(restore);
  }

  private escapeStack: Array<() => void> = [];

  escape(): boolean {
    const restore = this.escapeStack.pop();
    if (restore) {
      restore();
      return true;
    }
    return false;
  }

  private bindPointer(): void {
    this.button.addEventListener("pointerdown", (e) => {
      if (this.twoStep || this.button.disabled) return;
      if (e.pointerType === "mouse" || e.pointerType === "pen") {
        this.begin();
        const release = (): void => {
          this.end();
          this.button.removeEventListener("pointerup", release);
          this.button.removeEventListener("pointerleave", release);
        };
        this.button.addEventListener("pointerup", release);
        this.button.addEventListener("pointerleave", release);
      }
    });
    // Touch: the finger drives the hold; drift, second finger or a cancelled
    // touch sends nothing.
    this.button.addEventListener("touchstart", (e) => {
      if (this.twoStep || this.button.disabled || this.holding) return;
      const touch = e.touches[0];
      const startX = touch.clientX;
      const startY = touch.clientY;
      e.preventDefault();
      this.begin();
      const move = (ev: TouchEvent): void => {
        const t = ev.touches[0];
        if (!t) return;
        const dx = t.clientX - startX;
        const dy = t.clientY - startY;
        if (Math.hypot(dx, dy) > 10) cancel();
      };
      const second = (): void => cancel();
      const end = (ev: TouchEvent): void => {
        if (ev.touches.length > 0) return;
        cleanup();
        this.end();
      };
      const cancel = (): void => {
        cleanup();
        this.retract();
      };
      const cleanup = (): void => {
        this.button.removeEventListener("touchmove", move);
        this.button.removeEventListener("touchstart", second);
        this.button.removeEventListener("touchend", end);
        this.button.removeEventListener("touchcancel", cancel);
      };
      this.button.addEventListener("touchmove", move, { passive: false });
      this.button.addEventListener("touchstart", second);
      this.button.addEventListener("touchend", end);
      this.button.addEventListener("touchcancel", cancel);
    });
    this.button.addEventListener("contextmenu", (e) => e.preventDefault());
    const style = this.button.style as CSSStyleDeclaration & { webkitUserSelect?: string; webkitTouchCallout?: string };
    style.touchAction = "none";
    style.userSelect = "none";
    style.webkitUserSelect = "none";
    style.webkitTouchCallout = "none";
  }

  private bindKeys(): void {
    this.button.addEventListener("keydown", (e) => {
      if (this.twoStep || this.button.disabled) return;
      if (e.key === "Escape") {
        if (this.holding) this.retract();
        return;
      }
      if ((e.key === " " || e.key === "Enter") && !e.repeat && !this.keyHeld) {
        this.keyHeld = true;
        this.begin();
        e.preventDefault();
      }
    });
    this.button.addEventListener("keyup", (e) => {
      if (e.key === " " || e.key === "Enter") {
        this.keyHeld = false;
        if (this.holding) this.end();
      }
    });
  }

  private begin(): void {
    if (this.holding || this.button.disabled) return;
    this.holding = true;
    this.committed = false;
    this.startAt = performance.now();
    this.callbacks.onStart();
    this.drawRing(0);
    const step = (): void => {
      if (!this.holding) return;
      const elapsed = performance.now() - this.startAt;
      const value = Math.min(100, Math.round((elapsed / HOLD_MS) * 100));
      this.drawRing(value);
      this.callbacks.onProgress(value);
      if (elapsed >= HOLD_MS && !this.committed) {
        this.committed = true;
        this.end();
        void this.commit();
        return;
      }
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private end(): void {
    if (!this.holding) return;
    if (!this.committed) {
      this.retract();
    } else {
      this.holding = false;
    }
  }

  private retract(): void {
    this.holding = false;
    cancelAnimationFrame(this.rafId);
    // Retract the ring step by step back to twelve o'clock.
    const from = this.currentValue();
    const retractStart = performance.now();
    const step = (): void => {
      const t = Math.min(1, (performance.now() - retractStart) / RETRACT_MS);
      const value = Math.round(from * (1 - t));
      this.drawRing(value);
      this.callbacks.onProgress(value);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    this.callbacks.onCancel();
  }

  private currentValue(): number {
    if (!this.ring) return 0;
    const r = Number(this.ring.getAttribute("r"));
    const c = 2 * Math.PI * r;
    return Math.round((c - Number(this.ring.style.strokeDashoffset || 0)) / c * 100);
  }

  private drawRing(value: number): void {
    const prints = this.container.querySelector(".claim-prints");
    if (!prints) return;
    if (!this.ring) {
      const size = 96;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "claim-ring");
      svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
      svg.setAttribute("aria-hidden", "true");
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(size / 2));
      circle.setAttribute("cy", String(size / 2));
      circle.setAttribute("r", String(size / 2 - 3));
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "currentColor");
      circle.setAttribute("stroke-width", "3");
      circle.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
      const r = size / 2 - 3;
      circle.style.strokeDasharray = String(2 * Math.PI * r);
      circle.style.strokeDashoffset = String(2 * Math.PI * r);
      svg.append(circle);
      prints.append(svg);
      this.ring = circle;
    }
    const r = Number(this.ring.getAttribute("r"));
    const c = 2 * Math.PI * r;
    this.ring.style.strokeDashoffset = String(c - (c * value) / 100);
  }

  private async commit(): Promise<void> {
    this.button.disabled = true;
    this.callbacks.onProgress(100);
    try {
      await this.callbacks.onCommit();
    } finally {
      if (this.twoStep) {
        // The two-step pair disappears once the server answers, and the
        // button returns enabled after a confirmed claim.
        this.button.disabled = false;
      } else {
        this.button.disabled = false;
      }
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
  }
}
