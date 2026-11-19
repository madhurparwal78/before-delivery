// The PNG: the same marks as the SVG view, drawn from the shared chart layout onto a 1200 x 800 canvas.
import path from 'node:path';
import { createCanvas, GlobalFonts, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import { HIGH_COLOUR, LOW_COLOUR, OUTLINE_COLOUR, patternInk, patternTile, TILE_SIZE, type PatternName } from '../../shared/chart/palette.ts';
import { layoutChart } from '../../shared/chart/layout.ts';
import type { ChartLayout, ChartMark, Rect, TextSpot } from '../../shared/chart/types.ts';
import { STAGE_HEIGHT, STAGE_WIDTH } from '../../shared/layout.ts';
import type { ExportDocument, SheetBlock } from './document.ts';

export const PNG_WIDTH = 1200;
export const PNG_HEIGHT = 800;
const HEADER = 48;
export const FAMILY = 'Stack Sans Text';
const GROUND = '#FDF1F7';
const INK = '#1A0A14';
const MUTED = '#6E4A5E';

const rgb = (triple: string): string => `rgb(${triple})`;

/** Registers the bundled Stack Sans Text weights once; the PDF sets its names in the 600 weight. */
export function registerFonts(fontDir: string): void {
  if (GlobalFonts.has(FAMILY)) return;
  for (const weight of [400, 600]) {
    GlobalFonts.registerFromPath(path.join(fontDir, `stack-sans-text-latin-${weight}-normal.woff`), FAMILY);
  }
}

function drawText(ctx: SKRSContext2D, spot: TextSpot, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${size}px "${FAMILY}"`;
  ctx.textAlign = spot.anchor === 'middle' ? 'center' : spot.anchor === 'end' ? 'right' : 'left';
  ctx.textBaseline = 'middle';
  ctx.translate(spot.x, spot.y);
  ctx.rotate((spot.rotate * Math.PI) / 180);
  ctx.fillText(spot.text, 0, 0);
  ctx.restore();
}

function tileOf(pattern: PatternName, ink: string): Canvas {
  const tile = createCanvas(TILE_SIZE, TILE_SIZE);
  const ctx = tile.getContext('2d');
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  for (const shape of patternTile(pattern)) {
    ctx.beginPath();
    if (shape.kind === 'circle') {
      ctx.arc(shape.cx, shape.cy, shape.r, 0, Math.PI * 2);
      if (shape.fill) ctx.fill();
      else ctx.stroke();
    } else if (shape.kind === 'rect') {
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    } else {
      ctx.lineWidth = shape.width;
      ctx.moveTo(shape.x1, shape.y1);
      ctx.lineTo(shape.x2, shape.y2);
      ctx.stroke();
    }
  }
  return tile;
}

/** Fills the current path with the mark colour, then lays the pattern over it. */
function fillMark(ctx: SKRSContext2D, color: string, pattern: PatternName): void {
  ctx.fillStyle = rgb(color);
  ctx.fill();
  if (pattern === 'solid') return;
  const fill = ctx.createPattern(tileOf(pattern, rgb(patternInk(color))), 'repeat');
  if (!fill) return;
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawMark(ctx: SKRSContext2D, mark: ChartMark, layout: ChartLayout): void {
  const { box } = mark;
  ctx.beginPath();
  if (mark.shape === 'point') ctx.arc(box.x + box.width / 2, box.y + box.height / 2, mark.radius, 0, Math.PI * 2);
  else if (mark.shape !== 'text') ctx.rect(box.x, box.y, box.width, box.height);
  if (mark.shape !== 'text') {
    if (mark.color === '') {
      ctx.fillStyle = GROUND;
      ctx.fill();
    } else {
      fillMark(ctx, mark.color, mark.pattern);
    }
    ctx.strokeStyle = rgb(OUTLINE_COLOUR);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (mark.text !== '') {
    const ink = mark.color === '' ? INK : rgb(patternInk(mark.color));
    const centre = { text: mark.text, x: box.x + box.width / 2, y: box.y + box.height / 2, anchor: 'middle' as const, rotate: 0 };
    drawText(ctx, centre, layout.fontSize.mark, mark.shape === 'text' ? INK : ink);
  }
  if (mark.label) drawText(ctx, mark.label, layout.fontSize.mark, INK);
}

function drawLegend(ctx: SKRSContext2D, layout: ChartLayout, right: number, top: number): void {
  const swatch = 12;
  let x = right;
  for (const entry of [...layout.legend].reverse()) {
    x -= ctx.measureText(entry.text).width;
    drawText(ctx, { text: entry.text, x, y: top, anchor: 'start', rotate: 0 }, layout.fontSize.label, INK);
    const width = entry.scale ? swatch * 3 : swatch;
    x -= width + 6;
    if (entry.scale) {
      const gradient = ctx.createLinearGradient(x, 0, x + width, 0);
      gradient.addColorStop(0, rgb(LOW_COLOUR));
      gradient.addColorStop(1, rgb(HIGH_COLOUR));
      ctx.fillStyle = gradient;
      ctx.fillRect(x, top - swatch / 2, width, swatch);
    } else {
      ctx.beginPath();
      ctx.rect(x, top - swatch / 2, width, swatch);
      fillMark(ctx, entry.color, entry.pattern);
    }
    x -= 18;
  }
}

function drawChart(ctx: SKRSContext2D, layout: ChartLayout): void {
  ctx.lineWidth = 1;
  for (const tick of layout.ticks) {
    ctx.strokeStyle = '#E9D3DF';
    ctx.beginPath();
    ctx.moveTo(tick.line.x1, tick.line.y1);
    ctx.lineTo(tick.line.x2, tick.line.y2);
    ctx.stroke();
    drawText(ctx, tick, layout.fontSize.label, MUTED);
  }
  if (layout.baseline) {
    ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(layout.baseline.x1, layout.baseline.y1);
    ctx.lineTo(layout.baseline.x2, layout.baseline.y2);
    ctx.stroke();
  }
  for (const spot of layout.categories) drawText(ctx, spot, layout.fontSize.label, INK);
  for (const spot of layout.titles) drawText(ctx, spot, layout.fontSize.label, MUTED);
  for (const series of layout.series) {
    ctx.strokeStyle = rgb(series.color);
    ctx.lineWidth = 2.5;
    for (const run of series.runs) {
      ctx.beginPath();
      run.forEach((point, i) => (i === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.stroke();
    }
  }
  for (const mark of layout.marks) drawMark(ctx, mark, layout);
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  for (const line of [...layout.references.map((r) => r.segment), ...(layout.trend ? [layout.trend.segment] : [])]) {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const reference of layout.references) drawText(ctx, reference.label, layout.fontSize.label, INK);
}

function drawBlock(ctx: SKRSContext2D, block: SheetBlock, frame: Rect, dashboard: boolean): void {
  const caption = dashboard ? 24 : 0;
  const layout = layoutChart(block.sheet, block.result, { width: frame.width, height: frame.height - caption }, { touch: false, compact: dashboard });
  ctx.save();
  ctx.translate(frame.x, frame.y);
  if (dashboard) drawText(ctx, { text: block.name, x: 8, y: 12, anchor: 'start', rotate: 0 }, 14, INK);
  ctx.translate(0, caption);
  ctx.font = `${layout.fontSize.label}px "${FAMILY}"`;
  drawChart(ctx, layout);
  drawLegend(ctx, layout, frame.width - 8, 8);
  ctx.restore();
}

export function renderPng(document: ExportDocument, fontDir: string): Buffer {
  registerFonts(fontDir);
  const canvas = createCanvas(PNG_WIDTH, PNG_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, PNG_WIDTH, PNG_HEIGHT);
  drawText(ctx, { text: document.name, x: 16, y: HEADER / 2, anchor: 'start', rotate: 0 }, 22, INK);
  ctx.save();
  ctx.translate(0, HEADER);
  const stage = document.dashboard ? { width: STAGE_WIDTH, height: STAGE_HEIGHT } : { width: PNG_WIDTH, height: PNG_HEIGHT - HEADER };
  ctx.scale(PNG_WIDTH / stage.width, (PNG_HEIGHT - HEADER) / stage.height);
  for (const block of document.blocks) {
    drawBlock(ctx, block, block.frame ?? { x: 0, y: 0, width: stage.width, height: stage.height }, document.dashboard);
  }
  ctx.restore();
  return canvas.toBuffer('image/png');
}
