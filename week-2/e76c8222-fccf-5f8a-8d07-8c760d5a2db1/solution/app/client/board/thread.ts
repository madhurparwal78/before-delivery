// The match thread: an SVG string from a chip to the pointer that follows, pins to a socket or recoils.
import { prefersReducedMotion, svg } from "../dom.js";

interface Point {
  x: number;
  y: number;
}

const PIN_MS = 200;
const PIN_HOLD_MS = 420;
const RECOIL_MS = 380;
const SAG = 0.06;

/** Back-out easing with a small overshoot (about 2 %). */
const backOut = (t: number): number => {
  const s = 0.6;
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** Visible share of the thread during a recoil: back to the chip, one slight rebound, gone. */
const recoilShare = (t: number): number => {
  if (t < 0.8) return 1 - easeOut(t / 0.8);
  if (t < 0.9) return 0.04 * ((t - 0.8) / 0.1);
  return 0.04 * (1 - (t - 0.9) / 0.1);
};

function tween(ms: number, step: (t: number) => void, done: () => void): void {
  const start = performance.now();
  const frame = (now: number): void => {
    const t = Math.min(1, (now - start) / ms);
    step(t);
    if (t < 1) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
}

export class Thread {
  private readonly layer: SVGSVGElement;
  private readonly path: SVGPathElement;
  private readonly head: SVGCircleElement;
  private readonly tail: SVGCircleElement;
  private end: Point;
  private settled = false;

  /** `anchor` returns the chip's edge each frame, so a scrolled page keeps the thread on its chip. */
  constructor(private readonly anchor: () => Point, start: Point) {
    this.path = svg("path", { fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round" });
    this.head = svg("circle", { r: "3", fill: "currentColor" });
    this.tail = svg("circle", { r: "3", fill: "currentColor" });
    this.layer = svg("svg", { class: "thread-layer", role: "img", "aria-label": "Match thread" }, this.path, this.tail, this.head);
    document.body.append(this.layer);
    this.end = start;
    this.draw();
  }

  private shape(from: Point, to: Point): string {
    if (prefersReducedMotion()) return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const sag = Math.hypot(dx, dy) * SAG;
    const c1 = { x: from.x + dx / 3, y: from.y + dy / 3 + sag };
    const c2 = { x: from.x + (2 * dx) / 3, y: from.y + (2 * dy) / 3 + sag };
    return `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`;
  }

  private draw(): void {
    const from = this.anchor();
    this.path.setAttribute("d", this.shape(from, this.end));
    this.tail.setAttribute("cx", String(from.x));
    this.tail.setAttribute("cy", String(from.y));
    this.head.setAttribute("cx", String(this.end.x));
    this.head.setAttribute("cy", String(this.end.y));
  }

  follow(to: Point): void {
    if (this.settled) return;
    this.end = to;
    this.draw();
  }

  /** Springs taut to the socket, holds there a moment, then is removed. */
  pin(socket: Point): void {
    this.settled = true;
    const from = this.end;
    const remove = (): void => void setTimeout(() => this.remove(), PIN_HOLD_MS);
    if (prefersReducedMotion()) {
      this.end = socket;
      this.draw();
      remove();
      return;
    }
    tween(
      PIN_MS,
      (t) => {
        const k = backOut(t);
        this.end = { x: from.x + (socket.x - from.x) * k, y: from.y + (socket.y - from.y) * k };
        this.draw();
      },
      remove,
    );
  }

  /** Springs back along its own path to the chip; with reduced motion it disappears at once. */
  recoil(): void {
    this.settled = true;
    if (prefersReducedMotion()) {
      this.remove();
      return;
    }
    const length = this.path.getTotalLength();
    tween(
      RECOIL_MS,
      (t) => {
        const shown = length * recoilShare(t);
        this.path.setAttribute("stroke-dasharray", `${shown} ${length + 10}`);
        const tip = this.path.getPointAtLength(shown);
        this.head.setAttribute("cx", String(tip.x));
        this.head.setAttribute("cy", String(tip.y));
        this.head.setAttribute("r", shown > 1 ? "3" : "0");
      },
      () => this.remove(),
    );
  }

  remove(): void {
    this.layer.remove();
  }
}
