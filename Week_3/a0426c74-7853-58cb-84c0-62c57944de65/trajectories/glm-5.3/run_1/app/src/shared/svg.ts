import { COLOUR_HEX, type Entity, type Pt, type ResolvedEntity } from './geometry.js';
import { numberKey } from './num.js';
import type { DimStyleRecord, LayerRecord } from './model.js';
import { dimensionText } from './derived.js';

// ---------------------------------------------------------------------------
// SVG geometry and entity markup, shared by the browser and the sheet exports.
// ---------------------------------------------------------------------------

export interface ViewTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export function toScreen(view: ViewTransform, world: Pt): Pt {
  return { x: world.x * view.zoom + view.panX, y: -world.y * view.zoom + view.panY };
}

export function toWorld(view: ViewTransform, screen: Pt): Pt {
  return { x: (screen.x - view.panX) / view.zoom, y: -(screen.y - view.panY) / view.zoom };
}

export interface EffectiveStyle {
  colour: string;
  linetype: string;
  lineweight: number;
}

export function effectiveStyle(
  entity: Entity | ResolvedEntity,
  layers: Record<string, LayerRecord>,
  insertStyle?: EffectiveStyle | null,
): EffectiveStyle {
  const layer = layers[entity.layer];
  const own = (entity as Entity & Partial<{ colour: string; linetype: string; lineweight: number }>);
  const colour = own.colour ?? 'ByLayer';
  const linetype = own.linetype ?? 'ByLayer';
  const lineweight = own.lineweight ?? 'ByLayer';
  return {
    colour: colour === 'ByLayer' ? (layer?.colour ?? 'white') : colour === 'ByBlock' ? (insertStyle?.colour ?? 'white') : colour,
    linetype: linetype === 'ByLayer' ? (layer?.linetype ?? 'Continuous') : linetype,
    lineweight: lineweight === 'ByLayer' ? (layer?.lineweight ?? 0.25) : (lineweight as number),
  };
}


export function colourHex(colour: string): string {
  return COLOUR_HEX[colour] ?? COLOUR_HEX.white;
}

export function dashArray(linetype: string): string | null {
  if (linetype === 'Dashed') return '6 4';
  if (linetype === 'Dotted') return '1 3';
  if (linetype === 'Centre') return '12 4 3 4';
  return null;
}

const attr = (name: string, value: string | number | boolean | null | undefined): string =>
  value === null || value === undefined || value === false ? '' : ` ${name}="${value === true ? '' : String(value)}"`;

const num = (v: number): string => numberKey(v);

export interface RenderOptions {
  layers: Record<string, LayerRecord>;
  blocks: Record<string, { name: string; base: Pt; entities: Entity[] }>;
  dimStyles: Record<string, DimStyleRecord>;
  view?: ViewTransform;
  transform?: string;
  withDataAttributes?: boolean;
  visibleLayer?: (layer: string) => boolean;
  idPrefix?: string;
  diffFor?: (handle: string) => string | null;
}

