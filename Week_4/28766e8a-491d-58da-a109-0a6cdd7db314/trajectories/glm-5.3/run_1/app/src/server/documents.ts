import type { Document, Page, Shape, Connector, Layer, Group } from '../shared/model.js';
import { LIMITS, type DocumentOp, type Role } from '../shared/model.js';
import { makeId, hasControlChars, isWholeNumber, type IdPrefix } from '../shared/ids.js';
import { routePage, connectorShown, type RouteResult } from '../shared/router.js';

export interface StoredDoc {
  doc: Document;
}

export function newDocument(id: string, title: string): Document {
  const pageId = makeId('p', Math.random);
  const layerId = makeId('l', Math.random);
  const page: Page = {
    id: pageId,
    name: 'Page 1',
    order: 0,
    layers: [{ id: layerId, name: 'Layer 1', order: 0, visible: true, locked: false }],
    shapes: [],
    connectors: [],
    groups: [],
  };
  return { id, title, seq: 0, pages: [page] };
}

export interface ApplyOutcome {
  doc: Document;
  ids: Record<string, string>;
  rerouted: string[];
  blocked: Set<string>;
}

/** Recompute the routes of every page in the document that has connectors. */
export function rerouteDocument(doc: Document): Set<string> {
  const blocked = new Set<string>();
  for (const page of doc.pages) {
    const { routes, shown } = routePage(page);
    for (const connector of page.connectors) {
      if (!shown.has(connector.id)) continue;
      const result = routes.get(connector.id);
      if (!result) continue;
      connector.route = result.route;
      if (result.blocked) blocked.add(connector.id);
    }
  }
  return blocked;
}

export function reroutePage(page: Page): { changed: string[]; blocked: Set<string> } {
  const before = new Map(page.connectors.map((c) => [c.id, c.route]));
  const { routes, shown } = routePage(page);
  const changed: string[] = [];
  const blocked = new Set<string>();
  for (const connector of page.connectors) {
    if (!shown.has(connector.id)) continue;
    const result = routes.get(connector.id);
    if (!result) continue;
    const prev = before.get(connector.id);
    if (!routeEquals(prev, result.route)) changed.push(connector.id);
    connector.route = result.route;
    if (result.blocked) blocked.add(connector.id);
  }
  return { changed, blocked };
}

function routeEquals(a: [number, number][] | undefined, b: [number, number][] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]![0] !== b[i]![0] || a[i]![1] !== b[i]![1]) return false;
  }
  return true;
}

export interface OpContext {
  userId: string;
  role: Role;
  now: Date;
}

