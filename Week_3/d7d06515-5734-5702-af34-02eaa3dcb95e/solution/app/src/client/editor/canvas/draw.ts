// Canvas 2D painting of the base drawing, the grid and the paper sheet. Pure functions of their arguments.
import { BORDER, SHEET, TITLE_BLOCK, VIEWPORT_FRAME, plotColor, titleBlockText, viewportTransform } from '../../../shared/sheet.ts';
import type { Bounds } from '../../../shared/geometry.ts';
import type { ColorName, LinetypeName, LineweightName, PlotStyle, Primitive, ViewportScale } from '../../../shared/types.ts';
import { token } from '../../ui/motion.ts';
import { GRID_MM } from './snap.ts';
import type { Box, Bucket, Scene } from './scene.ts';

/** Model millimetres -> canvas pixels: x = X*k + ox, y = -Y*k + oy. */
export interface Projection { k: number; ox: number; oy: number }

interface Palette {
  ground: string;
  canvas: string;
  link: string;
  muted: string;
  paper: string;
  aci: Record<ColorName, string>;
}

let palette: Palette | null = null;

/** Colours come from the design tokens; they are read once. */
function paletteOf(): Palette {
  palette ??= {
    ground: token('--ground'), canvas: token('--canvas'), link: token('--link'), muted: token('--muted'), paper: token('--paper'),
    aci: {
      Red: token('--aci-red'), Yellow: token('--aci-yellow'), Green: token('--aci-green'), Cyan: token('--aci-cyan'),
      Blue: token('--aci-blue'), Magenta: token('--aci-magenta'), White: token('--aci-white'),
    },
  };
  return palette;
}

const DASHES: Record<LinetypeName, readonly number[]> = { Continuous: [], Dashed: [8, 5], Hidden: [4, 3], Center: [16, 3, 3, 3] };
const FADED_ALPHA = 0.4;
const MIN_TEXT_PX = 3;

/** 0.13 mm draws 1 px wide and 1.00 mm draws 3 px. */
const lineweightPx = (lineweight: LineweightName): number => 1 + ((parseFloat(lineweight) - 0.13) / (1 - 0.13)) * 2;

const overlaps = (a: Box, b: Box): boolean => a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;