export function entityToElement(entity: ResolvedEntity, options: RenderOptions, insertStyle?: EffectiveStyle | null, depth = 0): string {
  if (depth > 8) return '';
  const style = effectiveStyle(entity, options.layers, insertStyle);
  const colour = colourHex(style.colour);
  const dash = dashArray(style.linetype);
  const diff = options.diffFor ? options.diffFor(entity.handle) : null;
  const data = options.withDataAttributes === false ? '' : entityDataAttributes(entity, style, diff ? { 'data-diff': diff } : undefined);
  const common = `${data}${attr('stroke', colour)}${attr('stroke-width', Math.max(0.5, style.lineweight))}${dash ? ` stroke-dasharray="${dash}"` : ''} fill="none"`;
  const t = options.transform ? ` transform="${options.transform}"` : '';
  switch (entity.type) {
    case 'line':
      return `<line${t}${attr('x1', num(entity.x1))}${attr('y1', num(-entity.y1))}${attr('x2', num(entity.x2))}${attr('y2', num(-entity.y2))}${common}/>`;
    case 'circle':
      return `<circle${t}${attr('cx', num(entity.cx))}${attr('cy', num(-entity.cy))}${attr('r', num(entity.r))}${common}/>`;
    case 'arc': {
      const start = (entity.start * Math.PI) / 180;
      const end = (entity.end * Math.PI) / 180;
      const x1 = entity.cx + entity.r * Math.cos(start);
      const y1 = -(entity.cy + entity.r * Math.sin(start));
      const x2 = entity.cx + entity.r * Math.cos(end);
      const y2 = -(entity.cy + entity.r * Math.sin(end));
      const large = entity.end - entity.start > 180 ? 1 : 0;
      return `<path${t}${attr('d', `M ${num(x1)} ${num(y1)} A ${num(entity.r)} ${num(entity.r)} 0 ${large} 1 ${num(x2)} ${num(y2)}`)}${common}/>`;
    }
    case 'pline': {
      if (!entity.points.length) return '';
      const pts = entity.points.map((p) => `${num(p.x)},${num(-p.y)}`).join(' ');
      return entity.closed
        ? `<polygon${t}${attr('points', pts)}${common}/>`
        : `<polyline${t}${attr('points', pts)}${common}/>`;
    }
    case 'hatch': {
      const polygon = entity.polygon ?? [];
      if (!polygon.length) return '';
      const points = polygon.map((p) => `${num(p.x)},${num(-p.y)}`).join(' ');
      return `<polygon${t}${attr('points', points)}${attr('stroke', colour)}${attr('stroke-width', Math.max(0.5, style.lineweight))} fill="${colour}" fill-opacity="0.25"${data}/>`;
    }
    case 'dimension':
      return dimensionElement(entity, dimensionText({ entities: {}, dim_styles: options.dimStyles } as never, entity), colour, t, data);
    case 'insert': {
      const block = options.blocks[entity.block];
      if (!block) return '';
      const rad = (entity.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const tx = entity.x - (cos * block.base.x - sin * block.base.y) * entity.scale;
      const ty = entity.y - (sin * block.base.x + cos * block.base.y) * entity.scale;
      const transform = `translate(${num(tx)} ${num(-ty)}) rotate(${num(-entity.rotation)}) scale(${num(entity.scale)})`;
      const inner = block.entities
        .map((child) => entityToElement(child as ResolvedEntity, { ...options, transform }, style, depth + 1))
        .join('');
      return `<g${t} transform="${transform}">${data ? `<g${data}></g>` : ''}${inner}</g>`;
    }
  }
}

function dimensionElement(
  entity: Extract<ResolvedEntity, { type: 'dimension' }>,
  text: string,
  colour: string,
  t: string,
  data: string,
): string {
  return `<g${t}${data}><line x1="${num(entity.text_x - 4)}" y1="${num(-entity.text_y)}" x2="${num(entity.text_x + 4)}" y2="${num(-entity.text_y)}" stroke="${colour}" stroke-width="0.3"/><text x="${num(entity.text_x)}" y="${num(-entity.text_y)}" fill="${colour}" font-size="2.5" text-anchor="middle">${escapeXml(text)}</text></g>`;
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function entityDataAttributes(entity: ResolvedEntity, style?: EffectiveStyle, extra?: Record<string, string | number | boolean>): string {
  const parts: string[] = [`data-entity-id="${entity.handle}"`, `data-type="${entity.type}"`, `data-layer="${escapeXml(entity.layer)}"`];
  switch (entity.type) {
    case 'line':
      parts.push(`data-x1="${num(entity.x1)}"`, `data-y1="${num(entity.y1)}"`, `data-x2="${num(entity.x2)}"`, `data-y2="${num(entity.y2)}"`);
      break;
    case 'circle':
      parts.push(`data-cx="${num(entity.cx)}"`, `data-cy="${num(entity.cy)}"`, `data-r="${num(entity.r)}"`);
      break;
    case 'arc':
      parts.push(`data-cx="${num(entity.cx)}"`, `data-cy="${num(entity.cy)}"`, `data-r="${num(entity.r)}"`, `data-start="${num(entity.start)}"`, `data-end="${num(entity.end)}"`);
      break;
    case 'pline':
      parts.push(`data-points="${entity.points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}"`, `data-closed="${entity.closed}"`);
      break;
    case 'insert':
      parts.push(`data-block="${escapeXml(entity.block)}"`, `data-x="${num(entity.x)}"`, `data-y="${num(entity.y)}"`, `data-scale="${num(entity.scale)}"`, `data-rotation="${num(entity.rotation)}"`);
      break;
    case 'hatch':
      parts.push(`data-area="${num(entity.area)}"`, `data-associative="${entity.associative}"`);
      break;
    case 'dimension':
      parts.push(`data-kind="${entity.kind}"`, `data-value="${entity.value}"`, `data-associative="${entity.associative}"`);
      break;
  }
  if (style) {
    parts.push(`data-colour="${style.colour}"`, `data-linetype="${style.linetype}"`, `data-lineweight="${num(style.lineweight)}"`);
  }
  for (const [key, value] of Object.entries(extra ?? {})) {
    parts.push(`${key}="${typeof value === 'string' ? escapeXml(value) : String(value)}"`);
  }
  return parts.map((p) => ` ${p}`).join('');
}

export interface SheetModel {
  layers: Record<string, LayerRecord>;
  entities: Record<string, ResolvedEntity>;
  order: string[];
  blocks: Record<string, { name: string; base: Pt; entities: Entity[] }>;
  dimStyles: Record<string, DimStyleRecord>;
}

export function sheetSvg(model: SheetModel, width: number, height: number): string {
  const body = model.order
    .map((handle) => model.entities[handle])
    .filter((entity): entity is ResolvedEntity => Boolean(entity))
    .filter((entity) => {
      const layer = model.layers[entity.layer];
      return layer && layer.on && !layer.frozen;
    })
    .map((entity) => entityToElement(entity, { layers: model.layers, blocks: model.blocks, dimStyles: model.dimStyles, transform: `translate(0 ${height}) scale(1 -1)` }))
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#16181b"/>${body}</svg>\n`;
}
