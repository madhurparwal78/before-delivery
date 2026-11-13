import { fmtStored } from './numbers.js';
import type { DrawingModel, Entity } from './model.js';
import { effectiveAppearance, emptyModel, findStyle } from './model.js';
import { type Box, firstPointOf, modelBox } from './geometry.js';
import { arcPath, entityDataAttributes, strokeFor } from './render.js';
import { dimensionText } from './dimensions.js';
import { outlineOf } from './hatch.js';
import type { VersionSnapshot, ViewportSnapshot } from './snapshot.js';
import { SHEET_SIZES, titleBlockAttributes, worldToPaper, worldTextHeight, scaleDenominator } from './sheets.js';

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function attributesText(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([name, value]) => `${name}="${escapeText(value)}"`)
    .join(' ');
}

export interface EntityShape {
  tag: string;
  geometry: Record<string, string>;
}

/** The SVG shape for an entity in a Y-down view, in world units. */
export function entityShape(entity: Entity): EntityShape {
  switch (entity.type) {
    case 'line':
      return {
        tag: 'line',
        geometry: {
          x1: String(entity.x1),
          y1: String(-entity.y1),
          x2: String(entity.x2),
          y2: String(-entity.y2),
        },
      };
    case 'circle':
      return { tag: 'circle', geometry: { cx: String(entity.cx), cy: String(-entity.cy), r: String(entity.r) } };
    case 'arc':
      return { tag: 'path', geometry: { d: arcPath(entity.cx, entity.cy, entity.r, entity.start, entity.end) } };
    case 'pline':
      return {
        tag: entity.closed ? 'polygon' : 'polyline',
        geometry: { points: entity.points.map(([x, y]) => `${x},${-y}`).join(' ') },
      };
    case 'hatch':
      return { tag: 'polygon', geometry: { points: '' } };
    case 'dimension': {
      const points = entity.points.length >= 2 ? entity.points : [[entity.text_x, entity.text_y], [entity.text_x, entity.text_y]];
      return {
        tag: 'polyline',
        geometry: { points: points.map(([x, y]) => `${x},${-y}`).join(' ') },
      };
    }
    case 'insert':
      return { tag: 'g', geometry: {} };
  }
}

export interface SvgOptions {
  extra?: (entity: Entity, id: string) => Record<string, string>;
}

export function entitySvg(model: DrawingModel, entity: Entity, id = entity.handle, options: SvgOptions = {}): string {
  const shape = entityShape(entity);
  if (entity.type === 'hatch') shape.geometry.points = hatchPoints(model, entity);
  const appearance = effectiveAppearance(model, entity);
  const stroke = strokeFor(appearance);
  const attributes: Record<string, string> = {
    ...entityDataAttributes(model, entity, id),
    ...shape.geometry,
    fill: entity.type === 'pline' && entity.closed ? 'none' : entity.type === 'hatch' ? stroke.stroke : 'none',
    stroke: stroke.stroke,
    'stroke-width': String(Math.max(stroke.width, 0.1)),
    'vector-effect': 'non-scaling-stroke',
  };
  if (stroke.dash) attributes['stroke-dasharray'] = stroke.dash;
  const extra = options.extra?.(entity, id) ?? {};
  const merged = { ...attributes, ...extra };
  if (entity.type === 'dimension') {
    const text = escapeText(dimensionText(model, entity));
    const height = findStyle(model, entity.style).text_height_mm;
    return `<g ${attributesText(merged)}><text x="${entity.text_x}" y="${-entity.text_y}" font-size="${height}" data-dimension-text="${text}">${text}</text></g>`;
  }
  if (entity.type === 'insert') {
    return `<g ${attributesText(merged)}></g>`;
  }
  return `<${shape.tag} ${attributesText(merged)} />`;
}

export function svgViewBox(box: Box | null): string {
  if (!box) return '-10 -10 20 20';
  const width = Math.max(box.maxX - box.minX, 1);
  const height = Math.max(box.maxY - box.minY, 1);
  const pad = Math.max(width, height) * 0.08;
  return `${box.minX - pad} ${-box.maxY - pad} ${width + pad * 2} ${height + pad * 2}`;
}

/** The standalone SVG export: every entity as one element with the screen's data attributes. */
export function modelSvg(snapshot: VersionSnapshot | { model: DrawingModel }): string {
  const model = modelOf(snapshot);
  const entities: string[] = [];
  for (const entity of model.entities) entities.push(entitySvg(model, entity));
  if ('sheet' in snapshot) {
    for (const xref of snapshot.model.xrefs) {
      for (const entity of xref.entities) entities.push(entitySvg(model, entity, `${xref.name}|${entity.handle}`));
    }
  }
  const box = modelBox(model, model.entities);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svgViewBox(box)}" data-plotfold="model">`,
    `<g data-role="entities">${entities.join('')}</g>`,
    '</svg>',
    '',
  ].join('\n');
}

/** A full model for rendering, so a snapshot's four keys still carry the built-in styles. */
function modelOf(snapshot: VersionSnapshot | { model: DrawingModel }): DrawingModel {
  const model = emptyModel();
  Object.assign(model, snapshot.model);
  return model;
}

