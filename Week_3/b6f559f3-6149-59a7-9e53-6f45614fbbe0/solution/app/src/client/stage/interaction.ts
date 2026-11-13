/** Where a point on the stage lands: which layer a click selects, and which layers the pointer is over. */
import { covers } from '../../shared/evaluator/compositing';
import { stackOf } from '../../shared/evaluator/compositing';
import { bool } from '../../shared/evaluator/resolve';
import type { Assets } from '../../shared/evaluator/solids';
import { screenRect, type Prepared } from './display';

const FLAT = new Set(['Rectangle', 'Ellipse', 'Polygon', 'Text', 'Image', 'Gradient']);

/** Whether an artboard point is inside the rectangle spanned by a solid layer's projected bounding box. */
export function overSolid(prepared: Prepared, assets: Assets, layerId: string, x: number, y: number): boolean {
  const solid = prepared.solids.find((s) => s.rl.layer.id === layerId);
  if (!solid) return false;
  const rect = screenRect(solid, prepared, assets);
  return rect !== null && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** The topmost layer at an artboard point: solids first (they draw above), then the flat layers. */
export function layerAt(prepared: Prepared, assets: Assets, x: number, y: number): string | null {
  for (const solid of [...prepared.solids].reverse()) {
    if (overSolid(prepared, assets, solid.rl.layer.id, x, y)) return solid.rl.layer.id;
  }
  const walk = (parent: string | null): string | null => {
    for (const rl of [...stackOf(prepared.scenery.layers, parent)].reverse()) {
      if (!bool(rl.values, 'visible', true)) continue;
      if (rl.layer.kind === 'Group') {
        const inner = walk(rl.layer.id);
        if (inner) return inner;
      } else if (FLAT.has(rl.layer.kind) && !rl.layer.maskAbove && covers(rl, x, y)) return rl.layer.id;
    }
    return null;
  };
  return walk(null);
}
