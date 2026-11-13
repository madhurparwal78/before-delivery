export type FieldType = 'number' | 'date' | 'boolean' | 'text' | 'keyword';

export type FieldValue = string | number | boolean | (string | number | boolean)[];

export type EventFields = Record<string, FieldValue>;

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?(Z|z|[+-]\d{2}:?\d{2})$/;

export function isIsoDateString(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE.test(value) && Number.isFinite(Date.parse(value));
}

/** Rule A: a new field's type is inferred from its first value in the generation. */
export function inferType(value: unknown): FieldType {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number') return 'number';
  if (isIsoDateString(first)) return 'date';
  if (typeof first === 'boolean') return 'boolean';
  return 'text';
}

export function typeOfValue(value: unknown): FieldType {
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'number') return 'number';
  if (isIsoDateString(first)) return 'date';
  if (typeof first === 'boolean') return 'boolean';
  return 'text';
}

export function valueFits(value: unknown, type: FieldType): boolean {
  const values = Array.isArray(value) ? value : [value];
  return values.every((item) => {
    switch (type) {
      case 'text':
      case 'keyword':
        return typeof item === 'string';
      case 'date':
        return isIsoDateString(item);
      case 'number':
        return typeof item === 'number';
      case 'boolean':
        return typeof item === 'boolean';
      default:
        return false;
    }
  });
}

export function arrayMixesTypes(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  const kind = (item: unknown): string =>
    typeof item === 'number' ? 'number' : typeof item === 'boolean' ? 'boolean' : 'string';
  const first = kind(value[0]);
  return value.some((item) => kind(item) !== first);
}

/** Nested objects flatten into dotted paths; arrays stay multi-value. */
export function flattenEvent(raw: Record<string, unknown>): EventFields {
  const out: EventFields = {};
  const push = (path: string, value: string | number | boolean): void => {
    const existing = out[path];
    if (existing === undefined) {
      out[path] = value;
      return;
    }
    if (Array.isArray(existing)) existing.push(value);
    else out[path] = [existing, value];
  };
  const walk = (path: string, value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(path, item);
      return;
    }
    if (typeof value === 'object') {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(path === '' ? key : `${path}.${key}`, nested);
      }
      return;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      push(path, value);
    }
  };
  for (const [key, value] of Object.entries(raw)) {
    if (key === '_id') continue;
    walk(key, value);
  }
  return out;
}

export function conflictSentence(
  field: string,
  typeA: FieldType,
  generationA: number,
  typeB: FieldType,
  generationB: number,
): string {
  return `Field ${field} is ${typeA} in generation ${generationA} and ${typeB} in generation ${generationB}. It can't be sorted or counted.`;
}

export type GenerationMapping = { generation: number; types: Map<string, FieldType> };

export type ResolvedField = { field: string; type: FieldType; conflict?: string };

/** One place where the field list of a set of generations, with conflicts, is decided. */
export function resolveFields(mappings: GenerationMapping[]): ResolvedField[] {
  const ordered = [...mappings].sort((left, right) => left.generation - right.generation);
  const fields = new Map<string, { type: FieldType; generation: number; conflict?: string }>();
  for (const mapping of ordered) {
    for (const [field, type] of mapping.types) {
      const seen = fields.get(field);
      if (!seen) {
        fields.set(field, { type, generation: mapping.generation });
        continue;
      }
      if (seen.type !== type && !seen.conflict) {
        seen.conflict = conflictSentence(field, seen.type, seen.generation, type, mapping.generation);
      }
    }
  }
  return [...fields.entries()]
    .map(([field, entry]) => {
      const resolved: ResolvedField = { field, type: entry.type };
      if (entry.conflict) resolved.conflict = entry.conflict;
      return resolved;
    })
    .sort((left, right) => (left.field < right.field ? -1 : left.field > right.field ? 1 : 0));
}

export function valuesOf(value: FieldValue | undefined): (string | number | boolean)[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

export function numericOf(value: string | number | boolean, type: FieldType): number | null {
  if (type === 'date') {
    if (typeof value === 'string' && isIsoDateString(value)) return Date.parse(value);
    return null;
  }
  return typeof value === 'number' ? value : null;
}