export function hatchPoints(model: DrawingModel, entity: Entity): string {
  if (entity.type !== 'hatch') return '';
  return outlineOf(model, entity.boundary)
    .map((point) => `${point.x},${-point.y}`)
    .join(' ');
}

function viewportEntitySvg(
  model: DrawingModel,
  viewport: ViewportSnapshot,
  entity: Entity,
  id: string,
): string {
  const first = firstPointOf(entity);
  const paper = worldToPaper(viewport, first.x, first.y);
  const scale = scaleDenominator(viewport.scale);
  const attributes = entityDataAttributes(model, entity, id);
  attributes['data-paper-x'] = fmtStored(paper.x);
  attributes['data-paper-y'] = fmtStored(paper.y);
  const appearance = effectiveAppearance(model, entity);
  const stroke = strokeFor(appearance);
  const shape = entityShape(entity);
  if (entity.type === 'hatch') shape.geometry.points = hatchPoints(model, entity);
  const body: Record<string, string> = {
    ...attributes,
    ...shape.geometry,
    fill: entity.type === 'hatch' ? stroke.stroke : 'none',
    stroke: stroke.stroke,
    'stroke-width': String(Math.max(stroke.width * scale, 0.1)),
  };
  if (stroke.dash) body['stroke-dasharray'] = stroke.dash;
  if (entity.type === 'dimension') {
    const style = findStyle(model, entity.style);
    const text = escapeText(dimensionText(model, entity));
    const world = worldTextHeight(style.text_height_mm, viewport.scale);
    return `<g ${attributesText(body)}><text x="${entity.text_x}" y="${-entity.text_y}" font-size="${world}" data-text-height-mm="${fmtStored(style.text_height_mm)}" data-world-text-height="${fmtStored(world)}">${text}</text></g>`;
  }
  if (entity.type === 'insert') return `<g ${attributesText(body)}></g>`;
  return `<${shape.tag} ${attributesText(body)} />`;
}

/** The sheet drawing: paper in millimetres with Y down, each viewport drawing its own copy. */
export function sheetSvg(snapshot: VersionSnapshot): string {
  const model = modelOf(snapshot);
  const xrefs = snapshot.model.xrefs;
  const sheet = snapshot.sheet;
  const paper = SHEET_SIZES[sheet.size];
  const attributes = titleBlockAttributes(sheet);
  const viewports = sheet.viewports.map((viewport) => {
    const scale = scaleDenominator(viewport.scale);
    const visible = model.entities.filter((entity) => {
      const layer = model.layers.find((candidate) => candidate.name === entity.layer);
      if (layer && (!layer.on || layer.frozen)) return false;
      return !viewport.frozen_layers.includes(entity.layer);
    });
    const xrefEntities: { id: string; entity: Entity }[] = [];
    for (const xref of xrefs) {
      for (const entity of xref.entities) xrefEntities.push({ id: `${xref.name}|${entity.handle}`, entity });
    }
    const centre = worldToPaper(viewport, viewport.view_x, viewport.view_y);
    const inner = [
      ...visible.map((entity) => viewportEntitySvg(model, viewport, entity, entity.handle)),
      ...xrefEntities.map((item) => viewportEntitySvg(model, viewport, item.entity, item.id)),
    ].join('');
    return [
      `<g data-viewport-id="${escapeText(viewport.id)}" data-scale="${escapeText(viewport.scale)}" data-view-x="${fmtStored(viewport.view_x)}" data-view-y="${fmtStored(viewport.view_y)}">`,
      `<rect x="${viewport.x}" y="${viewport.y}" width="${viewport.width}" height="${viewport.height}" fill="none" stroke="#5c6a5f" stroke-width="0.3" />`,
      `<clipPath id="clip-${escapeText(viewport.id)}"><rect x="${viewport.x}" y="${viewport.y}" width="${viewport.width}" height="${viewport.height}" /></clipPath>`,
      `<g clip-path="url(#clip-${escapeText(viewport.id)})" transform="translate(${centre.x} ${centre.y}) scale(${1 / scale})">${inner}</g>`,
      '</g>',
    ].join('');
  });
  const titleRows = Object.entries(attributes)
    .map(
      ([tag, value], index) =>
        `<text x="${paper.width - 78}" y="${paper.height - 34 + index * 5}" font-size="3" data-title-tag="${escapeText(tag)}" data-title-value="${escapeText(value)}">${escapeText(tag)}: ${escapeText(value)}</text>`,
    )
    .join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${paper.width} ${paper.height}" data-plotfold="sheet" data-sheet-size="${sheet.size}" data-sheet-number="${sheet.number}">`,
    `<rect x="0" y="0" width="${paper.width}" height="${paper.height}" fill="#15171a" stroke="#5c6a5f" stroke-width="0.4" />`,
    viewports.join(''),
    `<g data-title-block="${escapeText(sheet.size === 'A3' ? 'Title A3' : 'Title A4')}">`,
    `<rect x="${paper.width - 82}" y="${paper.height - 40}" width="78" height="36" fill="none" stroke="#5c6a5f" stroke-width="0.3" />`,
    titleRows,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

