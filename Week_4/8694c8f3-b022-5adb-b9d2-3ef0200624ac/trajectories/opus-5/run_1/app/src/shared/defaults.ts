import { BUS_KINDS, MATERIAL_KINDS, type LayerKind, type OutputBus } from './domain.js';
import type { MaterialDoc } from './types.js';

/** Layer kind defaults, decided in one place for the server and the browser. */

export function defaultProps(kind: LayerKind): Record<string, number> {
  switch (kind) {
    case 'tube':
      return { twist: 0, radius: 1 };
    case 'camera':
      return { fov: 50, near: 0.1, far: 200 };
    case 'light':
      return { intensity: 1 };
    default:
      return {};
  }
}

export function defaultMaterial(kind: LayerKind): MaterialDoc | null {
  if (!MATERIAL_KINDS.includes(kind)) return null;
  return { tint: [1, 1, 1], tint_alpha: 1, albedo_texture_id: null, emissive_texture_id: null };
}

export function defaultBuses(kind: LayerKind): OutputBus[] {
  return BUS_KINDS.includes(kind) ? ['main'] : [];
}
