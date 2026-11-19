import type { StretchPointDto } from '../../shared/types.js';
import { prefersReducedMotion, svg } from '../dom.js';

/** The gauge is a centre dot plus rings 1 to 8, with ring k holding 6k dots. */
const BASE_RINGS = 8;
const PITCH = 1;
const DOT_FACTOR = 1.155;
const RING_STAGGER_MS = 40;
const RING_INK_MS = 500;

export interface PlateDot {
  readonly ring: number;
  readonly x: number;
  readonly y: number;
}

/** Hex distance in axial coordinates. */
function hexDistance(q: number, r: number): number {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}

export function plateDots(maxRing: number): PlateDot[] {
  const dots: PlateDot[] = [];
  for (let ring = 0; ring <= maxRing; ring += 1) {
    const inRing: PlateDot[] = [];
    for (let q = -ring; q <= ring; q += 1) {
      for (let r = -ring; r <= ring; r += 1) {
        if (hexDistance(q, r) !== ring) continue;
        inRing.push({
          ring,
          x: PITCH * (q + r / 2),
          y: PITCH * r * (Math.sqrt(3) / 2),
        });
      }
    }
    inRing.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    dots.push(...inRing);
  }
  return dots;
}

export interface PlateReading {
  readonly total: number;
  readonly goal: number;
  readonly stretch: readonly StretchPointDto[];
}

/**
 * Ring k of the disc has coverage clamp(9f - k, 0, 1). Each stretch break point adds
 * one ring outside ring 8, filling from the previous break point to its own amount.
 */