/** Apply an operation, returning the new document (mutated in place) and ack data. */
export function applyOperation(
  doc: Document,
  op: DocumentOp,
  ctx: OpContext,
  makeIdFn: (prefix: IdPrefix) => string,
): { ids: Record<string, string>; rerouted: string[] } | { error: 'shape_deleted' | 'connector_deleted' | 'layer_locked' } {
  const ids: Record<string, string> = {};
  const touchedPages = new Set<Page>();

  const findShape = (id: string): { page: Page; shape: Shape } | null => {
    for (const page of doc.pages) {
      const shape = page.shapes.find((s) => s.id === id);
      if (shape) return { page, shape };
    }
    return null;
  };
  const findConnector = (id: string): { page: Page; connector: Connector } | null => {
    for (const page of doc.pages) {
      const connector = page.connectors.find((c) => c.id === id);
      if (connector) return { page, connector };
    }
    return null;
  };
  const layerLocked = (page: Page, layerId: string): boolean => {
    const layer = page.layers.find((l) => l.id === layerId);
    return layer !== undefined && layer.locked;
  };

  switch (op.kind) {
    case 'add_shape': {
      const page = doc.pages.find((p) => p.id === op.page);
      if (!page) return { error: 'shape_deleted' };
      if (layerLocked(page, op.layer)) return { error: 'layer_locked' };
      if (page.shapes.length >= LIMITS.shapesPerPage) return { error: 'layer_locked' };
      const id = makeIdFn('s');
      const maxZ = page.shapes.reduce((m, s) => Math.max(m, s.z), 0);
      page.shapes.push({
        id, kind: op.shape.kind, layer: op.layer,
        x: op.shape.x, y: op.shape.y, w: op.shape.w, h: op.shape.h,
        label: op.shape.label, z: maxZ + 1, group: null,
      });
      ids[op.clientRef] = id;
      touchedPages.add(page);
      break;
    }
    case 'update_shape': {
      const found = findShape(op.shape);
      if (!found) return { error: 'shape_deleted' };
      const { page, shape } = found;
      if (layerLocked(page, shape.layer)) return { error: 'layer_locked' };
      const setLayer = 'layer' in op.set && typeof op.set['layer'] === 'string'
        ? op.set['layer'] as string : null;
      if (setLayer !== null) {
        const layer = page.layers.find((l) => l.id === setLayer);
        if (!layer) return { error: 'layer_locked' };
        if (layer.locked) return { error: 'layer_locked' };
        // Changing a shape's layer moves its whole group with it.
        if (shape.group) {
          const group = page.groups.find((g) => g.id === shape.group);
          for (const memberId of group?.members ?? []) {
            const member = page.shapes.find((s) => s.id === memberId);
            if (member) member.layer = setLayer;
          }
        } else {
          shape.layer = setLayer;
        }
      }
      applySet(shape, op.set);
      touchedPages.add(page);
      break;
    }
    case 'update_shapes': {
      const seen = new Set<string>();
      for (const entry of op.shapes) {
        if (seen.has(entry.shape)) return { error: 'shape_deleted' };
        seen.add(entry.shape);
        const found = findShape(entry.shape);
        if (!found) return { error: 'shape_deleted' };
        const { page, shape } = found;
        if (layerLocked(page, shape.layer)) return { error: 'layer_locked' };
        const setLayer = 'layer' in entry.set && typeof entry.set['layer'] === 'string'
          ? entry.set['layer'] as string : null;
        if (setLayer !== null) {
          const layer = page.layers.find((l) => l.id === setLayer);
          if (!layer || layer.locked) return { error: 'layer_locked' };
        }
      }
      for (const entry of op.shapes) {
        const found = findShape(entry.shape);
        if (!found) return { error: 'shape_deleted' };
        const { page, shape } = found;
        const setLayer = 'layer' in entry.set && typeof entry.set['layer'] === 'string'
          ? entry.set['layer'] as string : null;
        if (setLayer !== null) {
          if (shape.group) {
            const group = page.groups.find((g) => g.id === shape.group);
            for (const memberId of group?.members ?? []) {
              const member = page.shapes.find((s) => s.id === memberId);
              if (member) member.layer = setLayer;
            }
          } else {
            shape.layer = setLayer;
          }
        }
        applySet(shape, entry.set);
        touchedPages.add(page);
      }
      break;
    }
    case 'delete_shape': {
      const found = findShape(op.shape);
      if (!found) return { error: 'shape_deleted' };
      const { page, shape } = found;
      if (layerLocked(page, shape.layer)) return { error: 'layer_locked' };
      page.shapes = page.shapes.filter((s) => s.id !== shape.id);
      const bound = page.connectors.filter(
        (c) => c.from.shape === shape.id || c.to.shape === shape.id);
      page.connectors = page.connectors.filter((c) => c.from.shape !== shape.id && c.to.shape !== shape.id);
      if (shape.group) {
        const group = page.groups.find((g) => g.id === shape.group);
        if (group) {
          group.members = group.members.filter((m) => m !== shape.id);
          if (group.members.length < 2) {
            page.groups = page.groups.filter((g) => g.id !== group.id);
            for (const member of group.members) {
              const s = page.shapes.find((x) => x.id === member);
              if (s) s.group = null;
            }
          }
        }
      }
      void bound;
      touchedPages.add(page);
      break;
    }
    case 'add_connector': {
      const page = doc.pages.find((p) => p.id === op.page);
      if (!page) return { error: 'shape_deleted' };
      const from = page.shapes.find((s) => s.id === op.from.shape);
      const to = page.shapes.find((s) => s.id === op.to.shape);
      if (!from || !to) return { error: 'shape_deleted' };
      if (layerLocked(page, from.layer) || layerLocked(page, to.layer)) return { error: 'layer_locked' };
      if (page.connectors.length >= LIMITS.connectorsPerPage) return { error: 'layer_locked' };
      const id = makeIdFn('c');
      page.connectors.push({
        id,
        layer: from.layer,
        from: { shape: from.id, port: op.from.port },
        to: { shape: to.id, port: op.to.port },
        label: op.label,
        route: [],
      });
      ids[op.clientRef] = id;
      touchedPages.add(page);
      break;
    }
    case 'delete_connector': {
      const found = findConnector(op.connector);
      if (!found) return { error: 'connector_deleted' };
      const { page, connector } = found;
      if (layerLocked(page, connector.layer)) return { error: 'layer_locked' };
      const from = page.shapes.find((s) => s.id === connector.from.shape);
      const to = page.shapes.find((s) => s.id === connector.to.shape);
      if (from && layerLocked(page, from.layer)) return { error: 'layer_locked' };
      if (to && layerLocked(page, to.layer)) return { error: 'layer_locked' };
      page.connectors = page.connectors.filter((c) => c.id !== connector.id);
      touchedPages.add(page);
      break;
    }
  }

  const rerouted: string[] = [];
  for (const page of touchedPages) {
    const { changed } = reroutePage(page);
    rerouted.push(...changed);
  }
  return { ids, rerouted: [...new Set(rerouted)].sort() };
}

