/**
 * Countdown repaints a time-left line once a second from the seconds the
 * server reported and the time elapsed on the page since. The device clock
 * never decides whether a lot is open.
 */
export class Countdown {
  private readonly node: HTMLElement;
  private readonly label: (seconds: number, status: string) => string;
  private base = 0;
  private at = 0;
  private status = "open";
  private timer = 0;
  private countUp = 0;

  constructor(node: HTMLElement, label: (seconds: number, status: string) => string) {
    this.node = node;
    this.label = label;
  }

  /** set takes the server's remaining seconds and the lot's status. */
  set(remainingSeconds: number, status: string): void {
    this.base = remainingSeconds;
    this.at = performance.now();
    this.status = status;
    this.paint();
    window.clearInterval(this.timer);
    if (status === "open" || status === "extended") {
      this.timer = window.setInterval(() => this.paint(), 1000);
    }
  }

  private remaining(): number {
    const elapsed = (performance.now() - this.at) / 1000;
    return Math.max(0, Math.round(this.base - elapsed));
  }

  private paint(): void {
    const seconds = this.countUp > 0 ? this.countUp : this.remaining();
    this.node.textContent = this.label(seconds, this.status);
  }

  /**
   * countUpTo walks the figure up to the server's new value after an
   * extension. It repaints text rather than running an animation, so the lot
   * board's list of running animations stays the price's alone.
   */
  countUpTo(target: number): void {
    const from = this.remaining();
    if (target <= from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.paint();
      return;
    }
    const start = performance.now();
    const duration = 330;
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      this.countUp = Math.round(from + (target - from) * t);
      this.paint();
      if (t < 1) {
        window.requestAnimationFrame(step);
        return;
      }
      this.countUp = 0;
      this.paint();
    };
    window.requestAnimationFrame(step);
  }
}