function trace(ctx: CanvasRenderingContext2D, primitive: Primitive, p: Projection): void {
  switch (primitive.kind) {
    case 'line':
      ctx.moveTo(primitive.a[0] * p.k + p.ox, p.oy - primitive.a[1] * p.k);
      ctx.lineTo(primitive.b[0] * p.k + p.ox, p.oy - primitive.b[1] * p.k);
      break;
    case 'polyline': {
      primitive.points.forEach((point, index) => {
        const x = point[0] * p.k + p.ox;
        const y = p.oy - point[1] * p.k;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      if (primitive.closed) ctx.closePath();
      break;
    }
    case 'circle':
      ctx.moveTo(primitive.center[0] * p.k + p.ox + primitive.radius * p.k, p.oy - primitive.center[1] * p.k);
      ctx.arc(primitive.center[0] * p.k + p.ox, p.oy - primitive.center[1] * p.k, primitive.radius * p.k, 0, Math.PI * 2);
      break;
    case 'arc': {
      const start = (primitive.start_angle * Math.PI) / 180;
      const end = (primitive.end_angle * Math.PI) / 180;
      const cx = primitive.center[0] * p.k + p.ox;
      const cy = p.oy - primitive.center[1] * p.k;
      ctx.moveTo(cx + primitive.radius * p.k * Math.cos(start), cy - primitive.radius * p.k * Math.sin(start));
      ctx.arc(cx, cy, primitive.radius * p.k, -start, -end, true);
      break;
    }
    case 'text': break;
  }
}

function paintBucket(ctx: CanvasRenderingContext2D, bucket: Bucket, p: Projection, view: Box, color: string, alpha: number, widen: number): void {
  const visible = bucket.items.filter((item) => overlaps(item.box, view));
  if (visible.length === 0) return;
  ctx.globalAlpha = alpha * (bucket.faded ? FADED_ALPHA : 1);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineweightPx(bucket.lineweight) + widen;
  ctx.setLineDash(DASHES[bucket.linetype].map((length) => length * bucket.linetypeScale));
  ctx.beginPath();
  for (const item of visible) trace(ctx, item.primitive, p);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const item of visible) {
    const primitive = item.primitive;
    if (primitive.kind !== 'text') continue;
    const size = primitive.height * p.k;
    if (size < MIN_TEXT_PX) continue;
    ctx.font = `${size}px "Fira Sans", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(primitive.text, primitive.at[0] * p.k + p.ox, p.oy - primitive.at[1] * p.k);
  }
}

interface PaintOptions {
  /** Base geometry dims to 40% while a trace is shown. */
  dim: boolean;
  /** Handles drawn with a highlight halo. */
  halo: ReadonlySet<string>;
  /** Maps a drawing colour to the colour that paints it (paper previews print in the plot style). */
  colorOf?: (color: ColorName) => string;
}

function viewBox(p: Projection, width: number, height: number): Box {
  return { minX: (0 - p.ox) / p.k, maxX: (width - p.ox) / p.k, minY: (p.oy - height) / p.k, maxY: p.oy / p.k };
}

export function paintScene(ctx: CanvasRenderingContext2D, scene: Scene, p: Projection, width: number, height: number, options: PaintOptions): void {
  const colors = paletteOf();
  const view = viewBox(p, width, height);
  const colorOf = options.colorOf ?? ((color: ColorName) => colors.aci[color]);
  const alpha = options.dim ? FADED_ALPHA : 1;
  for (const bucket of scene.buckets) paintBucket(ctx, bucket, p, view, colorOf(bucket.color), alpha, 0);
  if (options.halo.size > 0) {
    const highlighted: Bucket[] = [];
    for (const bucket of scene.buckets) {
      const items = bucket.items.filter((item) => options.halo.has(item.handle));
      if (items.length > 0) highlighted.push({ ...bucket, faded: false, items });
    }
    for (const bucket of highlighted) paintBucket(ctx, bucket, p, view, colors.link, 0.55, 4);
    for (const bucket of highlighted) paintBucket(ctx, bucket, p, view, colorOf(bucket.color), 1, 0);
  }
  ctx.globalAlpha = 1;
}

/** Fills the canvas ground and, when SNAP & GRID is on, the 100 mm grid dots (hidden when they would be crowded). */
export function paintGround(ctx: CanvasRenderingContext2D, p: Projection, width: number, height: number, grid: boolean): void {
  const colors = paletteOf();
  ctx.fillStyle = colors.canvas;
  ctx.fillRect(0, 0, width, height);
  if (!grid || GRID_MM * p.k < 5) return;
  const view = viewBox(p, width, height);
  ctx.fillStyle = colors.muted;
  ctx.globalAlpha = 0.45;
  for (let x = Math.ceil(view.minX / GRID_MM) * GRID_MM; x <= view.maxX; x += GRID_MM) {
    for (let y = Math.ceil(view.minY / GRID_MM) * GRID_MM; y <= view.maxY; y += GRID_MM) {
      ctx.fillRect(x * p.k + p.ox - 0.5, p.oy - y * p.k - 0.5, 1.5, 1.5);
    }
  }
  ctx.globalAlpha = 1;
}

interface PaperInput {
  scene: Scene;
  title: string;
  scale: ViewportScale | undefined;
  plotStyle: PlotStyle;
  extents: Bounds | null;
}

/** The paper layout: the A3 sheet on the black ground, its border, the title block and the clipped viewport. */
export function paintPaper(ctx: CanvasRenderingContext2D, p: Projection, width: number, height: number, input: PaperInput): void {
  const colors = paletteOf();
  ctx.fillStyle = colors.ground;
  ctx.fillRect(0, 0, width, height);
  const rect = (r: { x: number; y: number; width: number; height: number }): [number, number, number, number] =>
    [r.x * p.k + p.ox, p.oy - (r.y + r.height) * p.k, r.width * p.k, r.height * p.k];
  ctx.fillStyle = colors.paper;
  ctx.fillRect(...rect({ x: 0, y: 0, width: SHEET.width, height: SHEET.height }));
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(...rect(BORDER));
  ctx.lineWidth = 1;
  ctx.strokeRect(...rect(TITLE_BLOCK));
  ctx.strokeRect(...rect(VIEWPORT_FRAME));
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';
  const lines = titleBlockText({ title: input.title, scale: input.scale ?? null, issued: '', revision: '', note: '' });
  for (const line of lines.slice(0, 3)) {
    ctx.font = `${line.size * p.k}px "Fira Sans", sans-serif`;
    ctx.fillText(line.text, line.x * p.k + p.ox, p.oy - line.y * p.k);
  }
  const transform = viewportTransform(input.extents, input.scale ?? null);
  const model: Projection = { k: transform.factor * p.k, ox: transform.offsetX * p.k + p.ox, oy: p.oy - transform.offsetY * p.k };
  ctx.save();
  ctx.beginPath();
  ctx.rect(...rect(VIEWPORT_FRAME));
  ctx.clip();
  const toPrint = (color: ColorName): string => {
    const [r, g, b] = plotColor(input.plotStyle, color);
    return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
  };
  paintScene(ctx, input.scene, model, width, height, { dim: false, halo: new Set(), colorOf: toPrint });
  ctx.restore();
}
