/** The 2D layer stack, the light field and the environment tint, drawn on a 2D canvas under or beside the 3D. */
import { parseHex } from '../../shared/format';
import { grainHash, stackOf, stopsOf, type Rgb } from '../../shared/evaluator/compositing';
import { bool, num, str, type ResolvedLayer } from '../../shared/evaluator/resolve';
import type { ResolvedScenery } from '../../shared/evaluator';
import type { Assets } from '../../shared/evaluator/solids';
import type { BlendMode } from '../../shared/types';
import type { AssetLoader } from './assets';

type Context = CanvasRenderingContext2D;

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  Normal: 'source-over',
  Multiply: 'multiply',
  Screen: 'screen',
  Overlay: 'overlay',
  Darken: 'darken',
  Lighten: 'lighten',
};

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const boxOf = (rl: ResolvedLayer): Box => ({ x: num(rl.values, 'x'), y: num(rl.values, 'y'), width: num(rl.values, 'width', 200), height: num(rl.values, 'height', 200) });

function shapePath(ctx: Context, rl: ResolvedLayer, box: Box): void {
  ctx.beginPath();
  if (rl.layer.kind === 'Ellipse') {
    ctx.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
  } else if (rl.layer.kind === 'Polygon') {
    const sides = Math.round(num(rl.values, 'sides', 6));
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
      const px = box.x + box.width / 2 + (box.width / 2) * Math.cos(angle);
      const py = box.y + box.height / 2 + (box.height / 2) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else {
    ctx.rect(box.x, box.y, box.width, box.height);
  }
}

const css = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;

function gradientFill(ctx: Context, rl: ResolvedLayer, box: Box): CanvasGradient {
  const stops = stopsOf(rl.values['gradient.stops']);
  let gradient: CanvasGradient;
  if (str(rl.values, 'gradient.type', 'Linear') === 'Radial') {
    const cx = box.x + (box.width * num(rl.values, 'gradient.centerX', 50)) / 100;
    const cy = box.y + (box.height * num(rl.values, 'gradient.centerY', 50)) / 100;
    gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(num(rl.values, 'gradient.radius', 100), 1));
  } else {
    const angle = (num(rl.values, 'gradient.angle') * Math.PI) / 180;
    const length = Math.abs(box.width * Math.cos(angle)) + Math.abs(box.height * Math.sin(angle));
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const dx = (Math.cos(angle) * length) / 2;
    const dy = (Math.sin(angle) * length) / 2;
    gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  for (const stop of stops) gradient.addColorStop(Math.min(Math.max(stop.position / 100, 0), 1), css(parseHex(stop.color)));
  return gradient;
}

interface Drawing {
  ctx: Context;
  width: number;
  height: number;
  scale: number;
  loader: AssetLoader;
  assets: Assets;
}

function paintLayer(d: Drawing, rl: ResolvedLayer): void {
  const { ctx } = d;
  const box = boxOf(rl);
  const kind = rl.layer.kind;
  if (kind === 'Text') {
    const size = num(rl.values, 'textSize', 48);
    ctx.fillStyle = str(rl.values, 'fill', '#FFFFFF');
    ctx.font = `500 ${size}px system-ui, "Segoe UI", Roboto, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(str(rl.values, 'text', 'Text'), box.x, box.y, Math.max(box.width, 1));
  } else if (kind === 'Image') {
    const id = rl.values['assetId'];
    const image = typeof id === 'string' ? d.loader.image(id) : null;
    if (image) ctx.drawImage(image, box.x, box.y, box.width, box.height);
    else {
      ctx.fillStyle = 'rgba(139, 138, 152, 0.18)';
      ctx.fillRect(box.x, box.y, box.width, box.height);
    }
  } else if (kind === 'Gradient') {
    ctx.fillStyle = gradientFill(ctx, rl, box);
    ctx.fillRect(box.x, box.y, box.width, box.height);
  } else {
    ctx.fillStyle = str(rl.values, 'fill', '#FFFFFF');
    shapePath(ctx, rl, box);
    ctx.fill();
  }
}

function drawFlat(d: Drawing, rl: ResolvedLayer, mask: ResolvedLayer | null): void {
  const { ctx } = d;
  const alpha = num(rl.values, 'opacity', 100) / 100;
  ctx.save();
  ctx.setTransform(d.scale, 0, 0, d.scale, 0, 0);
  if (!mask) {
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = BLEND[rl.layer.blendMode];
    paintLayer(d, rl);
    ctx.restore();
    return;
  }
  const off = new OffscreenCanvas(d.width, d.height);
  const octx = off.getContext('2d') as OffscreenCanvasRenderingContext2D;
  octx.setTransform(d.scale, 0, 0, d.scale, 0, 0);
  paintLayer({ ...d, ctx: octx as unknown as Context }, rl);
  octx.globalCompositeOperation = 'destination-in';
  octx.globalAlpha = num(mask.values, 'opacity', 100) / 100;
  octx.fillStyle = '#000';
  shapePath(octx as unknown as Context, mask, boxOf(mask));
  octx.fill();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = BLEND[rl.layer.blendMode];
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function applyEffect(d: Drawing, rl: ResolvedLayer): void {
  const { ctx, width, height, scale } = d;
  if (!bool(rl.values, 'effect.enabled', true)) return;
  const kind = str(rl.values, 'effect.kind');
  if (kind === 'Blur' || kind === 'Bloom') {
    const snapshot = new OffscreenCanvas(width, height);
    (snapshot.getContext('2d') as OffscreenCanvasRenderingContext2D).drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (kind === 'Blur') {
      ctx.clearRect(0, 0, width, height);
      ctx.filter = `blur(${(num(rl.values, 'effect.blurRadius', 8) / 2) * scale}px)`;
      ctx.drawImage(snapshot, 0, 0);
    } else {
      const bright = snapshot.getContext('2d') as OffscreenCanvasRenderingContext2D;
      const data = bright.getImageData(0, 0, width, height);
      const threshold = num(rl.values, 'effect.bloomThreshold', 0.7);
      for (let i = 0; i < data.data.length; i += 4) {
        const y = luminance(data.data[i]! / 255, data.data[i + 1]! / 255, data.data[i + 2]! / 255);
        if (y < threshold) data.data[i + 3] = 0;
      }
      bright.putImageData(data, 0, 0);
      ctx.filter = `blur(${num(rl.values, 'effect.bloomRadius', 12) * scale}px)`;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(num(rl.values, 'effect.bloomIntensity', 1), 1);
      ctx.drawImage(snapshot, 0, 0);
    }
    ctx.restore();
    return;
  }
  const data = ctx.getImageData(0, 0, width, height);
  const px = data.data;
  const source = new Uint8ClampedArray(px);
  const at = (x: number, y: number): number => (Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)) * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ax = Math.floor(x / scale);
      const ay = Math.floor(y / scale);
      switch (kind) {
        case 'Grain': {
          const h = grainHash(ax, ay, num(rl.values, 'effect.grainSeed'));
          const delta = num(rl.values, 'effect.grainAmount', 0.15) * (h - 0.5) * 255;
          px[i] = source[i]! + delta;
          px[i + 1] = source[i + 1]! + delta;
          px[i + 2] = source[i + 2]! + delta;
          break;
        }
        case 'Glow': {
          const y8 = luminance(source[i]! / 255, source[i + 1]! / 255, source[i + 2]! / 255);
          const factor = 1 + num(rl.values, 'effect.glowStrength', 1) * Math.max(0, y8 - num(rl.values, 'effect.glowThreshold', 0.7));
          px[i] = source[i]! * factor;
          px[i + 1] = source[i + 1]! * factor;
          px[i + 2] = source[i + 2]! * factor;
          break;
        }
        case 'Chromatic aberration': {
          const shift = Math.round(num(rl.values, 'effect.aberration', 4) * scale);
          px[i] = source[at(x + shift, y)]!;
          px[i + 2] = source[at(x - shift, y) + 2]!;
          break;
        }
        case 'Displacement': {
          const h = grainHash(ax, ay, num(rl.values, 'effect.grainSeed'));
          const offset = Math.round(num(rl.values, 'effect.displacement', 10) * (2 * h - 1) * scale);
          const j = at(x + offset, y);
          px[i] = source[j]!;
          px[i + 1] = source[j + 1]!;
          px[i + 2] = source[j + 2]!;
          break;
        }
        case 'Pixelate': {
          const cell = Math.max(1, Math.round(num(rl.values, 'effect.pixelCell', 8)));
          const cx = Math.floor(ax / cell) * cell + Math.floor(cell / 2);
          const cy = Math.floor(ay / cell) * cell + Math.floor(cell / 2);
          const j = at(Math.floor((cx + 0.5) * scale), Math.floor((cy + 0.5) * scale));
          px[i] = source[j]!;
          px[i + 1] = source[j + 1]!;
          px[i + 2] = source[j + 2]!;
          break;
        }
        default:
          break;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
}

function drawStack(d: Drawing, scenery: ResolvedScenery, parentId: string | null): void {
  const stack = stackOf(scenery.layers, parentId);
  stack.forEach((rl, index) => {
    if (!bool(rl.values, 'visible', true)) return;
    const kind = rl.layer.kind;
    if (kind === 'Group') return drawStack(d, scenery, rl.layer.id);
    if (rl.layer.maskAbove) return;
    if (kind === 'Effect') return applyEffect(d, rl);
    if (kind === 'Rectangle' || kind === 'Ellipse' || kind === 'Polygon' || kind === 'Text' || kind === 'Image' || kind === 'Gradient') {
      const below = stack[index - 1];
      const mask = below && below.layer.maskAbove && bool(below.values, 'visible', true) ? below : null;
      drawFlat(d, rl, mask);
    }
  });
}

/** The environment's faint tint behind everything and the violet light field, both decoration of the canvas. */
function drawAtmosphere(d: Drawing, environment: string, focus: { x: number; y: number } | null, lightOn: boolean): void {
  const { ctx, width, height } = d;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (environment === 'Dusk room') {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, 'rgba(120, 90, 200, 0.10)');
    g.addColorStop(1, 'rgba(240, 160, 90, 0.07)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  } else if (environment === 'Night grid') {
    ctx.strokeStyle = 'rgba(142, 108, 242, 0.10)';
    ctx.lineWidth = 1;
    const cell = Math.max(24, width / 24);
    ctx.beginPath();
    for (let x = 0; x <= width; x += cell) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += cell) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }
  if (lightOn && focus) {
    const radius = Math.max(width, height) * 0.85;
    const g = ctx.createRadialGradient(focus.x * width, focus.y * height, 0, focus.x * width, focus.y * height, radius);
    g.addColorStop(0, 'rgba(183, 164, 255, 0.46)');
    g.addColorStop(0.3, 'rgba(142, 108, 242, 0.24)');
    g.addColorStop(0.65, 'rgba(142, 108, 242, 0.08)');
    g.addColorStop(1, 'rgba(142, 108, 242, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

interface UnderInput {
  ctx: Context;
  width: number;
  height: number;
  artboardWidth: number;
  scenery: ResolvedScenery;
  background: string;
  environment: string;
  lightOn: boolean;
  lightFocus: { x: number; y: number } | null;
  loader: AssetLoader;
  assets: Assets;
}

export function drawUnder(input: UnderInput): void {
  const { ctx, width, height } = input;
  const d: Drawing = { ctx, width, height, scale: width / input.artboardWidth, loader: input.loader, assets: input.assets };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.fillStyle = input.background;
  ctx.fillRect(0, 0, width, height);
  drawAtmosphere(d, input.environment, input.lightFocus, input.lightOn);
  drawStack(d, input.scenery, null);
}
