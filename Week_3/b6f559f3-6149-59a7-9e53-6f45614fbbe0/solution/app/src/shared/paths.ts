import type { Json, JsonObject } from './types';

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getPath(root: JsonObject, path: string): Json | undefined {
  let node: Json | undefined = root;
  for (const part of path.split('.')) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Sets `path` on `root` (mutating), creating the objects on the way. */
export function setPath(root: JsonObject, path: string, value: Json): void {
  const parts = path.split('.');
  let node = root;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (isObject(next)) {
      node = next;
    } else {
      const created: JsonObject = {};
      node[part] = created;
      node = created;
    }
  }
  node[parts[parts.length - 1] as string] = value;
}

export function clone<T extends Json | object>(value: T): T {
  return structuredClone(value);
}

/** Flattens nested objects into dotted paths; arrays and scalars are leaves. */
export function flatten(root: JsonObject, prefix = ''): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value) && Object.keys(value).length > 0) Object.assign(out, flatten(value, path));
    else out[path] = value;
  }
  return out;
}
