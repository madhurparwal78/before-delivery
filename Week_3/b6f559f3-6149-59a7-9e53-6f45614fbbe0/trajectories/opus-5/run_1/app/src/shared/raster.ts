import { hexToRgb } from './format';
import type { EffectKind } from './properties';
import type { LayerKind } from './types';

export type Rgb = [number, number, number];

export function grainHash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const to8Bit = (value: number): number => Math.floor(value * 255 + 0.5);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function blendChannel(mode: string, backdrop: number, source: number): number {
  switch (mode) {
    case 'Multiply':
      return backdrop * source;
    case 'Screen':
      return backdrop + source - backdrop * source;
    case 'Overlay':
      return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case 'Darken':
      return Math.min(backdrop, source);
    case 'Lighten':
      return Math.max(backdrop, source);
    default:
      return source;
  }
}

export function compositeColour(backdrop: Rgb, source: Rgb, alpha: number, mode: string): Rgb {
  const result: Rgb = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const cb = backdrop[i] / 255;
    const cs = source[i] / 255;
    const blended = blendChannel(mode, cb, cs);
    result[i] = to8Bit(cb * (1 - alpha) + blended * alpha);
  }
  return result;
}

export interface GradientStop {
  color: string;
  position: number;
}

export interface SampleGradient {
  type: string;
  angle: number;
  centerX: number;
  centerY: number;
  radius: number;
  stops: GradientStop[];
}

export interface SampleEffect {
  kind: EffectKind;
  enabled: boolean;
  blurRadius: number;
  grainAmount: number;
  grainSeed: number;
  bloomThreshold: number;
  bloomIntensity: number;
  bloomRadius: number;
  glowStrength: number;
  glowThreshold: number;
  aberration: number;
  displacement: number;
  pixelCell: number;
}

export interface SampleLayer {
  id: string;
  parentId: string | null;
  order: number;
  kind: LayerKind;
  visible: boolean;
  maskAbove: boolean;
  blendMode: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  fill: string;
  sides: number;
  gradient: SampleGradient | null;
  effect: SampleEffect | null;
}

export interface Point {
  x: number;
  y: number;
}

export function gradientT(gradient: SampleGradient, layer: SampleLayer, point: Point): number {
  if (gradient.type === 'Radial') {
    const centre = {
      x: layer.x + (gradient.centerX / 100) * layer.width,
      y: layer.y + (gradient.centerY / 100) * layer.height,
    };
    const distance = Math.hypot(point.x - centre.x, point.y - centre.y);
    return clamp01(distance / gradient.radius);
  }
  const theta = (gradient.angle * Math.PI) / 180;
  const dx = Math.cos(theta);
  const dy = Math.sin(theta);
  const centre = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  const length = Math.abs(layer.width * dx) + Math.abs(layer.height * dy);
  const projected = (point.x - centre.x) * dx + (point.y - centre.y) * dy;
  return clamp01(projected / length + 0.5);
}

export function gradientColour(stops: GradientStop[], t: number): Rgb {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  if (sorted.length === 0) return [0, 0, 0];
  const position = clamp01(t) * 100;
  if (position <= sorted[0].position) return hexToRgb(sorted[0].color);
  const last = sorted[sorted.length - 1];
  if (position >= last.position) return hexToRgb(last.color);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (position >= a.position && position <= b.position) {
      const span = b.position - a.position;
      const local = span === 0 ? 0 : (position - a.position) / span;
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return [0, 1, 2].map((channel) =>
        Math.floor(ca[channel] + (cb[channel] - ca[channel]) * local + 0.5),
      ) as Rgb;
    }
  }
  return hexToRgb(last.color);
}

function insideShape(layer: SampleLayer, point: Point): boolean {
  const { x, y, width, height } = layer;
  if (point.x < x || point.x > x + width || point.y < y || point.y > y + height) return false;
  if (layer.kind === 'Ellipse') {
    const nx = (point.x - (x + width / 2)) / (width / 2);
    const ny = (point.y - (y + height / 2)) / (height / 2);
    return nx * nx + ny * ny <= 1;
  }
  if (layer.kind === 'Polygon') {
    const sides = Math.max(3, Math.round(layer.sides));
    const centre = { x: x + width / 2, y: y + height / 2 };
    const points: Point[] = [];
    for (let i = 0; i < sides; i += 1) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      points.push({
        x: centre.x + (width / 2) * Math.cos(angle),
        y: centre.y + (height / 2) * Math.sin(angle),
      });
    }
    return pointInPolygon(point, points);
  }
  return true;
}

