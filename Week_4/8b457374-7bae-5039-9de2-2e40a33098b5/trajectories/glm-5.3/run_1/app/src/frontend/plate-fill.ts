// Plate Fill: the halftone gauge. A centre dot (ring 0) and rings 1..8 with
// 6k dots each make the 217-dot hex screen; each stretch break point adds one
// outer ring.

export interface PlateFillData {
  total: number;
  goal: number;
  stretch: { copies: number; amount: number; reached: boolean }[];
}

interface DotSpec {
  ring: number;
  x: number;
  y: number;
}

export class PlateFill {
  private readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly dots: SVGCircleElement[] = [];
  private readonly specs: DotSpec[] = [];
  private ringCount = 8;
  private readonly reducedMotion: boolean;

  constructor(element: HTMLElement, reducedMotion: boolean) {
    this.element = element;
    this.reducedMotion = reducedMotion;
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.setAttribute("viewBox", "-110 -110 220 220");
    this.svg.setAttribute("role", "img");
    this.element.appendChild(this.svg);
  }

  private buildDots(ringCount: number): void {
    if (ringCount === this.ringCount && this.dots.length > 0) return;
    this.ringCount = ringCount;
    this.svg.replaceChildren();
    this.dots.length = 0;
    this.specs.length = 0;

    // The pitch is the distance between neighbouring dot centres; the base
    // screen spans the viewBox with ring 8 near its edge.
    const pitch = 12.5;
    for (let ring = 0; ring <= ringCount; ring += 1) {
      const count = ring === 0 ? 1 : 6 * ring;
      for (let i = 0; i < count; i += 1) {
        let x = 0;
        let y = 0;
        if (ring > 0) {
          // Hex placement: each ring turns by half a segment per ring so dots
          // pack like a printing screen.
          const angle = (i / count) * Math.PI * 2 + (ring % 2) * (Math.PI / count);
          const radius = ring * pitch * 1.155;
          x = Math.cos(angle) * radius;
          y = Math.sin(angle) * radius;
        }
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", x.toFixed(2));
        circle.setAttribute("cy", y.toFixed(2));
        circle.setAttribute("r", "0");
        circle.setAttribute("class", "pf-dot");
        circle.setAttribute("data-ring", String(ring));
        circle.setAttribute("data-coverage", "0.000");
        this.svg.appendChild(circle);
        this.dots.push(circle);
        this.specs.push({ ring, x, y });
      }
    }
  }

  /**
   * Coverage of ring k for the funded fraction f: clamp(9f - k, 0, 1).
   * Stretch rings sit outside ring 8 and fill from the previous amount.
   */
  private coverageForRing(ring: number, data: PlateFillData): number {
    if (ring <= 8) {
      const f = data.goal === 0 ? 1 : data.total / data.goal;
      return clamp(9 * f - ring, 0, 1);
    }
    const stretchIndex = ring - 9;
    const breakPoint = data.stretch[stretchIndex];
    if (breakPoint === undefined) return 0;
    const previousAmount =
      stretchIndex === 0 ? data.goal : (data.stretch[stretchIndex - 1]?.amount ?? data.goal);
    const span = breakPoint.amount - previousAmount;
    if (span <= 0) return 0;
    return clamp((data.total - previousAmount) / span, 0, 1);
  }

  /** Draws the gauge straight at its coverage (first load, reduced motion). */
  render(data: PlateFillData, percentLabel: string): void {
    const ringCount = 8 + data.stretch.length;
    this.buildDots(ringCount);
    this.svg.setAttribute(
      "aria-label",
      `Plate Fill: ${percentLabel}% of the minimum run`,
    );
    for (let i = 0; i < this.dots.length; i += 1) {
      const spec = this.specs[i];
      if (spec === undefined) continue;
      const coverage = this.coverageForRing(spec.ring, data);
      this.applyCoverage(this.dots[i], coverage);
    }
  }

  private applyCoverage(dot: SVGCircleElement, coverage: number): void {
    dot.setAttribute("data-coverage", coverage.toFixed(3));
    const diameter = 12.5 * 1.155 * Math.sqrt(coverage);
    dot.setAttribute("r", (diameter / 2).toFixed(2));
  }

  /**
   * The proof layer: outline circles at the projected size for every dot whose
   * projected coverage is higher than its current coverage.
   */
  renderProof(data: PlateFillData): void {
    this.clearProof();
    for (let i = 0; i < this.dots.length; i += 1) {
      const spec = this.specs[i];
      const dot = this.dots[i];
      if (spec === undefined || dot === undefined) continue;
      const current = Number(dot.getAttribute("data-coverage") ?? "0");
      const projected = this.coverageForRing(spec.ring, data);
      if (projected > current + 0.0005) {
        dot.setAttribute("data-proof-coverage", projected.toFixed(3));
        dot.classList.add("outline");
        dot.setAttribute("r", ((12.5 * 1.155 * Math.sqrt(projected)) / 2).toFixed(2));
      }
    }
  }

  clearProof(): void {
    for (const dot of this.dots) {
      if (dot.hasAttribute("data-proof-coverage")) {
        dot.removeAttribute("data-proof-coverage");
        dot.classList.remove("outline");
      }
    }
  }

  /**
   * The ink sequence after a confirmed hold: proof outlines fill solid ring by
   * ring from the centre out. Each ring's ink starts about 0.04s after the ring
   * inside it and takes about half a second; the whole fill finishes within a
   * second. Each dot's data-coverage takes its new value when its ring starts.
   */
  async inkTo(data: PlateFillData, percentLabel: string): Promise<void> {
    this.svg.setAttribute("aria-label", `Plate Fill: ${percentLabel}% of the minimum run`);
    if (this.reducedMotion) {
      for (let i = 0; i < this.dots.length; i += 1) {
        const spec = this.specs[i];
        if (spec === undefined) continue;
        this.applyCoverage(this.dots[i], this.coverageForRing(spec.ring, data));
      }
      this.clearProof();
      return;
    }
    const rings = new Map<number, SVGCircleElement[]>();
    for (let i = 0; i < this.dots.length; i += 1) {
      const spec = this.specs[i];
      const dot = this.dots[i];
      if (spec === undefined || dot === undefined) continue;
      const list = rings.get(spec.ring) ?? [];
      list.push(dot);
      rings.set(spec.ring, list);
    }
    const ringNumbers = [...rings.keys()].sort((a, b) => a - b);
    const staggerMs = 40;
    await Promise.all(
      ringNumbers.map((ring, index) => {
        // The whole fill finishes within one second of the confirmation.
        const delay = Math.min(ring * staggerMs, 480);
        const duration = Math.max(120, 500 - index * 10);
        return new Promise<void>((resolve) => {
          window.setTimeout(() => {
            const dotsInRing = rings.get(ring) ?? [];
            for (const dot of dotsInRing) {
              dot.classList.remove("outline");
              dot.removeAttribute("data-proof-coverage");
              dot.style.transition = `r ${duration}ms ease-out`;
            }
            for (const dot of dotsInRing) {
              const specIndex = this.dots.indexOf(dot);
              const spec = this.specs[specIndex];
              if (spec !== undefined) {
                this.applyCoverage(dot, this.coverageForRing(spec.ring, data));
              }
            }
            window.setTimeout(() => resolve(), duration);
          }, delay);
        });
      }),
    );
    for (const dot of this.dots) {
      dot.style.transition = "";
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Creates and mounts a Plate Fill into the given container. */
export function mountPlateFill(
  container: HTMLElement,
  reducedMotion: boolean,
): PlateFill {
  return new PlateFill(container, reducedMotion);
}

export function reducedMotionRequested(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
