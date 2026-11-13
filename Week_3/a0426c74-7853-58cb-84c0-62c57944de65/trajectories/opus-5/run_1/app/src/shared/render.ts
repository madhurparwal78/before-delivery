import { fmtPrecision, fmtStored } from './numbers.js';
import type { Appearance, DrawingModel, Entity } from './model.js';
import { effectiveAppearance, findStyle } from './model.js';
import { arcSweep, pointAt, vec } from './geometry.js';
import { dimensionText } from './dimensions.js';

export const COLOUR_INK: Record<string, string> = {
  white: '#f2efe6',
  red: '#e2806f',
  yellow: '#ddc274',
  green: '#9db98a',
  cyan: '#86b8bb',
  blue: '#8aa3cb',
  magenta: '#c391bd',
  grey: '#9aa49b',
};

export const LINETYPE_DASHES: Record<string, string> = {
  Continuous: '',
  Dashed: '6 4',
  Dotted: '1 3',
  Centre: '10 3 2 3',
};

export function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const from = pointAt(vec(cx, cy), r, start);
  const to = pointAt(vec(cx, cy), r, end);
  const sweep = arcSweep(start, end);
  const large = sweep > 180 ? 1 : 0;
  return `M ${from.x} ${-from.y} A ${r} ${r} 0 ${large} 0 ${to.x} ${-to.y}`;
}

/** The data attributes every entity element carries, on screen and in the SVG export. */
export function entityDataAttributes(model: DrawingModel, entity: Entity, id = entity.handle, blockAppearance?: Appearance): Record<string, string> {
  const appearance = effectiveAppearance(model, entity, blockAppearance);
  const attributes: Record<string, string> = {
    'data-entity-id': id,
    'data-type': entity.type,
    'data-layer': entity.layer,
    'data-colour': appearance.colour,
    'data-linetype': appearance.linetype,
    'data-lineweight': appearance.lineweight,
  };
  switch (entity.type) {
    case 'line':
      attributes['data-x1'] = fmtStored(entity.x1);
      attributes['data-y1'] = fmtStored(entity.y1);
      attributes['data-x2'] = fmtStored(entity.x2);
      attributes['data-y2'] = fmtStored(entity.y2);
      break;
    case 'circle':
      attributes['data-cx'] = fmtStored(entity.cx);
      attributes['data-cy'] = fmtStored(entity.cy);
      attributes['data-r'] = fmtStored(entity.r);
      break;
    case 'arc':
      attributes['data-cx'] = fmtStored(entity.cx);
      attributes['data-cy'] = fmtStored(entity.cy);
      attributes['data-r'] = fmtStored(entity.r);
      attributes['data-start'] = fmtStored(entity.start);
      attributes['data-end'] = fmtStored(entity.end);
      break;
    case 'pline':
      attributes['data-points'] = entity.points.map(([x, y]) => `${fmtStored(x)},${fmtStored(y)}`).join(' ');
      attributes['data-closed'] = entity.closed ? 'true' : 'false';
      break;
    case 'insert':
      attributes['data-block'] = entity.block;
      attributes['data-x'] = fmtStored(entity.x);
      attributes['data-y'] = fmtStored(entity.y);
      attributes['data-scale'] = fmtStored(entity.scale);
      attributes['data-rotation'] = fmtStored(entity.rotation);
      break;
    case 'hatch':
      attributes['data-area'] = fmtStored(entity.area);
      attributes['data-associative'] = entity.associative ? 'true' : 'false';
      break;
    case 'dimension':
      attributes['data-kind'] = entity.kind;
      attributes['data-value'] = fmtPrecision(entity.value, findStyle(model, entity.style).precision);
      attributes['data-associative'] = entity.associative ? 'true' : 'false';
      break;
  }
  return attributes;
}

export function dimensionLabel(model: DrawingModel, entity: Entity): string {
  if (entity.type !== 'dimension') return '';
  return dimensionText(model, entity);
}

export function strokeFor(appearance: Appearance): { stroke: string; dash: string; width: number } {
  return {
    stroke: COLOUR_INK[appearance.colour] ?? COLOUR_INK.white,
    dash: LINETYPE_DASHES[appearance.linetype] ?? '',
    width: Number(appearance.lineweight),
  };
}
