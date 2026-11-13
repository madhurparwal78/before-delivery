// Drawing to SVG: one framework-free SvgNode tree per entity, shared by React, the publish files and the exports.
//
// Screen strokes use `vector-effect: non-scaling-stroke`, so a lineweight is a pixel width (STROKE_PX) and dashes are pixels.
// On a sheet (`paperScale` n) a lineweight is its millimetres on paper: the viewport group scales world units by 1/n, so strokes, dashes and
// text are multiplied by n. On the model view text is TEXT_WORLD_PER_MM world units per style millimetre.
import { COLOURS, type ColourName, type DimStyle, type DimensionEntity, type Entity, type HatchEntity, type InsertEntity, type Linetype, type Lineweight, type Point } from '../types.ts';
import { arcSweep, arcEnds } from './curves.ts';
import { type DimensionLayout, dimensionDataValue, dimensionLayout, dimensionStyle, dimensionText } from './dimension.ts';
import { type HatchLoop } from './hatch.ts';
import { fmtData, round6 } from './numbers.ts';
import { hatchShape } from './prims.ts';
import { type Scene, type SceneEntity, layerOf } from './scene.ts';
import { blockChildren, childColour, effectiveColour, placeChild } from './transform.ts';

export interface SvgNode { tag: string; attrs: Record<string, string>; children?: SvgNode[]; text?: string }
export type DiffState = 'added' | 'removed' | 'changed' | 'same';

/** On paper (a sheet viewport) strokes, dashes and text are in mm * n world units, `n` being the viewport scale denominator. */
export interface RenderOptions { selected?: boolean; diff?: DiffState; paperScale?: number }

/** Screen stroke width in px by lineweight in mm: the one mapping. */
const STROKE_PX: Readonly<Record<Lineweight, number>> = { 0.13: 0.6, 0.18: 0.8, 0.25: 1, 0.35: 1.4, 0.5: 2, 0.7: 2.8 };
/** Colour names on the near-black ground `#0f1110`; each at least 7:1. `white` is the ink. */
const COLOUR_HEX: Readonly<Record<ColourName, string>> = {
  white: '#ebe6da', red: '#f2837a', yellow: '#e6cf6e', green: '#7fcf8a', cyan: '#6ccfd9', blue: '#7da6f2', magenta: '#d98ad9', grey: '#9aa39d',
};
const DIFF_STYLE: Readonly<Record<'added' | 'removed' | 'changed', { hex: string; dashed: boolean; heavier: number }>> = {
  added: { hex: '#a3bd9e', dashed: false, heavier: 1 },
  removed: { hex: '#8e9c92', dashed: true, heavier: 1 },
  changed: { hex: '#faf6ec', dashed: false, heavier: 1.6 },
};
/** Linetype dash patterns in mm on paper; on screen one mm is DASH_PX_PER_MM px. */
const DASH_MM: Readonly<Record<Linetype, readonly number[]>> = { Continuous: [], Dashed: [3, 1.5], Dotted: [0.4, 1.2], Centre: [6, 1.2, 1.2, 1.2] };
const DASH_PX_PER_MM = 3;
/** World units per style text millimetre on the model view. */
const TEXT_WORLD_PER_MM = 1;
const HATCH_MODEL_SPACING = 1;
const HATCH_PAPER_SPACING_MM = 2;
const ARROW_LENGTH_RATIO = 0.8;
const ARROW_HALF_WIDTH_RATIO = 0.25;
const TEXT_LIFT_RATIO = 0.35;
const FONT = 'Funnel Sans, system-ui, sans-serif';

export function strokePx(lineweight: Lineweight): number {
  return STROKE_PX[lineweight];
}

export function colourHex(colour: ColourName): string {
  return COLOUR_HEX[colour];
}

export const el = (tag: string, attrs: Record<string, string>, children?: SvgNode[]): SvgNode => (children === undefined ? { tag, attrs } : { tag, attrs, children });
export const num = (n: number): string => fmtData(n);

interface Look { colour: ColourName; linetype: Linetype; lineweight: Lineweight }

function strokeAttrs(look: Look, options: RenderOptions): Record<string, string> {
  const diff = options.diff === undefined || options.diff === 'same' ? null : DIFF_STYLE[options.diff];
  const n = options.paperScale ?? null;
  const weight = (n === null ? strokePx(look.lineweight) : look.lineweight * n) * (diff === null ? 1 : diff.heavier);
  const pattern = diff?.dashed === true && look.linetype === 'Continuous' ? DASH_MM.Dashed : DASH_MM[look.linetype];
  const unit = n === null ? DASH_PX_PER_MM : n;
  const attrs: Record<string, string> = { stroke: diff === null ? colourHex(look.colour) : diff.hex, 'stroke-width': num(round6(weight)), fill: 'none' };
  if (pattern.length > 0) attrs['stroke-dasharray'] = pattern.map((length) => num(round6(length * unit))).join(' ');
  if (n === null) attrs['vector-effect'] = 'non-scaling-stroke';
  return attrs;
}

