import { parseHex } from '../format';
import { isObject } from '../paths';
import type { BlendMode, Json, Layer } from '../types';
import { bool, num, str, type ResolvedLayer } from './resolve';

export type Rgb = [number, number, number];

interface Stop {
  color: string;
  position: number;
}

/** The hash behind grain and displacement. */
export function grainHash(x: number, y: number, seed: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const to8 = (v: number): number => Math.floor(v * 255 + 0.5);

/** The blend function B(Cb, Cs) of one channel, both in 0..1. */
function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case 'Normal':
      return source;
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
  }
}

/** Composites one source colour over a backdrop at opacity `alpha`, in 8-bit sRGB. */
function composite(backdrop: Rgb, source: Rgb, mode: BlendMode, alpha: number): Rgb {
  return backdrop.map((b, i) => {
    const cb = b / 255;
    const cs = (source[i] as number) / 255;
    return to8(cb * (1 - alpha) + blendChannel(mode, cb, cs) * alpha);
  }) as Rgb;
}

export function stopsOf(value: Json | undefined): Stop[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .map((s) => ({ color: typeof s['color'] === 'string' ? s['color'] : '#000000', position: typeof s['position'] === 'number' ? s['position'] : 0 }));
}

/** Interpolates the stops at t in 0..1, each 8-bit channel linearly and then rounded. */
function gradientColour(stops: readonly Stop[], t: number): Rgb {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return [0, 0, 0];
  const at = Math.min(Math.max(t, 0), 1) * 100;
  if (at <= first.position) return parseHex(first.color);
  if (at >= last.position) return parseHex(last.color);
  const index = sorted.findIndex((s) => s.position >= at);
  const upper = sorted[index] as Stop;
  const lower = sorted[index - 1] as Stop;
  const f = (at - lower.position) / (upper.position - lower.position);
  const a = parseHex(lower.color);
  const b = parseHex(upper.color);
  return a.map((v, i) => Math.floor(v + ((b[i] as number) - v) * f + 0.5)) as Rgb;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (values: ResolvedLayer['values']): Box => ({
  x: num(values, 'x'),
  y: num(values, 'y'),
  width: num(values, 'width', 200),
  height: num(values, 'height', 200),
});

function insidePolygon(px: number, py: number, box: Box, sides: number): boolean {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return [cx + (box.width / 2) * Math.cos(angle), cy + (box.height / 2) * Math.sin(angle)] as const;
  });
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as readonly [number, number];
    const [xj, yj] = points[j] as readonly [number, number];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether the layer's hard-edged shape covers the point (artboard coordinates). */
export function covers(layer: ResolvedLayer, px: number, py: number): boolean {
  const { values } = layer;
  const box = boxOf(values);
  const withinBox = px >= box.x && px < box.x + box.width && py >= box.y && py < box.y + box.height;
  if (layer.layer.kind === 'Ellipse') {
    const dx = (px - (box.x + box.width / 2)) / (box.width / 2);
    const dy = (py - (box.y + box.height / 2)) / (box.height / 2);
    return dx * dx + dy * dy <= 1;
  }
  if (layer.layer.kind === 'Polygon') return insidePolygon(px, py, box, Math.round(num(values, 'sides', 6)));
  return withinBox;
}

/** The solid colour a sampled layer paints at the point, or null when it is not sampled there. */
function paint(layer: ResolvedLayer, px: number, py: number): Rgb | null {
  const { values } = layer;
  switch (layer.layer.kind) {
    case 'Rectangle':
    case 'Ellipse':
    case 'Polygon':
      return covers(layer, px, py) ? parseHex(str(values, 'fill', '#FFFFFF')) : null;
    case 'Gradient': {
      const box = boxOf(values);
      if (!covers(layer, px, py)) return null;
      const stops = stopsOf(values['gradient.stops']);
      if (str(values, 'gradient.type', 'Linear') === 'Radial') {
        const cx = box.x + (box.width * num(values, 'gradient.centerX', 50)) / 100;
        const cy = box.y + (box.height * num(values, 'gradient.centerY', 50)) / 100;
        return gradientColour(stops, Math.hypot(px - cx, py - cy) / num(values, 'gradient.radius', 100));
      }
      const angle = (num(values, 'gradient.angle') * Math.PI) / 180;
      const length = Math.abs(box.width * Math.cos(angle)) + Math.abs(box.height * Math.sin(angle));
      const along = (px - (box.x + box.width / 2)) * Math.cos(angle) + (py - (box.y + box.height / 2)) * Math.sin(angle);
      return gradientColour(stops, along / length + 0.5);
    }
    default:
      return null;
  }
}

