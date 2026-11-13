// Sheets: paper in millimetres (Y down), viewports with the paper mapping, annotation scale, the title block, and the sheet SVG.
import { TITLE_BLOCK_AUTO_TAGS, TITLE_BLOCK_TAGS, SCALE_VARIES } from '../copy.ts';
import type { Entity, PaperSize, Point, Sheet, Viewport } from '../types.ts';
import { fmtData, pointAtAngle, round6 } from './numbers.ts';
import { SVG_NS, type SvgNode, clipPaths, el, num, paperHatchPatterns, renderEntity, serializeSvg } from './render.ts';
import type { Scene } from './scene.ts';
import type { Size } from './view.ts';

export { TITLE_BLOCK_TAGS };

export const PAPER_SIZES: Readonly<Record<PaperSize, Size>> = { A3: { width: 420, height: 297 }, A4: { width: 297, height: 210 } };

const PAPER_FILL = '#181b19';
const FRAME = '#8e9c92';
const INK = '#ebe6da';
const TITLE_BLOCK = { margin: 10, width: 110, row: 7, labelAt: 2, valueAt: 30, text: 2.5 } as const;

/** `1:50` -> 50. */
export function viewportScaleDenominator(scale: string): number {
  return Number(scale.split(':')[1]);
}

type MappedViewport = Pick<Viewport, 'x' | 'y' | 'width' | 'height' | 'scale' | 'view_x' | 'view_y'>;

/** World point to paper: X = vp.x + (wx - viewX) / n + width / 2, Y = vp.y + height / 2 - (wy - viewY) / n. */
export function paperPoint(viewport: MappedViewport, world: Point): Point {
  const n = viewportScaleDenominator(viewport.scale);
  return [viewport.x + (world[0] - viewport.view_x) / n + viewport.width / 2, viewport.y + viewport.height / 2 - (world[1] - viewport.view_y) / n];
}

export interface TitleBlockField { tag: string; value: string; editable: boolean }

/** The title block values: Sheet no, Title, Drawn by and Scale fill themselves (Scale: first viewport's `1:n`, `Varies` when they differ); others come from `attributes`. */
export function titleBlockFields(sheet: Sheet): TitleBlockField[] {
  const scales = sheet.viewports.map((viewport) => viewport.scale);
  const filled: Record<string, string> = {
    'Sheet no': String(sheet.number),
    Title: sheet.name,
    'Drawn by': sheet.creator,
    Scale: scales.every((scale) => scale === scales[0]) ? (scales[0] ?? '') : SCALE_VARIES,
  };
  const tags = [...TITLE_BLOCK_TAGS, ...Object.keys(sheet.attributes).filter((tag) => !(TITLE_BLOCK_TAGS as readonly string[]).includes(tag))];
  return tags.map((tag) => ({ tag, value: filled[tag] ?? sheet.attributes[tag] ?? '', editable: !TITLE_BLOCK_AUTO_TAGS.includes(tag) }));
}

function firstPoint(entity: Entity): Point {
  switch (entity.type) {
    case 'line':
      return [entity.x1, entity.y1];
    case 'circle':
      return [entity.cx, entity.cy];
    case 'arc':
      return pointAtAngle([entity.cx, entity.cy], entity.r, entity.start);
    case 'pline':
      return entity.points[0] ?? [0, 0];
    case 'insert':
      return [entity.x, entity.y];
    case 'hatch':
      return [entity.seed_x, entity.seed_y];
    case 'dimension':
      return [entity.text_x, entity.text_y];
  }
}