function fillHex(look: Look, options: RenderOptions): string {
  return options.diff === undefined || options.diff === 'same' ? colourHex(look.colour) : DIFF_STYLE[options.diff].hex;
}

/** The SVG path of an arc: counter-clockwise from `start` to `end` degrees; an arc whose ends coincide is the full circle (two half arcs). */
export function arcPath(c: Point, r: number, start: number, end: number): string {
  const [from, to] = arcEnds({ kind: 'arc', c, r, start, end });
  const sweep = arcSweep(start, end);
  const move = `M ${num(from[0])} ${num(from[1])}`;
  if (sweep >= 360 - 1e-9) {
    const opposite: Point = [2 * c[0] - from[0], 2 * c[1] - from[1]];
    return `${move} A ${num(r)} ${num(r)} 0 0 1 ${num(opposite[0])} ${num(opposite[1])} A ${num(r)} ${num(r)} 0 0 1 ${num(from[0])} ${num(from[1])}`;
  }
  return `${move} A ${num(r)} ${num(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${num(to[0])} ${num(to[1])}`;
}

function loopPath(loop: HatchLoop): string {
  let from: Point = loop.start;
  const parts = [`M ${num(from[0])} ${num(from[1])}`];
  for (const step of loop.steps) {
    if (step.kind === 'line') parts.push(`L ${num(step.to[0])} ${num(step.to[1])}`);
    else parts.push(`A ${num(step.r)} ${num(step.r)} 0 ${step.sweep > 180 ? 1 : 0} ${step.ccw ? 1 : 0} ${num(step.to[0])} ${num(step.to[1])}`);
    from = step.to;
  }
  return `${parts.join(' ')} Z`;
}

const pointList = (points: readonly Point[]): string => points.map((p) => `${num(p[0])},${num(p[1])}`).join(' ');

type Shape = Extract<Entity, { type: 'line' | 'circle' | 'arc' | 'pline' }>;
const isShape = (entity: Entity): entity is Shape => entity.type === 'line' || entity.type === 'circle' || entity.type === 'arc' || entity.type === 'pline';

/** The drawn shape of a line, circle, arc or polyline with the given attributes. */
function shapeNode(entity: Shape, attrs: Record<string, string>): SvgNode {
  switch (entity.type) {
    case 'line':
      return el('line', { x1: num(entity.x1), y1: num(entity.y1), x2: num(entity.x2), y2: num(entity.y2), ...attrs });
    case 'circle':
      return el('circle', { cx: num(entity.cx), cy: num(entity.cy), r: num(entity.r), ...attrs });
    case 'arc':
      return el('path', { d: arcPath([entity.cx, entity.cy], entity.r, entity.start, entity.end), ...attrs });
    case 'pline':
      return el(entity.closed ? 'polygon' : 'polyline', { points: pointList(entity.points), ...attrs });
  }
}

function lookOf(scene: Scene, entity: Entity, parent: Look): Look {
  const layer = layerOf(scene, entity.layer);
  const colour = effectiveColour(childColour(entity, parent.colour), layer);
  return {
    colour,
    linetype: entity.linetype === undefined || entity.linetype === 'ByLayer' ? layer.linetype : entity.linetype,
    lineweight: entity.lineweight === undefined || entity.lineweight === 'ByLayer' ? layer.lineweight : entity.lineweight,
  };
}

/** An insert's definition drawn in place, nested inserts expanded; every child with its own inherited look. */
function insertChildren(scene: Scene, insert: InsertEntity, blocks: SceneEntity['blocks'], look: Look, options: RenderOptions): SvgNode[] {
  const def = blocks[insert.block];
  if (def === undefined) return [];
  return blockChildren(def).flatMap((child) => {
    const placed = placeChild(child, insert, def);
    const childLook = lookOf(scene, child, look);
    if (placed.type === 'insert') return insertChildren(scene, placed, blocks, childLook, options);
    return isShape(placed) ? [shapeNode(placed, strokeAttrs(childLook, options))] : [];
  });
}

function hatchPatternId(colour: ColourName, paperScale: number | undefined): string {
  return paperScale === undefined ? `plot-hatch-${colour}` : `plot-hatch-${colour}-${paperScale}`;
}

