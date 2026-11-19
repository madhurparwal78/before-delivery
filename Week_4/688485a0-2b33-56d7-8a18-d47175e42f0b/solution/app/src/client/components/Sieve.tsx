import { type ReactNode, useEffect, useRef } from "react";

/**
 * The Stage Sieve bars: width follows ln(1 + out) / ln(1 + input). When stage k changes, bands k..n move from their old
 * to their new width over 320 ms, band j starting 40 ms x (j - k) later, while their numerals count in whole numbers.
 * The motion is a requestAnimationFrame loop on the page clock, so reduced motion and a stepped clock both see exact states.
 */

const BAR_MS = 320;
const STAGGER_MS = 40;

export function barFraction(count: number, input: number): number {
  return input <= 0 ? 0 : Math.min(1, Math.log(1 + count) / Math.log(1 + input));
}

const settleOut = (progress: number): number => 1 - (1 - progress) ** 4;

interface Motion {
  from: number;
  to: number;
  startsAt: number;
}

interface BandState {
  fraction: number;
  count: number;
  bar: HTMLElement | null;
  numeral: HTMLElement | null;
  motion: { fraction: Motion; count: Motion } | null;
}

export interface BandTarget {
  key: string;
  /** Null for a disabled band, which draws no bar. */
  fraction: number | null;
  count: number;
}

export class SieveMotion {
  private bands = new Map<string, BandState>();
  private marker: { el: HTMLElement | null; y: number; motion: Motion | null } = { el: null, y: 0, motion: null };
  private frame = 0;

  private state(key: string): BandState {
    let band = this.bands.get(key);
    if (!band) this.bands.set(key, (band = { fraction: 0, count: 0, bar: null, numeral: null, motion: null }));
    return band;
  }

  private paint(band: BandState): void {
    if (band.bar) band.bar.style.width = `${band.fraction * 100}%`;
    if (band.numeral) band.numeral.textContent = String(band.count);
  }

  attachBar(key: string, bar: HTMLElement | null): void {
    const band = this.state(key);
    band.bar = bar;
    this.paint(band);
  }

  attachNumeral(key: string, numeral: HTMLElement | null): void {
    const band = this.state(key);
    band.numeral = numeral;
    this.paint(band);
  }

  attachMarker(el: HTMLElement | null): void {
    this.marker.el = el;
    if (el) el.style.transform = `translateY(${this.marker.y}px)`;
  }

  /** Move to new targets; bands before `changedFrom` take them at once, the rest animate (all at once when `instant`). */
  update(targets: BandTarget[], changedFrom: number, instant: boolean): void {
    const now = performance.now();
    const keep = new Set(targets.map((target) => target.key));
    for (const key of this.bands.keys()) if (!keep.has(key)) this.bands.delete(key);
    targets.forEach((target, index) => {
      const band = this.state(target.key);
      if (target.fraction === null) {
        band.motion = null;
        return;
      }
      if (instant || index < changedFrom) {
        band.fraction = target.fraction;
        band.count = target.count;
        band.motion = null;
        this.paint(band);
      } else {
        const startsAt = now + STAGGER_MS * (index - changedFrom);
        band.motion = {
          fraction: { from: band.fraction, to: target.fraction, startsAt },
          count: { from: band.count, to: target.count, startsAt },
        };
      }
    });
    this.run();
  }

  /** Slide the pin marker to `y`, starting with the band at `delayBands` steps after the changed one. */
  moveMarker(y: number, delayBands: number, instant: boolean): void {
    if (instant) {
      this.marker.y = y;
      this.marker.motion = null;
      if (this.marker.el) this.marker.el.style.transform = `translateY(${y}px)`;
    } else {
      this.marker.motion = { from: this.marker.y, to: y, startsAt: performance.now() + STAGGER_MS * delayBands };
    }
    this.run();
  }

  private run(): void {
    if (this.frame === 0 && this.pending()) this.frame = requestAnimationFrame(() => this.tick());
  }

  private pending(): boolean {
    return this.marker.motion !== null || [...this.bands.values()].some((band) => band.motion !== null);
  }

  private tick(): void {
    this.frame = 0;
    const now = performance.now();
    const progress = (motion: Motion): number => Math.min(1, Math.max(0, (now - motion.startsAt) / BAR_MS));
    for (const band of this.bands.values()) {
      if (!band.motion) continue;
      const done = progress(band.motion.fraction);
      const eased = settleOut(done);
      band.fraction = band.motion.fraction.from + (band.motion.fraction.to - band.motion.fraction.from) * eased;
      band.count = Math.round(band.motion.count.from + (band.motion.count.to - band.motion.count.from) * eased);
      if (done >= 1) {
        band.fraction = band.motion.fraction.to;
        band.count = band.motion.count.to;
        band.motion = null;
      }
      this.paint(band);
    }
    if (this.marker.motion) {
      const done = progress(this.marker.motion);
      this.marker.y = this.marker.motion.from + (this.marker.motion.to - this.marker.motion.from) * settleOut(done);
      if (done >= 1) {
        this.marker.y = this.marker.motion.to;
        this.marker.motion = null;
      }
      if (this.marker.el) this.marker.el.style.transform = `translateY(${this.marker.y}px)`;
    }
    this.run();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}

export function useSieveMotion(): SieveMotion {
  const motion = useRef<SieveMotion | null>(null);
  if (motion.current === null) motion.current = new SieveMotion();
  const current = motion.current;
  useEffect(() => () => current.dispose(), [current]);
  return current;
}

interface MeterProps {
  motion: SieveMotion;
  id: string;
  disabled: boolean;
  overflow: boolean;
}

/** The track, bar, overflow notch and numeral of one band. */
export function SieveMeter({ motion, id, disabled, overflow }: MeterProps): ReactNode {
  return (
    <>
      <div className="sieve-track" data-sieve-track>
        {disabled ? null : (
          <div className="sieve-bar" data-sieve-bar data-overflow={String(overflow)} ref={(node) => motion.attachBar(id, node)} />
        )}
        {overflow && !disabled ? <span className="sieve-notch" aria-hidden="true" /> : null}
      </div>
      {disabled ? null : <span className="sieve-count" aria-hidden="true" ref={(node) => motion.attachNumeral(id, node)} />}
    </>
  );
}