export function coverageFor(reading: PlateReading, ring: number): number {
  if (ring <= BASE_RINGS) {
    const fraction = reading.total / reading.goal;
    return clamp(9 * fraction - ring, 0, 1);
  }
  const index = ring - BASE_RINGS - 1;
  const point = reading.stretch[index];
  if (point === undefined) return 0;
  const previous = index === 0 ? reading.goal : (reading.stretch[index - 1] as StretchPointDto).amount;
  return clamp((reading.total - previous) / (point.amount - previous), 0, 1);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

const diameterFor = (coverage: number): number => PITCH * DOT_FACTOR * Math.sqrt(coverage);

const format = (coverage: number): string => coverage.toFixed(3);

export class PlateFill {
  readonly root: SVGSVGElement;
  private readonly dots: SVGCircleElement[] = [];
  private readonly proofs: SVGCircleElement[] = [];
  private readonly geometry: PlateDot[];
  private reading: PlateReading;
  private maxRing: number;
  private inkTimers: number[] = [];

  constructor(reading: PlateReading, label: string) {
    this.reading = reading;
    this.maxRing = BASE_RINGS + Math.min(3, reading.stretch.length);
    this.geometry = plateDots(this.maxRing);
    const extent = this.maxRing + (DOT_FACTOR * PITCH) / 2 + 0.1;
    this.root = svg('svg', {
      class: 'plate',
      viewBox: `${-extent} ${-extent} ${extent * 2} ${extent * 2}`,
      role: 'img',
      'aria-label': label,
    });

    const proofLayer = svg('g', { class: 'plate-proofs' });
    const dotLayer = svg('g', { class: 'plate-dots' });
    for (const dot of this.geometry) {
      const coverage = coverageFor(reading, dot.ring);
      const circle = svg('circle', {
        class: 'plate-dot',
        'data-ring': dot.ring,
        'data-coverage': format(coverage),
        cx: dot.x,
        cy: dot.y,
        r: diameterFor(coverage) / 2,
      });
      const proof = svg('circle', {
        class: 'plate-proof',
        cx: dot.x,
        cy: dot.y,
        r: 0,
        'aria-hidden': 'true',
      });
      this.dots.push(circle);
      this.proofs.push(proof);
      dotLayer.appendChild(circle);
      proofLayer.appendChild(proof);
    }
    this.root.append(proofLayer, dotLayer);
  }

  setLabel(label: string): void {
    this.root.setAttribute('aria-label', label);
  }

  /** On first load, and on a plain refresh, the dots sit straight at their coverage. */
  setReading(reading: PlateReading): void {
    this.reading = reading;
    this.geometry.forEach((dot, index) => {
      const coverage = coverageFor(reading, dot.ring);
      const circle = this.dots[index] as SVGCircleElement;
      circle.setAttribute('data-coverage', format(coverage));
      circle.setAttribute('r', String(diameterFor(coverage) / 2));
    });
  }

  /** Shows the quote's projection as outline circles, never filled. */
  showProof(projectedTotal: number): void {
    const projected: PlateReading = { ...this.reading, total: projectedTotal };
    this.geometry.forEach((dot, index) => {
      const circle = this.dots[index] as SVGCircleElement;
      const proof = this.proofs[index] as SVGCircleElement;
      const current = coverageFor(this.reading, dot.ring);
      const next = coverageFor(projected, dot.ring);
      if (next > current) {
        circle.setAttribute('data-proof-coverage', format(next));
        proof.setAttribute('r', String(diameterFor(next) / 2));
        proof.classList.add('is-shown');
      } else {
        circle.removeAttribute('data-proof-coverage');
        proof.classList.remove('is-shown');
        proof.setAttribute('r', '0');
      }
    });
  }

  clearProof(): void {
    for (const circle of this.dots) circle.removeAttribute('data-proof-coverage');
    for (const proof of this.proofs) {
      proof.classList.remove('is-shown');
      proof.setAttribute('r', '0');
    }
  }

  /**
   * Inks the proof outlines solid, ring by ring from the centre out, and resolves
   * once the fill is done.
   */
  ink(total: number): Promise<void> {
    for (const timer of this.inkTimers) window.clearTimeout(timer);
    this.inkTimers = [];
    const next: PlateReading = { ...this.reading, total };
    this.reading = next;

    if (prefersReducedMotion()) {
      this.setReading(next);
      this.clearProof();
      return Promise.resolve();
    }

    this.root.classList.add('is-inking');
    return new Promise((resolve) => {
      for (let ring = 0; ring <= this.maxRing; ring += 1) {
        const coverage = coverageFor(next, ring);
        const timer = window.setTimeout(() => {
          this.geometry.forEach((dot, index) => {
            if (dot.ring !== ring) return;
            const circle = this.dots[index] as SVGCircleElement;
            const proof = this.proofs[index] as SVGCircleElement;
            circle.setAttribute('data-coverage', format(coverage));
            circle.setAttribute('r', String(diameterFor(coverage) / 2));
            circle.removeAttribute('data-proof-coverage');
            proof.classList.remove('is-shown');
            proof.setAttribute('r', '0');
          });
        }, ring * RING_STAGGER_MS);
        this.inkTimers.push(timer);
      }
      const done = window.setTimeout(() => {
        this.root.classList.remove('is-inking');
        resolve();
      }, this.maxRing * RING_STAGGER_MS + RING_INK_MS);
      this.inkTimers.push(done);
    });
  }
}

/** Counts the pledged figure from its old total to its new one over the ink's half second. */
export function countUp(
  node: HTMLElement,
  from: number,
  to: number,
  render: (pence: number) => string,
): Promise<void> {
  if (prefersReducedMotion() || from === to) {
    node.textContent = render(to);
    return Promise.resolve();
  }
  const start = performance.now();
  return new Promise((resolve) => {
    const step = (now: number): void => {
      const progress = Math.min(1, (now - start) / RING_INK_MS);
      const eased = 1 - (1 - progress) * (1 - progress);
      node.textContent = render(Math.round(from + (to - from) * eased));
      if (progress < 1) {
        window.requestAnimationFrame(step);
        return;
      }
      node.textContent = render(to);
      resolve();
    };
    window.requestAnimationFrame(step);
  });
}
