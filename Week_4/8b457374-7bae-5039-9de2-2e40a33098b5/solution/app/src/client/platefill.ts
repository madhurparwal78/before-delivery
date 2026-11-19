import { s } from "./dom.js";

// Plate Fill (brief: Motion and effects). A hex screen of 217 dots, rings 0 to 8 with 6k dots in ring k,
// plus one ring per stretch break point. Ring k's coverage is clamp(9f - k, 0, 1) with f = total / goal;
// a stretch ring's is clamp((total - previous) / (amount - previous), 0, 1). Dot diameter is
// pitch x 1.155 x sqrt(coverage). Coverages are exact rationals, written to three decimals rounded half up.

const PITCH = 10;
const CORE_RINGS = 8;
const RING_STEP_MS = 40;
const INK_MS = 500;
const INK_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const AXIAL: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

interface Coverage {
  value: number;
  text: string;
}

function coverage(numerator: number, denominator: number): Coverage {
  if (numerator <= 0) return { value: 0, text: "0.000" };
  if (numerator >= denominator) return { value: 1, text: "1.000" };
  const thousandths = Math.floor((2000 * numerator + denominator) / (2 * denominator));
  const text = thousandths >= 1000 ? "1.000" : `0.${String(thousandths).padStart(3, "0")}`;
  return { value: numerator / denominator, text };
}

function radius(c: number): number {
  return (PITCH * 1.155 * Math.sqrt(c)) / 2;
}

interface Dot {
  ring: number;
  fill: SVGCircleElement;
  proof: SVGCircleElement;
}

export class PlateFill {
  readonly el: SVGSVGElement;
  private readonly dots: Dot[] = [];
  private readonly rings: number;
  private total: number;

  constructor(private readonly goal: number, private readonly stretch: number[], total: number, percent: number, private readonly suffix: string) {
    this.total = total;
    this.rings = CORE_RINGS + stretch.length;
    const half = (this.rings + 0.62) * PITCH;
    const screen = s("g", { class: "pf-screen-layer" });
    const fills = s("g", { class: "pf-ink" });
    const proofs = s("g", { class: "pf-proof" });
    this.el = s("svg", {
      class: "plate-fill", role: "img", viewBox: `${-half} ${-half} ${2 * half} ${2 * half}`, focusable: "false",
    }, s("circle", { class: "pf-plate", cx: 0, cy: 0, r: (half - 0.2 * PITCH).toFixed(2) }), screen, fills, proofs);
    for (let ring = 0; ring <= this.rings; ring++) {
      for (const [q, r] of PlateFill.ring(ring)) {
        const cx = (PITCH * (q + r / 2)).toFixed(3);
        const cy = (PITCH * (Math.sqrt(3) / 2) * r).toFixed(3);
        const fill = s("circle", { cx, cy, r: 0, "data-ring": ring, "data-coverage": "0.000" });
        const proof = s("circle", { cx, cy, r: 0, class: "proof-dot" });
        screen.append(s("circle", { cx, cy, r: (PITCH * 0.28).toFixed(2), class: "pf-screen" }));
        fills.append(fill);
        proofs.append(proof);
        this.dots.push({ ring, fill, proof });
      }
    }
    this.draw(total, percent);
  }

  private static ring(k: number): [number, number][] {
    if (k === 0) return [[0, 0]];
    const out: [number, number][] = [];
    let [q, r] = [AXIAL[4][0] * k, AXIAL[4][1] * k];
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < k; step++) {
        out.push([q, r]);
        q += AXIAL[side][0];
        r += AXIAL[side][1];
      }
    }
    return out;
  }

  private coverageAt(ring: number, total: number): Coverage {
    if (ring <= CORE_RINGS) return coverage(9 * total - ring * this.goal, this.goal);
    const index = ring - CORE_RINGS - 1;
    const previous = index === 0 ? this.goal : this.stretch[index - 1];
    return coverage(total - previous, this.stretch[index] - previous);
  }

  private label(percent: number): void {
    this.el.setAttribute("aria-label", `Plate Fill: ${percent}%${this.suffix}`);
  }

  /** Draws every dot straight at the coverage for `total`; `percent` is the server's figure for the label. */
  draw(total: number, percent: number): void {
    this.total = total;
    for (const dot of this.dots) {
      const c = this.coverageAt(dot.ring, total);
      dot.fill.setAttribute("data-coverage", c.text);
      dot.fill.setAttribute("r", radius(c.value).toFixed(3));
    }
    this.label(percent);
  }

  /** Outlines every dot whose projected coverage is above its current one; null clears the proof layer. */
  proof(projected: number | null): void {
    for (const dot of this.dots) {
      const now = this.coverageAt(dot.ring, this.total);
      const next = projected === null ? null : this.coverageAt(dot.ring, projected);
      if (next && next.value > now.value) {
        dot.fill.setAttribute("data-proof-coverage", next.text);
        dot.proof.setAttribute("r", radius(next.value).toFixed(3));
        dot.proof.classList.add("on");
      } else {
        dot.fill.removeAttribute("data-proof-coverage");
        dot.proof.classList.remove("on");
      }
    }
  }

  /**
   * The ink sequence: ring by ring from the centre, each ring starting 40 ms after the one inside it and
   * inking for 500 ms; a ring's dots take their new coverage when its ink starts. Reduced motion: at once.
   */
  ink(total: number, percent: number, reduced: boolean): void {
    const before = this.total;
    this.total = total;
    this.label(percent);
    const inkRing = (ring: number) => {
      for (const dot of this.dots) {
        if (dot.ring !== ring) continue;
        const from = this.coverageAt(ring, before).value;
        const c = this.coverageAt(ring, total);
        dot.fill.setAttribute("data-coverage", c.text);
        dot.fill.removeAttribute("data-proof-coverage");
        dot.proof.classList.remove("on");
        dot.fill.setAttribute("r", radius(c.value).toFixed(3));
        if (!reduced && from !== c.value) {
          dot.fill.animate([{ r: `${radius(from)}px` }, { r: `${radius(c.value)}px` }], { duration: INK_MS, easing: INK_EASING });
        }
      }
    };
    for (let ring = 0; ring <= this.rings; ring++) {
      if (reduced || ring === 0) inkRing(ring);
      else setTimeout(() => inkRing(ring), ring * RING_STEP_MS);
    }
  }
}

/** Counts a figure from one amount to another over the ink's half second; resolves when it shows the final value. */
export function countUp(el: HTMLElement, from: number, to: number, format: (pence: number) => string, reduced: boolean): Promise<void> {
  if (reduced || from === to) {
    el.textContent = format(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    const frame = () => {
      const t = Math.min(1, (performance.now() - start) / INK_MS);
      const permille = Math.round(1000 * (1 - Math.pow(1 - t, 4)));
      el.textContent = format(t >= 1 ? to : from + Math.trunc(((to - from) * permille) / 1000));
      if (t >= 1) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
