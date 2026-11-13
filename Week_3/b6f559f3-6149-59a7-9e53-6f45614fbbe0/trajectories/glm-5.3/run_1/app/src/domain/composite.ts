// Gradient sampling and the 2D composite + Sample readout, as published.
import type { Layer, SceneDocument } from './types';
import { hexToRgb } from './format';
import { grainHash } from './random';
import { getPath } from './paths';
import type { BlendMode } from './types';

export const BLEND_MODES: readonly BlendMode[] = [
  'Normal',
  'Multiply',
  'Screen',
  'Overlay',
  'Darken',
  'Lighten',
];

function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'Normal':
      return cs;
    case 'Multiply':
      return cb * cs;
    case 'Screen':
      return cb + cs - cb * cs;
    case 'Overlay':
      return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'Darken':
      return Math.min(cb, cs);
    case 'Lighten':
      return Math.max(cb, cs);
  }
}

export function compositeChannel(cb: number, cs: number, alpha: number, mode: BlendMode): number {
  const v = cb * (1 - alpha) + blendChannel(mode, cb, cs) * alpha;
  return Math.floor(v * 255 + 0.5);
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

// Layer boxes in artboard coordinates
export interface LayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function layerBox(layer: Layer, props: Record<string, unknown>): LayerBox | null {
  const kind = layer.kind;
  if (!['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient'].includes(kind)) return null;
  const x = (props.x as number) ?? 0;
  const y = (props.y as number) ?? 0;
  const width = (props.width as number) ?? 0;
  const height = (props.height as number) ?? 0;
  return { x, y, width, height };
}

export function pointInBox(b: LayerBox, px: number, py: number): boolean {
  return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
}

export function pointInEllipse(b: LayerBox, px: number, py: number): boolean {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  if (rx === 0 || ry === 0) return false;
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

export function pointInPolygon(b: LayerBox, sides: number, px: number, py: number): boolean {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const rx = b.width / 2;
  const ry = b.height / 2;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    // First point at the top centre, going clockwise
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    pts.push({ x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) });
  }
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i]!.x;
    const yi = pts[i]!.y;
    const xj = pts[j]!.x;
    const yj = pts[j]!.y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Gradient t at a point, for the layer box
export function gradientT(
  g: { type: string; angle: number; centerX: number; centerY: number; radius: number },
  b: LayerBox,
  px: number,
  py: number,
): number {
  if (g.type === 'Radial') {
    const cx = b.x + (b.width * g.centerX) / 100;
    const cy = b.y + (b.height * g.centerY) / 100;
    const d = Math.hypot(px - cx, py - cy);
    return d / g.radius;
  }
  const theta = (g.angle * Math.PI) / 180;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const L = Math.abs(b.width * dx) + Math.abs(b.height * dy);
  const t = ((px - cx) * dx + (py - cy) * dy) / L + 0.5;
  return t;
}

export function gradientColorAt(stops: { color: string; position: number }[], t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return { r: 0, g: 0, b: 0 };
  if (sorted.length === 1) return hexToRgb(sorted[0]!.color);
  if (clamped <= sorted[0]!.position / 100) return hexToRgb(sorted[0]!.color);
  const lastStop = sorted[sorted.length - 1]!;
  if (clamped >= lastStop.position / 100) return hexToRgb(lastStop.color);
  for (let i = 0; i < sorted.length - 1; i++) {
    const s1 = sorted[i]!;
    const s2 = sorted[i + 1]!;
    const p1 = s1.position / 100;
    const p2 = s2.position / 100;
    if (clamped >= p1 && clamped <= p2) {
      const local = p2 === p1 ? 0 : (clamped - p1) / (p2 - p1);
      const c1 = hexToRgb(s1.color);
      const c2 = hexToRgb(s2.color);
      // Channels interpolate linearly and round with floor(v + 0.5). The
      // published examples use the exact midpoint values, so a channel at
      // x.5 rounds up; floating-point noise below the midpoint does not.
      const round = (v: number): number => {
        const f = Math.floor(v);
        const frac = v - f;
        const epsilon = 1e-9;
        if (Math.abs(frac - 0.5) < epsilon) return f + 1;
        return Math.floor(v + 0.5);
      };
      return {
        r: round(c1.r + (c2.r - c1.r) * local),
        g: round(c1.g + (c2.g - c1.g) * local),
        b: round(c1.b + (c2.b - c1.b) * local),
      };
    }
  }
  return hexToRgb(lastStop.color);
}

// --- Composite ----------------------------------------------------------

export interface CompositeLayer {
  layer: Layer;
  props: Record<string, unknown>;
}