function applySet(shape: Shape, set: Partial<Record<string, unknown>>): void {
  if ('x' in set) shape.x = set['x'] as number;
  if ('y' in set) shape.y = set['y'] as number;
  if ('w' in set) shape.w = set['w'] as number;
  if ('h' in set) shape.h = set['h'] as number;
  if ('label' in set) shape.label = set['label'] as string;
  if ('layer' in set) shape.layer = set['layer'] as string;
}

export function validateOperation(op: DocumentOp): Record<string, string> | null {
  const errors: Record<string, string> = {};
  const coordinateOk = (value: unknown): boolean => isWholeNumber(value, -LIMITS.coordinate, LIMITS.coordinate);
  const sizeOk = (value: unknown): boolean => isWholeNumber(value, LIMITS.minSize, LIMITS.maxSize);
  switch (op.kind) {
    case 'add_shape': {
      const s = op.shape;
      if (!coordinateOk(s.x)) errors['op.shape.x'] = 'Invalid x.';
      if (!coordinateOk(s.y)) errors['op.shape.y'] = 'Invalid y.';
      if (!sizeOk(s.w)) errors['op.shape.w'] = 'Invalid width.';
      if (!sizeOk(s.h)) errors['op.shape.h'] = 'Invalid height.';
      if (typeof s.label !== 'string' || s.label.length > LIMITS.labelLength) errors['op.shape.label'] = 'Invalid label.';
      if (s.kind !== 'rectangle' && s.kind !== 'ellipse' && s.kind !== 'diamond' && s.kind !== 'text') {
        errors['op.shape.kind'] = 'Invalid kind.';
      }
      break;
    }
    case 'update_shape': {
      const set = op.set;
      if ('x' in set && !coordinateOk(set['x'])) errors['op.set.x'] = 'Invalid x.';
      if ('y' in set && !coordinateOk(set['y'])) errors['op.set.y'] = 'Invalid y.';
      if ('w' in set && !sizeOk(set['w'])) errors['op.set.w'] = 'Invalid width.';
      if ('h' in set && !sizeOk(set['h'])) errors['op.set.h'] = 'Invalid height.';
      if ('label' in set && (typeof set['label'] !== 'string' || (set['label'] as string).length > LIMITS.labelLength)) {
        errors['op.set.label'] = 'Invalid label.';
      }
      break;
    }
    case 'update_shapes': {
      if (op.shapes.length < 1 || op.shapes.length > LIMITS.updateShapesEntries) {
        errors['op.shapes'] = 'Invalid shapes list.';
      }
      op.shapes.forEach((entry, i) => {
        const set = entry.set;
        if ('x' in set && !coordinateOk(set['x'])) errors[`op.shapes.${i}.set.x`] = 'Invalid x.';
        if ('y' in set && !coordinateOk(set['y'])) errors[`op.shapes.${i}.set.y`] = 'Invalid y.';
        if ('w' in set && !sizeOk(set['w'])) errors[`op.shapes.${i}.set.w`] = 'Invalid width.';
        if ('h' in set && !sizeOk(set['h'])) errors[`op.shapes.${i}.set.h`] = 'Invalid height.';
        if ('label' in set && (typeof set['label'] !== 'string' || (set['label'] as string).length > LIMITS.labelLength)) {
          errors[`op.shapes.${i}.set.label`] = 'Invalid label.';
        }
      });
      break;
    }
    case 'add_connector': {
      if (typeof op.label !== 'string' || op.label.length > LIMITS.labelLength) {
        errors['op.label'] = 'Invalid label.';
      }
      if (op.from.port !== 'n' && op.from.port !== 'e' && op.from.port !== 's' && op.from.port !== 'w') {
        errors['op.from.port'] = 'Invalid port.';
      }
      if (op.to.port !== 'n' && op.to.port !== 'e' && op.to.port !== 's' && op.to.port !== 'w') {
        errors['op.to.port'] = 'Invalid port.';
      }
      break;
    }
    default:
      break;
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/** The published keys rule: only listed keys are accepted, others answer 422. */
export function validatePublishedKeys(op: unknown): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (typeof op !== 'object' || op === null) return { op: 'Invalid operation.' };
  const kind = (op as Record<string, unknown>)['kind'];
  const allowedByKind: Record<string, string[]> = {
    add_shape: ['kind', 'page', 'layer', 'shape', 'clientRef'],
    update_shape: ['kind', 'shape', 'set'],
    update_shapes: ['kind', 'shapes'],
    delete_shape: ['kind', 'shape'],
    add_connector: ['kind', 'page', 'from', 'to', 'label', 'clientRef'],
    delete_connector: ['kind', 'connector'],
  };
  const allowed = allowedByKind[kind as string];
  if (!allowed) return { op: 'Invalid operation.' };
  for (const key of Object.keys(op as Record<string, unknown>)) {
    if (!allowed.includes(key)) errors[`op.${key}`] = 'Unexpected key.';
  }
  const shapeKeys = ['kind', 'x', 'y', 'w', 'h', 'label'];
  const setKeys = ['x', 'y', 'w', 'h', 'label', 'layer'];
  const rec = op as Record<string, unknown>;
  if (kind === 'add_shape') {
    for (const key of Object.keys(rec['shape'] as object)) {
      if (!shapeKeys.includes(key)) errors[`op.shape.${key}`] = 'Unexpected key.';
    }
  }
  if (kind === 'update_shape') {
    for (const key of Object.keys(rec['set'] as object)) {
      if (!setKeys.includes(key)) errors[`op.set.${key}`] = 'Unexpected key.';
    }
  }
  if (kind === 'update_shapes') {
    const shapes = rec['shapes'];
    if (!Array.isArray(shapes)) return { 'op.shapes': 'Invalid shapes list.' };
    shapes.forEach((entry, i) => {
      if (typeof entry !== 'object' || entry === null) {
        errors[`op.shapes.${i}`] = 'Invalid entry.';
        return;
      }
      for (const key of Object.keys(entry)) {
        if (key !== 'shape' && key !== 'set') errors[`op.shapes.${i}.${key}`] = 'Unexpected key.';
      }
      const set = (entry as Record<string, unknown>)['set'];
      if (typeof set === 'object' && set !== null) {
        for (const key of Object.keys(set)) {
          if (!setKeys.includes(key)) errors[`op.shapes.${i}.set.${key}`] = 'Unexpected key.';
        }
      }
    });
  }
  if (kind === 'add_connector') {
    for (const end of ['from', 'to'] as const) {
      const value = rec[end];
      if (typeof value === 'object' && value !== null) {
        for (const key of Object.keys(value)) {
          if (key !== 'shape' && key !== 'port') errors[`op.${end}.${key}`] = 'Unexpected key.';
        }
      }
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export function deepCloneDoc(doc: Document): Document {
  return JSON.parse(JSON.stringify(doc)) as Document;
}
