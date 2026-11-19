import { invalidProjection } from './errors';
import { valuesAtPath } from './paths';
import { DocObject, DocValue, isPlainObject } from './values';

interface PathNode {
  leaf: boolean;
  children: Map<string, PathNode>;
}

export interface Projection {
  kind: 'identity' | 'include' | 'exclude';
  tree: PathNode;
  includeId: boolean;
  computed: Array<{ name: string; path: string }>;
}

function emptyNode(): PathNode {
  return { leaf: false, children: new Map() };
}

function addPath(root: PathNode, path: string): void {
  const segments = path.split('.');
  let node = root;
  for (const segment of segments) {
    let next = node.children.get(segment);
    if (!next) {
      next = emptyNode();
      node.children.set(segment, next);
    }
    node = next;
  }
  node.leaf = true;
  node.children.clear();
}

/** Checks a projection, throwing `invalid_projection`. `$path` copies are for `$project` only. */
export function validateProjection(projection: DocValue, allowComputed = false): Projection {
  const tree = emptyNode();
  const computed: Array<{ name: string; path: string }> = [];
  if (projection === null) return { kind: 'identity', tree, includeId: true, computed };
  if (!isPlainObject(projection)) throw invalidProjection();
  let including = false;
  let excluding = false;
  let includeId = true;
  for (const key of Object.keys(projection)) {
    const value = projection[key];
    if (value === 1 || value === true) {
      including = true;
      addPath(tree, key);
    } else if (value === 0 || value === false) {
      if (key === '_id') {
        includeId = false;
      } else {
        excluding = true;
        addPath(tree, key);
      }
    } else if (allowComputed && typeof value === 'string' && value.startsWith('$') && value.length > 1) {
      including = true;
      computed.push({ name: key, path: value.slice(1) });
    } else {
      throw invalidProjection();
    }
  }
  if (including && excluding) throw invalidProjection();
  if (including) return { kind: 'include', tree, includeId, computed };
  if (excluding) return { kind: 'exclude', tree, includeId, computed };
  return { kind: 'identity', tree, includeId, computed };
}

function includeValue(value: DocValue, node: PathNode): DocValue | undefined {
  if (node.leaf) return value;
  if (Array.isArray(value)) {
    const items: DocValue[] = [];
    for (const element of value) {
      if (isPlainObject(element)) {
        const projected = includeObject(element, node);
        items.push(projected);
      }
    }
    return items;
  }
  if (isPlainObject(value)) return includeObject(value, node);
  return undefined;
}

function includeObject(source: DocObject, node: PathNode): DocObject {
  const out: DocObject = {};
  for (const key of Object.keys(source)) {
    const child = node.children.get(key);
    if (!child) continue;
    const projected = includeValue(source[key], child);
    if (projected !== undefined) out[key] = projected;
  }
  return out;
}

function excludeValue(value: DocValue, node: PathNode): DocValue {
  if (Array.isArray(value)) {
    return value.map((element) => (isPlainObject(element) ? excludeObject(element, node) : element));
  }
  if (isPlainObject(value)) return excludeObject(value, node);
  return value;
}

function excludeObject(source: DocObject, node: PathNode): DocObject {
  const out: DocObject = {};
  for (const key of Object.keys(source)) {
    const child = node.children.get(key);
    if (child?.leaf) continue;
    out[key] = child ? excludeValue(source[key], child) : source[key];
  }
  return out;
}

function computedValue(doc: DocObject, path: string): DocValue | undefined {
  const values = valuesAtPath(doc, path);
  if (values.length === 0) return undefined;
  if (values.length === 1) return values[0];
  return values;
}

/** Applies a checked projection to one document. */
export function applyProjection(doc: DocObject, projection: Projection): DocObject {
  if (projection.kind === 'identity') {
    if (projection.includeId) return doc;
    const out: DocObject = {};
    for (const key of Object.keys(doc)) {
      if (key !== '_id') out[key] = doc[key];
    }
    return out;
  }
  if (projection.kind === 'exclude') {
    const out = excludeObject(doc, projection.tree);
    if (!projection.includeId) delete out['_id'];
    return out;
  }
  const out: DocObject = {};
  if (projection.includeId && Object.prototype.hasOwnProperty.call(doc, '_id')) out['_id'] = doc['_id'];
  for (const key of Object.keys(doc)) {
    if (key === '_id') continue;
    const child = projection.tree.children.get(key);
    if (!child) continue;
    const value = includeValue(doc[key], child);
    if (value !== undefined) out[key] = value;
  }
  for (const entry of projection.computed) {
    const value = computedValue(doc, entry.path);
    if (value !== undefined) out[entry.name] = value;
  }
  return out;
}
