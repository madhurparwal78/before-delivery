/** Request bodies are read through these guards; nothing is cast unchecked. */

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

export function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function asNumberTriple(value: unknown): [number, number, number] | null {
  const list = asArray(value);
  if (list === null || list.length !== 3) return null;
  const parsed = list.map((entry) => asNumber(entry));
  const [x, y, z] = parsed;
  if (x === null || x === undefined || y === null || y === undefined || z === null || z === undefined) return null;
  return [x, y, z];
}

export function asStringArray(value: unknown): string[] | null {
  const list = asArray(value);
  if (list === null) return null;
  const out: string[] = [];
  for (const entry of list) {
    const text = asString(entry);
    if (text === null) return null;
    out.push(text);
  }
  return out;
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right) return false;
  if (left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => deepEqual(entry, right[index]));
  }
  if (typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    if (!leftKeys.every((key, index) => key === rightKeys[index])) return false;
    return leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}
