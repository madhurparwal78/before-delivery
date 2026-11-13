import { fmtDisplay, fmtPoint } from './numbers.js';
import type { DrawingModel, Entity } from './model.js';
import { entityArea, entityLength } from './geometry.js';
import { dimensionValueText } from './dimensions.js';

/** The published entity-list row label for an entity. */
export function entityLabel(model: DrawingModel, entity: Entity, id = entity.handle): string {
  switch (entity.type) {
    case 'line':
      return `Line ${id}, layer ${entity.layer}, from ${fmtPoint(entity.x1, entity.y1)} to ${fmtPoint(entity.x2, entity.y2)}, length ${fmtDisplay(entityLength(entity) ?? 0)}`;
    case 'circle':
      return `Circle ${id}, layer ${entity.layer}, centre ${fmtPoint(entity.cx, entity.cy)}, radius ${fmtDisplay(entity.r)}, area ${fmtDisplay(entityArea(entity) ?? 0)}`;
    case 'arc':
      return `Arc ${id}, layer ${entity.layer}, centre ${fmtPoint(entity.cx, entity.cy)}, radius ${fmtDisplay(entity.r)}, from ${fmtDisplay(entity.start)} to ${fmtDisplay(entity.end)} degrees, length ${fmtDisplay(entityLength(entity) ?? 0)}`;
    case 'pline': {
      const length = entityLength(entity) ?? 0;
      if (!entity.closed) {
        return `Polyline ${id}, layer ${entity.layer}, ${entity.points.length} points, open, length ${fmtDisplay(length)}`;
      }
      return `Polyline ${id}, layer ${entity.layer}, ${entity.points.length} points, closed, length ${fmtDisplay(length)}, area ${fmtDisplay(entityArea(entity) ?? 0)}`;
    }
    case 'hatch':
      return `Hatch ${id}, layer ${entity.layer}, area ${fmtDisplay(entity.area)}`;
    case 'dimension':
      return `Dimension ${id}, layer ${entity.layer}, ${entity.kind}, value ${dimensionValueText(model, entity)}`;
    case 'insert':
      return `Block ${id}, layer ${entity.layer}, ${entity.block} at ${fmtPoint(entity.x, entity.y)}, scale ${fmtDisplay(entity.scale)}, rotation ${fmtDisplay(entity.rotation)}`;
  }
}

export const KIND_WORDS: Record<Entity['type'], string> = {
  line: 'Line',
  pline: 'Polyline',
  circle: 'Circle',
  arc: 'Arc',
  hatch: 'Hatch',
  dimension: 'Dimension',
  insert: 'Block',
};