export function polygonPoints(layer: {
  x: number;
  y: number;
  width: number;
  height: number;
  sides: number;
}): Point[] {
  const sides = Math.max(3, Math.round(layer.sides));
  const centre = { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
  const points: Point[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    points.push({
      x: centre.x + (layer.width / 2) * Math.cos(angle),
      y: centre.y + (layer.height / 2) * Math.sin(angle),
    });
  }
  return points;
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function applyGlow(colour: Rgb, strength: number, threshold: number): Rgb {
  const r = colour[0] / 255;
  const g = colour[1] / 255;
  const b = colour[2] / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const factor = 1 + strength * Math.max(0, luminance - threshold);
  return [r, g, b].map((channel) => to8Bit(clamp01(channel * factor))) as Rgb;
}

export function applyGrain(colour: Rgb, amount: number, seed: number, pixel: Point): Rgb {
  const h = grainHash(pixel.x, pixel.y, seed);
  return colour.map((channel) =>
    Math.max(0, Math.min(255, Math.floor(channel + amount * (h - 0.5) * 255 + 0.5))),
  ) as Rgb;
}

const SAMPLED_SHAPES: LayerKind[] = ['Rectangle', 'Ellipse', 'Polygon', 'Gradient'];
const PER_PIXEL_EFFECTS: EffectKind[] = ['Grain', 'Glow', 'Pixelate'];

export interface SampleScene {
  background: string;
  layers: SampleLayer[];
}

function childrenAscending(scene: SampleScene, parentId: string | null): SampleLayer[] {
  return scene.layers
    .filter((layer) => layer.parentId === parentId)
    .sort((a, b) => a.order - b.order);
}

function layerColour(layer: SampleLayer, point: Point): Rgb {
  if (layer.kind === 'Gradient' && layer.gradient) {
    return gradientColour(layer.gradient.stops, gradientT(layer.gradient, layer, point));
  }
  return hexToRgb(layer.fill);
}

/** The composited colour at an artboard point, optionally stopping before a layer. */
export function sampleScene(
  scene: SampleScene,
  pixel: Point,
  stopLayerId: string | null = null,
): Rgb {
  const point = { x: pixel.x + 0.5, y: pixel.y + 0.5 };
  let current = hexToRgb(scene.background);
  let stopped = false;

  const walk = (parentId: string | null): void => {
    const children = childrenAscending(scene, parentId);
    for (let index = 0; index < children.length; index += 1) {
      if (stopped) return;
      const layer = children[index];
      if (layer.id === stopLayerId) {
        stopped = true;
        return;
      }
      if (!layer.visible) continue;
      if (layer.kind === 'Group') {
        walk(layer.id);
        continue;
      }
      if (layer.kind === 'Effect' && layer.effect) {
        if (!layer.effect.enabled) continue;
        if (!PER_PIXEL_EFFECTS.includes(layer.effect.kind)) continue;
        if (layer.effect.kind === 'Grain') {
          current = applyGrain(current, layer.effect.grainAmount, layer.effect.grainSeed, pixel);
        } else if (layer.effect.kind === 'Glow') {
          current = applyGlow(current, layer.effect.glowStrength, layer.effect.glowThreshold);
        } else {
          const cell = Math.max(2, Math.round(layer.effect.pixelCell));
          const snapped = {
            x: Math.floor(pixel.x / cell) * cell + Math.floor(cell / 2),
            y: Math.floor(pixel.y / cell) * cell + Math.floor(cell / 2),
          };
          if (snapped.x !== pixel.x || snapped.y !== pixel.y) {
            current = sampleScene(scene, snapped, layer.id);
          }
        }
        continue;
      }
      if (layer.maskAbove) continue;
      if (!SAMPLED_SHAPES.includes(layer.kind)) continue;
      if (!insideShape(layer, point)) continue;
      let alpha = layer.opacity / 100;
      const below = children[index - 1];
      if (below && below.maskAbove && below.visible) {
        const coverage = insideShape(below, point) ? below.opacity / 100 : 0;
        alpha *= coverage;
      }
      current = compositeColour(current, layerColour(layer, point), alpha, layer.blendMode);
    }
  };

  walk(null);
  return current;
}