function viewportNode(viewport: Viewport, scene: Scene): SvgNode {
  const n = viewportScaleDenominator(viewport.scale);
  const copies = scene.entities
    .filter((e) => e.visible && !viewport.frozen_layers.includes(e.entity.layer))
    .map((e): SvgNode => {
      const node = renderEntity(scene, e, { paperScale: n });
      const [px, py] = paperPoint(viewport, firstPoint(e.entity));
      return { ...node, attrs: { ...node.attrs, 'data-paper-x': fmtData(px), 'data-paper-y': fmtData(py) } };
    });
  const e = round6(viewport.x + viewport.width / 2 - viewport.view_x / n);
  const f = round6(viewport.y + viewport.height / 2 + viewport.view_y / n);
  return el('g', {
    'data-viewport-id': viewport.id, 'data-scale': viewport.scale, 'data-view-x': num(viewport.view_x), 'data-view-y': num(viewport.view_y),
    'clip-path': `url(#plot-viewport-${viewport.id})`,
  }, [
    el('rect', { x: num(viewport.x), y: num(viewport.y), width: num(viewport.width), height: num(viewport.height), fill: 'none', stroke: FRAME, 'stroke-width': '0.25' }),
    el('g', { transform: `matrix(${num(1 / n)} 0 0 ${num(-1 / n)} ${num(e)} ${num(f)})` }, copies),
  ]);
}

function titleBlockNode(sheet: Sheet, paper: Size): SvgNode {
  const fields = titleBlockFields(sheet);
  const { margin, width, row, labelAt, valueAt, text } = TITLE_BLOCK;
  const x = paper.width - margin - width;
  const y = paper.height - margin - row * fields.length;
  const rows = fields.flatMap((field, i) => [
    el('line', { x1: num(x), y1: num(y + row * i), x2: num(x + width), y2: num(y + row * i), stroke: FRAME, 'stroke-width': '0.25' }),
    { tag: 'text', attrs: { x: num(x + labelAt), y: num(y + row * i + 4.6), 'font-size': num(text), fill: FRAME, 'data-title-tag': field.tag }, text: field.tag },
    { tag: 'text', attrs: { x: num(x + valueAt), y: num(y + row * i + 4.6), 'font-size': num(text), fill: INK, 'data-title-value': field.tag }, text: field.value },
  ]);
  return el('g', { 'data-title-block': `Title ${sheet.size}`, 'font-family': 'Funnel Sans, system-ui, sans-serif' }, [
    el('rect', { x: num(x), y: num(y), width: num(width), height: num(row * fields.length), fill: 'none', stroke: FRAME, 'stroke-width': '0.35' }),
    ...rows,
  ]);
}

/**
 * The sheet drawing: paper in mm (Y down), title block, viewports (`data-scale`, `data-view-x/y`, clipped) each with its own copy of every entity.
 * The root `<svg>` is sized in user units equal to millimetres, so it nests in a drawing group without rescaling.
 */
export function sheetNode(sheet: Sheet, scene: Scene): SvgNode {
  const paper = PAPER_SIZES[sheet.size];
  const scales = [...new Set(sheet.viewports.map((viewport) => viewportScaleDenominator(viewport.scale)))];
  const clips = sheet.viewports.map((viewport) => el('clipPath', { id: `plot-viewport-${viewport.id}` }, [
    el('rect', { x: num(viewport.x), y: num(viewport.y), width: num(viewport.width), height: num(viewport.height) }),
  ]));
  return el('svg', {
    xmlns: SVG_NS, viewBox: `0 0 ${paper.width} ${paper.height}`, width: String(paper.width), height: String(paper.height), 'data-sheet-id': sheet.id, 'data-size': sheet.size,
  }, [
    el('defs', {}, [...scales.flatMap(paperHatchPatterns), ...clipPaths(scene), ...clips]),
    el('rect', { x: '0', y: '0', width: num(paper.width), height: num(paper.height), fill: PAPER_FILL, stroke: FRAME, 'stroke-width': '0.5' }),
    ...sheet.viewports.map((viewport) => viewportNode(viewport, scene)),
    titleBlockNode(sheet, paper),
  ]);
}

/** `sheetNode` as a standalone SVG file in millimetres (publish files, folder thumbnails). */
export function sheetSvg(sheet: Sheet, scene: Scene): string {
  const node = sheetNode(sheet, scene);
  const paper = PAPER_SIZES[sheet.size];
  return serializeSvg({ ...node, attrs: { ...node.attrs, width: `${paper.width}mm`, height: `${paper.height}mm` } });
}