export interface Surface {
  layers: ResolvedLayer[];
  background: Rgb;
}

/** Layers in stack order, bottom first, for one parent. */
export function stackOf(layers: readonly ResolvedLayer[], parentId: string | null): ResolvedLayer[] {
  return layers.filter((l) => l.layer.parentId === parentId).sort((a, b) => a.layer.order - b.layer.order);
}

function coverage(mask: ResolvedLayer, px: number, py: number): number {
  return covers(mask, px, py) ? num(mask.values, 'opacity', 100) / 100 : 0;
}

/** The effect of a per-pixel effect layer on one colour, or the colour read at the pixelate cell centre. */
function applyEffect(layer: ResolvedLayer, colour: Rgb, px: number, py: number, below: (x: number, y: number) => Rgb): Rgb {
  const { values } = layer;
  if (!bool(values, 'effect.enabled', true)) return colour;
  switch (str(values, 'effect.kind')) {
    case 'Grain': {
      const h = grainHash(Math.floor(px), Math.floor(py), num(values, 'effect.grainSeed'));
      const amount = num(values, 'effect.grainAmount', 0.15);
      return colour.map((c) => Math.min(Math.max(Math.floor(c + amount * (h - 0.5) * 255 + 0.5), 0), 255)) as Rgb;
    }
    case 'Glow': {
      const [r, g, b] = colour.map((c) => c / 255) as Rgb;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const factor = 1 + num(values, 'effect.glowStrength', 1) * Math.max(0, luminance - num(values, 'effect.glowThreshold', 0.7));
      return [r, g, b].map((c) => to8(Math.min(Math.max(c * factor, 0), 1))) as Rgb;
    }
    case 'Pixelate': {
      const cell = Math.max(1, Math.round(num(values, 'effect.pixelCell', 8)));
      const x = Math.floor(Math.floor(px) / cell) * cell + Math.floor(cell / 2);
      const y = Math.floor(Math.floor(py) / cell) * cell + Math.floor(cell / 2);
      return below(x + 0.5, y + 0.5);
    }
    default:
      return colour;
  }
}

/**
 * The composited colour at an artboard point (pixel centre), taking the first `count` layers of the stack over the
 * backdrop. Effects see everything below them in the same stack; a group's children composite over the colour
 * the stack had where the group begins.
 */
function colourAt(surface: Surface, stack: ResolvedLayer[], count: number, backdrop: (x: number, y: number) => Rgb, px: number, py: number): Rgb {
  let colour = backdrop(px, py);
  for (let i = 0; i < count; i++) {
    const layer = stack[i] as ResolvedLayer;
    if (!bool(layer.values, 'visible', true)) continue;
    const kind: Layer['kind'] = layer.layer.kind;
    if (kind === 'Group') {
      const children = stackOf(surface.layers, layer.layer.id);
      const base = colour;
      colour = colourAt(surface, children, children.length, () => base, px, py);
      continue;
    }
    if (layer.layer.maskAbove) continue;
    if (kind === 'Effect') {
      const index = i;
      colour = applyEffect(layer, colour, px, py, (x, y) => colourAt(surface, stack, index, backdrop, x, y));
      continue;
    }
    const source = paint(layer, px, py);
    if (!source) continue;
    let alpha = num(layer.values, 'opacity', 100) / 100;
    const mask = stack[i - 1];
    if (mask && mask.layer.maskAbove && bool(mask.values, 'visible', true)) alpha *= coverage(mask, px, py);
    colour = composite(colour, source, layer.layer.blendMode, alpha);
  }
  return colour;
}

/** The Sample readout colour at an artboard pixel. */
export function sampleAt(surface: Surface, x: number, y: number): Rgb {
  const roots = stackOf(surface.layers, null);
  return colourAt(surface, roots, roots.length, () => surface.background, x + 0.5, y + 0.5);
}
