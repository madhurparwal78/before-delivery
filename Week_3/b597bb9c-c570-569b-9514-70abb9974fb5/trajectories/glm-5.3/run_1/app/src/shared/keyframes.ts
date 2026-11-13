/**
 * Keyframe interpolation. One rule for the frame endpoint, the stage, the
 * Inspector and the Frame Loupe.
 */
export type Curve = 'linear' | 'eased';
export type LayerProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity';

export interface Keyframe {
  readonly frame: number;
  readonly value: number;
  readonly curve: Curve;
}

export interface PropertyRange {
  readonly min: number;
  readonly max: number;
}

export const PROPERTY_RANGES: Record<LayerProperty, PropertyRange> = {
  x: { min: -10000, max: 10000 },
  y: { min: -10000, max: 10000 },
  scale: { min: 1, max: 1000 },
  rotation: { min: -3600, max: 3600 },
  opacity: { min: 0, max: 100 },
};

export const DEFAULT_BASE: Record<LayerProperty, (width: number, height: number) => number> = {
  x: (w) => Math.round(w / 2),
  y: (_w, h) => Math.round(h / 2),
  scale: () => 100,
  rotation: () => 0,
  opacity: () => 100,
};

export interface LayerDefaults {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export function baseDefaults(frameWidth: number, frameHeight: number): LayerDefaults {
  return {
    x: Math.round(frameWidth / 2),
    y: Math.round(frameHeight / 2),
    scale: 100,
    rotation: 0,
    opacity: 100,
  };
}

function ease(t: number, curve: Curve): number {
  return curve === 'linear' ? t : t * t * (3 - 2 * t);
}

/** Round to two decimals, halves away from zero, one-millionth tolerance. */
export function round2(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  if (Math.abs(frac - 0.5) < 1e-6) {
    return (value >= 0 ? floor + 0.5 : floor - 0.5) / 1;
  }
  // Ordinary nearest, halves away from zero.
  const away = scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
  return away / 100;
}

/** The value of a property at a clip-relative frame f, given its diamonds. */
export function propertyValue(
  diamonds: readonly Keyframe[],
  f: number,
  fallback: number,
): number {
  if (diamonds.length === 0) return round2(fallback);
  const sorted = [...diamonds].sort((a, b) => a.frame - b.frame);
  const first = sorted[0]!;
  if (f <= first.frame) return round2(first.value);
  const last = sorted[sorted.length - 1]!;
  if (f >= last.frame) return round2(last.value);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (f >= a.frame && f <= b.frame) {
      if (b.frame === a.frame) return round2(b.value);
      const t = (f - a.frame) / (b.frame - a.frame);
      const e = ease(t, a.curve);
      return round2(a.value + (b.value - a.value) * e);
    }
  }
  return round2(last.value);
}

/** Values of every property at a frame, keyed for the stage and inspector. */
export function layerValuesAt(
  keyframes: Readonly<Record<string, readonly Keyframe[]>>,
  f: number,
  defaults: LayerDefaults,
): Record<LayerProperty, number> {
  const get = (p: LayerProperty): number =>
    propertyValue(keyframes[p] ?? [], f, defaults[p]);
  return { x: get('x'), y: get('y'), scale: get('scale'), rotation: get('rotation'), opacity: get('opacity') };
}

/** The media box fitted inside the frame without cropping, then scaled. */
export function fittedBox(
  mediaWidth: number,
  mediaHeight: number,
  frameWidth: number,
  frameHeight: number,
  scalePercent: number,
  x: number,
  y: number,
): { x: number; y: number; width: number; height: number } {
  const ratio = Math.min(frameWidth / mediaWidth, frameHeight / mediaHeight);
  const w = ratio * mediaWidth * (scalePercent / 100);
  const h = ratio * mediaHeight * (scalePercent / 100);
  return { x: x - w / 2, y: y - h / 2, width: w, height: h };
}

/** A text clip's base box: 60% of the frame width by 12% of its height. */
export function textBox(frameWidth: number, frameHeight: number): { width: number; height: number } {
  return { width: frameWidth * 0.6, height: frameHeight * 0.12 };
}

/** Export long side: short side × the aspect ratio, by the rounding rule. */
export function exportLongSide(shortSide: number, width: number, height: number): number {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return Math.round((shortSide * long) / short);
}
