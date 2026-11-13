export type Curve = "linear" | "eased";
export const CURVES: readonly Curve[] = ["linear", "eased"];

export type Property = "x" | "y" | "scale" | "rotation" | "opacity";
export const PROPERTIES: readonly Property[] = ["x", "y", "scale", "rotation", "opacity"];

export interface Diamond {
  frame: number;
  value: number;
  curve: Curve;
}

export type Keyframes = Partial<Record<Property, Diamond[]>>;

export const PROPERTY_RANGE: Record<Property, readonly [number, number]> = {
  x: [-10000, 10000],
  y: [-10000, 10000],
  scale: [1, 1000],
  rotation: [-3600, 3600],
  opacity: [0, 100],
};

/** Two decimals, halves away from zero; a value within one millionth of a half counts as a half. */
export function round2(value: number): number {
  const scaled = Math.abs(value) * 100;
  const base = Math.floor(scaled);
  const up = scaled - base >= 0.5 - 1e-4;
  return Math.sign(value) * ((base + (up ? 1 : 0)) / 100) || 0;
}

/** Value of a property between diamonds at a clip-relative frame, or null with no diamonds. */
export function interpolate(diamonds: readonly Diamond[] | undefined, frame: number): number | null {
  if (!diamonds || diamonds.length === 0) return null;
  const sorted = [...diamonds].sort((a, b) => a.frame - b.frame);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  if (frame <= first.frame) return first.value;
  if (frame >= last.frame) return last.value;
  for (let i = 0; i + 1 < sorted.length; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a && b && frame >= a.frame && frame <= b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      const eased = a.curve === "eased" ? t * t * (3 - 2 * t) : t;
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}
