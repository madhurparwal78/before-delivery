import { ReactNode, useEffect, useRef, useState } from "react";
import { displayNumber } from "shared/values";

/**
 * The Stage Sieve band (DP-29, DP-30, DP-31): a lime bar on a near-black track
 * whose width follows the published log ratio, animating with the published
 * stagger, instantly under reduced motion.
 */

export interface BandGeometry {
  input: number;
  out: number;
  disabled: boolean;
  capped: boolean;
}

/** The published bar width: track * min(1, ln(1+out)/ln(1+input)), zero when input is 0. */
export function bandWidthPercent(geo: BandGeometry): number {
  if (geo.input === 0 || geo.disabled) return 0;
  const ratio = Math.log(1 + geo.out) / Math.log(1 + geo.input);
  return Math.min(1, ratio) * 100;
}

export function bandOverflow(geo: BandGeometry): boolean {
  return geo.out > geo.input;
}

interface BandState {
  width: number;
  numeral: number;
}

/** Animates width and numeral from old to new over 320ms with a start delay. */
function useBandAnimation(
  targetWidth: number,
  targetNumeral: number,
  delayMs: number,
  animate: boolean,
): BandState {
  const [state, setState] = useState<BandState>({ width: 0, numeral: 0 });
  const fromRef = useRef<BandState>({ width: 0, numeral: 0 });
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!animate || reduced) {
      fromRef.current = { width: targetWidth, numeral: targetNumeral };
      setState({ width: targetWidth, numeral: targetNumeral });
      return;
    }
    const from = fromRef.current;
    const start = performance.now() + delayMs;
    const duration = 320;
    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 3);
      const width = from.width + (targetWidth - from.width) * eased;
      const numeral = Math.round(from.numeral + (targetNumeral - from.numeral) * eased);
      setState({ width, numeral });
      if (t < 1) frameRef.current = requestAnimationFrame(step);
      else fromRef.current = { width: targetWidth, numeral: targetNumeral };
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [targetWidth, targetNumeral, delayMs, animate]);

  return state;
}

interface SieveBandProps {
  geo: BandGeometry;
  /** Delay before this band starts moving (the published 40ms stagger). */
  delayMs: number;
  animate: boolean;
  children?: ReactNode;
  barRef?: (el: HTMLElement | null) => void;
  ariaLabel?: string;
}

export function SieveBand(props: SieveBandProps): ReactNode {
  const { geo, delayMs, animate, children } = props;
  const targetWidth = bandWidthPercent(geo);
  const state = useBandAnimation(targetWidth, geo.out, delayMs, animate);
  if (geo.disabled) {
    return <div className="sieve-band sieve-band-disabled">{children}</div>;
  }
  return (
    <div className="sieve-band">
      {children}
      <div className="sieve-track" data-sieve-track="">
        <div
          className="sieve-bar"
          data-sieve-bar=""
          data-overflow={bandOverflow(geo) ? "true" : "false"}
          ref={el => props.barRef?.(el)}
          style={{ width: `${state.width}%` }}
        />
        {bandOverflow(geo) && <div className="sieve-notch" aria-hidden="true" />}
      </div>
    </div>
  );
}

export function bandNumeral(n: number): string {
  return displayNumber(n);
}
