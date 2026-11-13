import { findLayerDefinition, type PropertyDef, type PropertySource } from './properties';
import type { Json, VariableType, VariableValue, Vec2, Vec3 } from './types';
import { SOLID_KINDS } from './types';

const AXES_3 = ['x', 'y', 'z'] as const;
const GROUPS_3 = ['position', 'rotation', 'scale'] as const;

/** The property paths a binding writes, or an error text when the variable type cannot bind there. */
export function bindingPaths(layer: PropertySource, property: string, type: VariableType): string[] | string {
  if (type === 'Vector 3') {
    if ((GROUPS_3 as readonly string[]).includes(property) && SOLID_KINDS.includes(layer.kind))
      return AXES_3.map((axis) => `${property}.${axis}`);
    return incompatible(type, property);
  }
  if (type === 'Vector 2') {
    return property === 'position' && !SOLID_KINDS.includes(layer.kind) && layer.kind !== 'Group' && layer.kind !== 'Effect'
      ? ['x', 'y']
      : incompatible(type, property);
  }
  const def = findLayerDefinition(layer, property);
  if (!def) return incompatible(type, property);
  const accepts: Record<string, VariableType | undefined> = {
    spin: 'Number',
    switch: 'Boolean',
    text: 'Text',
    colour: 'Colour',
  };
  if (accepts[def.control] !== type || def.path === 'name' || def.path.startsWith('events.') || def.path === 'locked' || def.path === 'maskAbove')
    return incompatible(type, def.label);
  return [def.path];
}

function incompatible(type: VariableType, field: string): string {
  return `${type} variables can't bind to ${field}.`;
}

/** The value a variable gives one bound path, together with the range end it was clamped to. */
export function boundValue(
  def: PropertyDef | undefined,
  type: VariableType,
  value: VariableValue,
  path: string,
): { value: Json; limit: number | null } {
  if (type === 'Number' && typeof value === 'number') {
    const min = def?.min ?? -Infinity;
    const max = def?.max ?? Infinity;
    if (value > max) return { value: max, limit: max };
    if (value < min) return { value: min, limit: min };
    return { value, limit: null };
  }
  if (type === 'Vector 3' || type === 'Vector 2') {
    const axis = path.split('.').pop() as keyof Vec3;
    const raw = (value as Vec3 | Vec2)[axis as keyof (Vec3 | Vec2)] ?? 0;
    const min = def?.min ?? -Infinity;
    const max = def?.max ?? Infinity;
    if (raw > max) return { value: max, limit: max };
    if (raw < min) return { value: min, limit: min };
    return { value: raw, limit: null };
  }
  return { value: value as Json, limit: null };
}
