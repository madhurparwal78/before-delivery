import type { Dimensions, Fit } from "../shared/api";

// The one cabin-fit computation: product page, comparison table, /api/fit and the fit facet all use it.

export interface Frame {
  code: string;
  name: string;
  height_cm: number;
  width_cm: number;
  depth_cm: number;
}

/** Whole tenths, so decimals never drift. */
const tenths = (cm: number): number => Math.round(cm * 10);

function text(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** A bag fits when each dimension is at or below the frame's, with no rotation. */
export function cabinFit(sku: string, bag: Dimensions, frame: Frame): Fit {
  const over = (dimension: number, limit: number): number => Math.max(0, tenths(dimension) - tenths(limit)) / 10;
  const overhang = {
    height: over(bag.height, frame.height_cm),
    width: over(bag.width, frame.width_cm),
    depth: over(bag.depth, frame.depth_cm),
  };
  const max = Math.max(overhang.height, overhang.width, overhang.depth);
  const fits = max === 0;
  return {
    sku,
    airline: frame.code,
    fits,
    overhang_cm: overhang,
    max_overhang_cm: max,
    verdict: fits ? `Fits the ${frame.name} cabin frame.` : `Over by ${text(max)} cm for the ${frame.name} cabin frame.`,
  };
}