function hatchNode(scene: Scene, e: SceneEntity, hatch: HatchEntity, options: RenderOptions, attrs: Record<string, string>): SvgNode {
  const region = hatchShape(hatch, (handle) => scene.byId.get(handle)?.entity);
  const d = region === null ? '' : [region.outer, ...region.islands].map(loopPath).join(' ');
  const fill = options.diff === undefined || options.diff === 'same' ? `url(#${hatchPatternId(e.colour, options.paperScale)})` : fillHex(e, options);
  return el('path', { ...attrs, d, 'fill-rule': 'evenodd', fill, stroke: 'none', 'data-area': num(hatch.area), 'data-associative': String(hatch.associative) });
}

interface TextPlan { height: number; paperHeightMm: number | null }

function textPlan(style: DimStyle, options: RenderOptions): TextPlan {
  const n = options.paperScale;
  return n === undefined
    ? { height: style.text_height_mm * TEXT_WORLD_PER_MM, paperHeightMm: null }
    : { height: style.text_height_mm * n, paperHeightMm: style.text_height_mm };
}

function arrowNode(tip: Point, along: Point, plan: TextPlan, hex: string): SvgNode {
  const length = plan.height * ARROW_LENGTH_RATIO;
  const half = plan.height * ARROW_HALF_WIDTH_RATIO;
  const base: Point = [tip[0] + along[0] * length, tip[1] + along[1] * length];
  const left: Point = [base[0] - along[1] * half, base[1] + along[0] * half];
  const right: Point = [base[0] + along[1] * half, base[1] - along[0] * half];
  return el('polygon', { points: pointList([tip, left, right]), fill: hex, stroke: 'none' });
}

function dimensionNodes(layout: DimensionLayout, dimension: DimensionEntity, style: DimStyle, e: SceneEntity, options: RenderOptions): SvgNode[] {
  const plan = textPlan(style, options);
  const stroke = strokeAttrs(e, options);
  const nodes: SvgNode[] = layout.segments.map(([a, b]) => el('line', { x1: num(a[0]), y1: num(a[1]), x2: num(b[0]), y2: num(b[1]), ...stroke }));
  if (layout.arc !== null) nodes.push(el('path', { d: arcPath(layout.arc.c, layout.arc.r, layout.arc.start, layout.arc.end), ...stroke }));
  nodes.push(...layout.arrows.map((arrow) => arrowNode(arrow.tip, arrow.along, plan, fillHex(e, options))));
  nodes.push(dimensionTextNode(layout.text, layout.textAngle, dimensionText(dimension, style), plan, style, fillHex(e, options)));
  return nodes;
}

function dimensionTextNode(at: Point, angle: number, content: string, plan: TextPlan, style: DimStyle, hex: string): SvgNode {
  const attrs: Record<string, string> = {
    transform: `translate(${num(round6(at[0]))} ${num(round6(at[1]))}) rotate(${num(round6(angle))}) translate(0 ${num(round6(plan.height * TEXT_LIFT_RATIO))}) scale(1 -1)`,
    'font-family': FONT, 'font-size': num(round6(plan.height)), 'text-anchor': 'middle', fill: hex, stroke: 'none',
  };
  if (plan.paperHeightMm !== null) {
    attrs['data-text-height-mm'] = num(style.text_height_mm);
    attrs['data-world-text-height'] = num(round6(plan.height));
  }
  return { tag: 'text', attrs, text: content };
}

/** The SVG element of one entity with every `data-*` attribute of 'Entity elements'; block inserts expanded. */
export function renderEntity(scene: Scene, e: SceneEntity, options: RenderOptions = {}): SvgNode {
  const entity = e.entity;
  const common: Record<string, string> = {
    'data-entity-id': e.id, 'data-type': entity.type, 'data-layer': entity.layer,
    'data-colour': e.colour, 'data-linetype': e.linetype, 'data-lineweight': num(e.lineweight),
  };
  if (options.selected === true) common['aria-selected'] = 'true';
  if (options.diff !== undefined) common['data-diff'] = options.diff;
  if (e.clip !== null) common['clip-path'] = `url(#${e.clip.id})`;
  const stroke = strokeAttrs(e, options);
  switch (entity.type) {
    case 'line':
      return shapeNode(entity, { ...common, 'data-x1': num(entity.x1), 'data-y1': num(entity.y1), 'data-x2': num(entity.x2), 'data-y2': num(entity.y2), ...stroke });
    case 'circle':
      return shapeNode(entity, { ...common, 'data-cx': num(entity.cx), 'data-cy': num(entity.cy), 'data-r': num(entity.r), ...stroke });
    case 'arc':
      return shapeNode(entity, {
        ...common, 'data-cx': num(entity.cx), 'data-cy': num(entity.cy), 'data-r': num(entity.r), 'data-start': num(entity.start), 'data-end': num(entity.end), ...stroke,
      });
    case 'pline':
      return shapeNode(entity, { ...common, 'data-points': pointList(entity.points), 'data-closed': String(entity.closed), ...stroke });
    case 'insert':
      return el('g', {
        ...common, 'data-block': entity.block, 'data-x': num(entity.x), 'data-y': num(entity.y), 'data-scale': num(entity.scale), 'data-rotation': num(entity.rotation),
      }, insertChildren(scene, entity, e.blocks, e, options));
    case 'hatch':
      return hatchNode(scene, e, entity, options, common);
    case 'dimension': {
      const style = dimensionStyle(scene.dimStyles, entity.style);
      const layout = dimensionLayout(entity, (handle) => scene.byId.get(handle)?.entity);
      const attrs = { ...common, 'data-kind': entity.kind, 'data-value': dimensionDataValue(entity, style), 'data-associative': String(entity.associative) };
      const textOnly: DimensionLayout = { segments: [], arc: null, arrows: [], text: [entity.text_x, entity.text_y], textAngle: 0 };
      return el('g', attrs, dimensionNodes(layout ?? textOnly, entity, style, e, options));
    }
  }
}