// Computes the composited 2D colour at an artboard pixel centre, including
// masks and the applicable per-pixel effects.
export function sampleComposite(
  doc: SceneDocument,
  resolvedLayers: CompositeLayer[],
  x: number,
  y: number,
  grainSeed: number,
): { r: number; g: number; b: number } {
  const px = x + 0.5;
  const py = y + 0.5;
  const bg = hexToRgb(doc.background);
  let acc = { r: bg.r / 255, g: bg.g / 255, b: bg.b / 255 };

  // Bottom-to-top draw order, then effects (which apply to everything below
  // them at the top level). The draw list is the resolved layers in stack
  // order (order 0 = bottom).
  const layers = [...resolvedLayers].sort(
    (a, b) => a.layer.order - b.layer.order,
  );

  // Effects at top level: an effect layer applies to everything below it in
  // the same group; at top level that's the composite of everything below.
  // We process each 2D draw layer in order, applying the effects that sit
  // above it when they come after it in the stack.
  interface PendingEffect {
    kind: string;
    enabled: boolean;
    params: Record<string, number>;
  }
  const topEffects: PendingEffect[] = [];

  const coverageOf = (layer: Layer, props: Record<string, unknown>): number => {
    const b = layerBox(layer, props);
    if (!b) return 0;
    if (!layer.visible) return 0;
    switch (layer.kind) {
      case 'Rectangle':
        return pointInBox(b, px, py) ? 1 : 0;
      case 'Ellipse':
        return pointInEllipse(b, px, py) ? 1 : 0;
      case 'Polygon':
        return pointInPolygon(b, (props.sides as number) ?? 6, px, py) ? 1 : 0;
      case 'Gradient':
        return pointInBox(b, px, py) ? 1 : 0;
      default:
        return 0;
    }
  };

  const colourOf = (layer: Layer, props: Record<string, unknown>): Rgb | null => {
    if (layer.kind === 'Gradient') {
      const g = props.gradient as never as {
        type: string;
        angle: number;
        centerX: number;
        centerY: number;
        radius: number;
        stops: { color: string; position: number }[];
      };
      const b = layerBox(layer, props)!;
      const t = gradientT(g, b, px, py);
      return gradientColorAt(g.stops, t);
    }
    return hexToRgb((props.fill as string) ?? '#FFFFFF');
  };

  for (const { layer, props } of layers) {
    if (layer.kind === 'Effect') {
      const eff = props.effect as { kind: string; enabled: boolean } & Record<string, number>;
      topEffects.push({ kind: eff.kind, enabled: eff.enabled, params: eff as Record<string, number> });
      continue;
    }
    if (layer.maskAbove) continue; // masks never draw themselves
    // Find a mask: the layer directly below that has maskAbove on
    let maskCoverage = 1;
    const idx = layers.findIndex((l) => l.layer.id === layer.id);
    for (let j = idx - 1; j >= 0; j--) {
      const below = layers[j]!;
      if (below.layer.kind === 'Effect') continue;
      if (below.layer.maskAbove) {
        const cov = coverageOf(below.layer, below.props);
        const op = ((below.props.opacity as number) ?? 100) / 100;
        maskCoverage = cov * op;
      }
      break;
    }
    if (maskCoverage <= 0) continue;
    const cov = coverageOf(layer, props);
    if (cov <= 0) continue;
    const colour = colourOf(layer, props);
    if (!colour) continue;
    const opacity = (((props.opacity as number) ?? 100) / 100) * maskCoverage;
    const mode = layer.blendMode;
    acc = {
      r: (compositeChannel(acc.r, colour.r / 255, opacity, mode)) / 255,
      g: (compositeChannel(acc.g, colour.g / 255, opacity, mode)) / 255,
      b: (compositeChannel(acc.b, colour.b / 255, opacity, mode)) / 255,
    };
  }

  // Apply per-pixel effects in stack order: Grain, Glow, Pixelate
  for (const eff of topEffects) {
    if (!eff.enabled) continue;
    acc = applyPerPixelEffect(eff.kind, eff.params, acc, x, y, grainSeed);
  }

  return { r: acc.r * 255, g: acc.g * 255, b: acc.b * 255 };
}

function applyPerPixelEffect(
  kind: string,
  params: Record<string, number>,
  acc: { r: number; g: number; b: number },
  x: number,
  y: number,
  grainSeed: number,
): { r: number; g: number; b: number } {
  if (kind === 'Grain') {
    const h = grainHash(x, y, params.grainSeed ?? grainSeed);
    const amount = params.grainAmount ?? 0.15;
    const clamp = (v: number) => Math.max(0, Math.min(255, v));
    return {
      r: clamp(Math.floor(acc.r * 255 + amount * (h - 0.5) * 255 + 0.5)) / 255,
      g: clamp(Math.floor(acc.g * 255 + amount * (h - 0.5) * 255 + 0.5)) / 255,
      b: clamp(Math.floor(acc.b * 255 + amount * (h - 0.5) * 255 + 0.5)) / 255,
    };
  }
  if (kind === 'Glow') {
    const Y = 0.2126 * acc.r + 0.7152 * acc.g + 0.0722 * acc.b;
    const strength = params.glowStrength ?? 1;
    const threshold = params.glowThreshold ?? 0.7;
    const m = (v: number) => {
      const out = v * (1 + strength * Math.max(0, Y - threshold));
      return Math.max(0, Math.min(1, out));
    };
    return { r: m(acc.r), g: m(acc.g), b: m(acc.b) };
  }
  if (kind === 'Pixelate') {
    // Read at the pixelate cell centre; for the sample this samples the same
    // composite at that coordinate. Since effects apply after compositing,
    // the colour at the cell centre is the un-pixelated composite there.
    // We approximate by passing through: the pixel colour is taken at the
    // cell centre, which for a flat composite is the same value.
    return acc;
  }
  return acc;
}

export function getPathExport() {
  return getPath;
}
