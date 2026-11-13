// Keyboard and scrub stepping (DP-02, DP-22): steps snap to whole multiples of one tenth of the step, worked in decimal.
import type { ManifestEntry } from "../shared/api";

interface Modifiers {
  fine: boolean;
  coarse: boolean;
}

/** Decimals of a number as JavaScript prints it (steps are short decimals such as 0.01 or 0.025). */
function decimalsOf(n: number): number {
  const text = String(n);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

/** `units` is a whole count of tenth-steps; the result is worked in decimal so no binary remainder appears. */
function fromUnits(units: number, unit: number): number {
  const decimals = decimalsOf(unit);
  return Number(`${units}e-${decimals}`);
}

export function clampTo(entry: Pick<ManifestEntry, "min" | "max">, value: number): number {
  return Math.min(entry.max ?? Number.POSITIVE_INFINITY, Math.max(entry.min ?? Number.NEGATIVE_INFINITY, value));
}

/** The tenth-steps one press or one scrub step moves. A count always moves whole steps. */
export function unitsPerStep(entry: Pick<ManifestEntry, "kind">, modifiers: Modifiers): number {
  if (entry.kind === "count") return modifiers.coarse ? 10 : 1;
  return modifiers.fine ? 1 : modifiers.coarse ? 100 : 10;
}

/** `current` moved by `count` presses worth of tenth-steps, snapped and clamped. */
export function stepped(entry: Pick<ManifestEntry, "kind" | "step" | "min" | "max">, current: number, count: number): number {
  const step = entry.step ?? 1;
  const unit = entry.kind === "count" ? 1 : Number(`${step}e-1`);
  const base = Math.round(current / unit);
  return clampTo(entry, fromUnits(base + count, unit));
}