function hatchPattern(colour: ColourName, spacing: number, id: string): SvgNode {
  const hex = colourHex(colour);
  return el('pattern', { id, patternUnits: 'userSpaceOnUse', width: num(spacing), height: num(spacing), patternTransform: 'rotate(45)' }, [
    el('line', { x1: '0', y1: '0', x2: '0', y2: num(spacing), stroke: hex, 'stroke-width': num(spacing / 8) }),
  ]);
}

/** Hatch patterns for a sheet viewport at scale 1:n (spacing 2 mm on paper). */
export function paperHatchPatterns(paperScale: number): SvgNode[] {
  return COLOURS.map((colour) => hatchPattern(colour, HATCH_PAPER_SPACING_MM * paperScale, hatchPatternId(colour, paperScale)));
}

/** The xref clip rectangles that entity elements refer to. */
export function clipPaths(scene: Scene): SvgNode[] {
  return scene.clips.map((clip) => el('clipPath', { id: clip.id }, [
    el('rect', { x: num(clip.rect[0]), y: num(clip.rect[1]), width: num(clip.rect[2] - clip.rect[0]), height: num(clip.rect[3] - clip.rect[1]) }),
  ]));
}

/** `<defs>`: hatch patterns and xref clip rectangles. Include once per `<svg>`. */
export function renderDefs(scene: Scene): SvgNode {
  const patterns = COLOURS.map((colour) => hatchPattern(colour, HATCH_MODEL_SPACING, hatchPatternId(colour, undefined)));
  return el('defs', {}, [...patterns, ...clipPaths(scene)]);
}

/** XML 1.0 cannot write these control characters, not even as references: a name or attribute value that has one shows the replacement character. */
const NOT_XML_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g;
// A carriage return is written as a reference, or a parser would read it as a line feed; so are a tab and a line feed inside an attribute.
const escapeText = (value: string): string =>
  value.replace(NOT_XML_TEXT, '\ufffd').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\r', '&#13;');
const escapeAttr = (value: string): string => escapeText(value).replaceAll('"', '&quot;').replaceAll('\t', '&#9;').replaceAll('\n', '&#10;');

/** Markup-free string form of a node tree: attributes in double quotes, escaped. */
export function serializeSvg(node: SvgNode): string {
  const attrs = Object.entries(node.attrs).map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');
  if (node.text !== undefined) return `<${node.tag}${attrs}>${escapeText(node.text)}</${node.tag}>`;
  if (node.children === undefined || node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serializeSvg).join('')}</${node.tag}>`;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
const GROUND = '#0f1110';

/** Standalone SVG export of a drawing: root `<svg xmlns>`, every entity one element with the same data-* attributes (hidden layers `display="none"`). */
export function modelSvg(scene: Scene): string {
  const [x1, y1, x2, y2] = scene.bounds ?? [0, 0, 100, 100];
  const pad = Math.max(x2 - x1, y2 - y1) * 0.05 + 1;
  const width = x2 - x1 + 2 * pad;
  const height = y2 - y1 + 2 * pad;
  const entities = scene.entities.map((e) => {
    const node = renderEntity(scene, e);
    return e.visible ? node : { ...node, attrs: { ...node.attrs, display: 'none' } };
  });
  const root = el('svg', { xmlns: SVG_NS, viewBox: `${num(x1 - pad)} ${num(-(y2 + pad))} ${num(width)} ${num(height)}` }, [
    el('rect', { x: num(x1 - pad), y: num(-(y2 + pad)), width: num(width), height: num(height), fill: GROUND }),
    renderDefs(scene),
    el('g', { transform: 'matrix(1 0 0 -1 0 0)' }, entities),
  ]);
  return serializeSvg(root);
}
