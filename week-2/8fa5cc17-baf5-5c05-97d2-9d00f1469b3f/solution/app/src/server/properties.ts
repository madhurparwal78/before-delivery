// Typed property validation (Business rules: "Object types and typed fields").
import type { Db } from './db.ts';
import type { FieldErrors, Json } from './errors.ts';
import type { FieldRow } from './model.ts';
import { isUuid } from './http.ts';
import { isRealDate } from '../shared/time.ts';

export const TEXT_PROPERTY_LIMIT = 2000;
const codePoints = (s: string): number => [...s].length;

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Checks `given` against the type's fields and returns the full property map to store.
 * On create every field is checked (missing required ones too); on update only the given ones.
 */
export async function checkProperties(
  q: Db,
  fields: FieldRow[],
  given: unknown,
  existing: Record<string, Json>,
  errors: FieldErrors,
  options: { creating: boolean; objectId: string | null },
): Promise<Record<string, Json>> {
  const input = given !== null && typeof given === 'object' && !Array.isArray(given) ? (given as Record<string, unknown>) : {};
  const out: Record<string, Json> = { ...existing };
  for (const name of Object.keys(input)) {
    if (!fields.some((f) => f.name === name)) errors.add(`properties.${name}`, 'That field is not on this type.');
  }
  for (const f of fields) {
    const key = `properties.${f.name}`;
    if (!(f.name in input)) {
      if (options.creating) {
        if (f.required) errors.add(key, 'This field is required.');
        out[f.name] = null;
      }
      continue;
    }
    const value = input[f.name];
    if (value === null || value === undefined) {
      if (f.required) errors.add(key, 'This field is required.');
      out[f.name] = null;
      continue;
    }
    switch (f.kind) {
      case 'text':
        if (typeof value !== 'string' || codePoints(value) > TEXT_PROPERTY_LIMIT) errors.add(key, 'Use at most 2,000 characters.');
        else out[f.name] = value;
        break;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) errors.add(key, 'Enter a number.');
        else out[f.name] = value;
        break;
      case 'date':
        if (!isRealDate(value)) errors.add(key, 'Use a real date as YYYY-MM-DD.');
        else out[f.name] = value;
        break;
      case 'url':
        if (typeof value !== 'string' || !isWebAddress(value)) errors.add(key, 'Use a web address starting with http or https.');
        else out[f.name] = value;
        break;
      case 'select':
        if (typeof value !== 'string' || !(f.options ?? []).includes(value)) errors.add(key, 'Choose one of the options.');
        else out[f.name] = value;
        break;
      case 'relation': {
        const target = await relationTarget(q, f, value);
        if (typeof value === 'string' && value === options.objectId) errors.add(key, "A note can't link to itself.");
        else if (!target) errors.add(key, `Choose a note of type ${await typeName(q, f.target_type_id)}.`);
        else out[f.name] = value as string;
        break;
      }
    }
  }
  return out;
}

async function relationTarget(q: Db, f: FieldRow, value: unknown): Promise<boolean> {
  if (!isUuid(value)) return false;
  const rows = await q.query('SELECT 1 FROM objects WHERE id = $1 AND type_id = $2', [value, f.target_type_id]);
  return rows.length > 0;
}

async function typeName(q: Db, id: string | null): Promise<string> {
  const rows = await q.query<{ name: string }>('SELECT name FROM object_types WHERE id = $1', [id]);
  return rows[0]?.name ?? '';
}
