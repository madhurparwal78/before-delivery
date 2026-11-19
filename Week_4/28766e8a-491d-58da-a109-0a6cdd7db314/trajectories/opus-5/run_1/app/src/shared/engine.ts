import { copy } from './copy.js';
import {
  LIMITS,
  type DiagramDocument,
  type Group,
  type Layer,
  type Page,
  type Shape,
  byId,
  findLayer,
  findPage,
  findShape,
  isLayerLocked,
  pageOfConnector,
  pageOfLayer,
  pageOfShape,
  pagesInOrder,
} from './document.js';
import type { Operation, ShapeSet } from './operation.js';
import { reroutePage } from './router.js';
import type { FieldErrors } from './validate.js';


/** Why the engine refused an operation. The server maps these onto the API error codes. */
export type RefusalCode =
  | 'shape_deleted'
  | 'connector_deleted'
  | 'layer_locked'
  | 'not_found'
  | 'invalid';

export class OperationRefusal extends Error {
  readonly code: RefusalCode;
  readonly fields: FieldErrors | undefined;

  constructor(code: RefusalCode, message: string, fields?: FieldErrors) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

const notFound = (): OperationRefusal => new OperationRefusal('not_found', 'Diagram not found.');
const conflict = (code: RefusalCode, message: string): OperationRefusal =>
  new OperationRefusal(code, message);
const invalidRequest = (fields: FieldErrors): OperationRefusal =>
  new OperationRefusal('invalid', 'Check the highlighted fields.', fields);

/** Only the server makes lasting ids; the browser mints local ones for offline edits. */
export type MintId = (prefix: 'p' | 'l' | 's' | 'c' | 'g') => string;

/** Enough of the document to put back what one operation changed. */
export interface Inverse {
  /** The full before-state of these pages; a page not present any more is inserted again. */
  pages?: Page[];
  /** Pages the operation created, which the inverse removes. */
  createdPages?: string[];
  pageOrder?: { id: string; order: number }[];
  layerOrder?: { page: string; layer: string; order: number }[];
  commentAnchors?: { comment: string; anchored: boolean }[];
}

export interface CreatedObject {
  id: string;
  kind: 'page' | 'layer' | 'shape' | 'connector' | 'group';
}

export interface EngineOutcome {
  ids: Record<string, string>;
  rerouted: string[];
  inverse: Inverse;
  /** Field keys this operation set, for the same-field conflict and undo skip rules. */
  changedFields: string[];
  created: CreatedObject[];
  /** Shapes this operation removed, whose comments become unanchored. */
  unanchoredShapes: string[];
  /** Shapes this operation brought back, whose comments anchor again. */
  anchoredShapes: string[];
  touchedPages: string[];
}

export interface EngineContext {
  mintId: MintId;
  /** Resolves `restore_version`; the document of a version of this diagram. */
  versionDocument?: (versionId: string) => DiagramDocument | undefined;
  /** Shapes that each comment is attached to, so a restore can set anchoring. */
  comments?: { id: string; shape: string; anchored: boolean }[];
}

/** A restore changes the whole document, so it counts as a later write to every field. */
export const DOCUMENT_FIELD = 'document:*';

export function shapeField(shapeId: string, field: string): string {
  return `shape:${shapeId}:${field}`;
}

/** A delete or a restore touches every field of a shape, existence included. */
export function allShapeFields(shapeId: string): string[] {
  return ['x', 'y', 'w', 'h', 'label', 'layer', '*'].map((field) => shapeField(shapeId, field));
}

export function shapeOfField(field: string): string | null {
  const parts = field.split(':');
  return parts[0] === 'shape' ? (parts[1] ?? null) : null;
}

function snapshotPages(doc: DiagramDocument, pageIds: readonly string[]): Page[] {
  return doc.pages.filter((p) => pageIds.includes(p.id)).map((p) => structuredClone(p) as Page);
}

function pageOrderOf(doc: DiagramDocument): { id: string; order: number }[] {
  return doc.pages.map((p) => ({ id: p.id, order: p.order }));
}

function layerOrderOf(page: Page): { page: string; layer: string; order: number }[] {
  return page.layers.map((l) => ({ page: page.id, layer: l.id, order: l.order }));
}

/** Puts back what an operation changed. Routes are derived again afterwards. */
export function applyInverse(doc: DiagramDocument, inverse: Inverse): string[] {
  const touched = new Set<string>();
  for (const id of inverse.createdPages ?? []) {
    const index = doc.pages.findIndex((p) => p.id === id);
    if (index >= 0) doc.pages.splice(index, 1);
  }
  for (const page of inverse.pages ?? []) {
    const index = doc.pages.findIndex((p) => p.id === page.id);
    const restored = structuredClone(page) as Page;
    if (index >= 0) doc.pages[index] = restored;
    else doc.pages.push(restored);
    touched.add(page.id);
  }
  for (const entry of inverse.pageOrder ?? []) {
    const page = findPage(doc, entry.id);
    if (page) page.order = entry.order;
  }
  for (const entry of inverse.layerOrder ?? []) {
    const page = findPage(doc, entry.page);
    const layer = page ? findLayer(page, entry.layer) : undefined;
    if (layer) layer.order = entry.order;
    if (page) touched.add(page.id);
  }
  return [...touched];
}

/** The layers whose shapes an inverse would put back or change. */
export function layersTouchedByInverse(doc: DiagramDocument, inverse: Inverse): string[] {
  const layers = new Set<string>();
  for (const snapshot of inverse.pages ?? []) {
    const current = findPage(doc, snapshot.id);
    for (const shape of snapshot.shapes) {
      const now = current ? findShape(current, shape.id) : undefined;
      if (!now || now.x !== shape.x || now.y !== shape.y || now.w !== shape.w || now.h !== shape.h ||
        now.label !== shape.label || now.layer !== shape.layer) {
        layers.add(shape.layer);
        if (now) layers.add(now.layer);
      }
    }
    for (const shape of current?.shapes ?? []) {
      if (!snapshot.shapes.some((s) => s.id === shape.id)) layers.add(shape.layer);
    }
  }
  return [...layers];
}

function requirePage(doc: DiagramDocument, pageId: string): Page {
  const page = findPage(doc, pageId);
  if (!page) throw notFound();
  return page;
}

function requireShape(doc: DiagramDocument, shapeId: string): { page: Page; shape: Shape } {
  const page = pageOfShape(doc, shapeId);
  const shape = page ? findShape(page, shapeId) : undefined;
  if (!page || !shape) throw conflict('shape_deleted', 'That shape was deleted.');
  return { page, shape };
}

function refuseLockedLayer(page: Page, layerId: string): void {
  if (isLayerLocked(page, layerId)) {
    throw conflict('layer_locked', 'That layer is locked.');
  }
}

function nextZ(page: Page, layerId: string): number {
  return page.shapes.filter((s) => s.layer === layerId).reduce((max, s) => Math.max(max, s.z), 0) + 1;
}

/** Removes a shape from its group, dissolving a group left with fewer than two members. */
function detachFromGroup(page: Page, shape: Shape): void {
  if (shape.group === null) return;
  const group = page.groups.find((g) => g.id === shape.group);
  shape.group = null;
  if (!group) return;
  group.members = group.members.filter((id) => id !== shape.id);
  if (group.members.length < 2) {
    for (const memberId of group.members) {
      const member = findShape(page, memberId);
      if (member) member.group = null;
    }
    page.groups = page.groups.filter((g) => g.id !== group.id);
  }
}

function removeShapes(page: Page, shapeIds: readonly string[]): void {
  for (const id of shapeIds) {
    const shape = findShape(page, id);
    if (!shape) continue;
    detachFromGroup(page, shape);
    page.shapes = page.shapes.filter((s) => s.id !== id);
    page.connectors = page.connectors.filter((c) => c.from.shape !== id && c.to.shape !== id);
  }
}

/** Every shape of the group a shape belongs to, or just that shape when it has no group. */
function groupMates(page: Page, shape: Shape): Shape[] {
  if (shape.group === null) return [shape];
  const group = page.groups.find((g) => g.id === shape.group);
  if (!group) return [shape];
  return group.members.map((id) => findShape(page, id)).filter((s): s is Shape => s !== undefined);
}

function applySet(page: Page, shape: Shape, set: ShapeSet, changed: string[]): void {
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = set[key];
    if (value !== undefined) {
      shape[key] = value;
      changed.push(shapeField(shape.id, key));
    }
  }
  if (set.label !== undefined) {
    shape.label = set.label;
    changed.push(shapeField(shape.id, 'label'));
  }
  if (set.layer !== undefined && set.layer !== shape.layer) {
    // Changing a shape's layer moves its whole group with it.
    for (const mate of groupMates(page, shape)) {
      mate.layer = set.layer;
      mate.z = nextZ(page, set.layer);
      changed.push(shapeField(mate.id, 'layer'));
    }
  }
}

/** Checks one `update_shapes` entry before anything is written. */
function checkEntry(
  doc: DiagramDocument,
  entry: { shape: string; set: ShapeSet },
  path: string,
): { page: Page; shape: Shape } {
  const found = requireShape(doc, entry.shape);
  refuseLockedLayer(found.page, found.shape.layer);
  if (entry.set.layer !== undefined) {
    const target = pageOfLayer(doc, entry.set.layer);
    if (!target) throw notFound();
    if (target.id !== found.page.id) {
      throw invalidRequest({ [`${path}.set.layer`]: 'Choose a layer on the same page.' });
    }
    refuseLockedLayer(found.page, entry.set.layer);
  }
  return found;
}

function emptyOutcome(): EngineOutcome {
  return {
    ids: {},
    rerouted: [],
    inverse: {},
    changedFields: [],
    created: [],
    unanchoredShapes: [],
    anchoredShapes: [],
    touchedPages: [],
  };
}

/**
 * Applies one operation to the document and reports what changed. The caller has already
 * checked the session, membership, role, replay and outage rules.
 */
export function applyOperation(
  doc: DiagramDocument,
  op: Operation,
  context: EngineContext,
): EngineOutcome {
  const outcome = emptyOutcome();
  const changed = outcome.changedFields;

  switch (op.kind) {
    case 'add_shape': {
      const page = requirePage(doc, op.page);
      const layer = findLayer(page, op.layer);
      if (!layer) {
        if (!pageOfLayer(doc, op.layer)) throw notFound();
        throw invalidRequest({ 'op.layer': 'Choose a layer on the same page.' });
      }
      refuseLockedLayer(page, op.layer);
      if (page.shapes.length >= LIMITS.shapesPerPage) {
        throw invalidRequest({ 'op.page': `A page holds at most ${LIMITS.shapesPerPage} shapes.` });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      const id = context.mintId('s');
      page.shapes.push({
        id,
        kind: op.shape.kind,
        layer: op.layer,
        x: op.shape.x,
        y: op.shape.y,
        w: op.shape.w,
        h: op.shape.h,
        label: op.shape.label,
        z: nextZ(page, op.layer),
        group: null,
      });
      outcome.ids[op.clientRef] = id;
      outcome.created.push({ id, kind: 'shape' });
      changed.push(...allShapeFields(id));
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'update_shape': {
      const found = checkEntry(doc, { shape: op.shape, set: op.set }, 'op');
      outcome.inverse = { pages: snapshotPages(doc, [found.page.id]) };
      applySet(found.page, found.shape, op.set, changed);
      outcome.touchedPages.push(found.page.id);
      break;
    }

    case 'update_shapes': {
      const checked = op.shapes.map((entry, index) => checkEntry(doc, entry, `op.shapes.${index}`));
      const pages = new Set(checked.map((c) => c.page.id));
      if (pages.size > 1) {
        throw invalidRequest({ 'op.shapes': 'Name shapes on one page.' });
      }
      const page = checked[0]?.page;
      if (!page) throw invalidRequest({ 'op.shapes': 'Name at least one shape.' });
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      for (let i = 0; i < op.shapes.length; i += 1) {
        const entry = op.shapes[i];
        const target = checked[i];
        if (!entry || !target) continue;
        applySet(page, target.shape, entry.set, changed);
      }
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'delete_shape':
    case 'delete_shapes': {
      const ids = op.kind === 'delete_shape' ? [op.shape] : op.shapes;
      const found = ids.map((id) => requireShape(doc, id));
      for (const entry of found) refuseLockedLayer(entry.page, entry.shape.layer);
      const pages = new Set(found.map((f) => f.page.id));
      if (pages.size > 1) throw invalidRequest({ 'op.shapes': 'Name shapes on one page.' });
      const page = found[0]?.page;
      if (!page) throw invalidRequest({ 'op.shapes': 'Name at least one shape.' });
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      for (const entry of found) {
        changed.push(...allShapeFields(entry.shape.id));
        outcome.unanchoredShapes.push(entry.shape.id);
      }
      removeShapes(page, ids);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'add_connector': {
      const page = requirePage(doc, op.page);
      const from = findShape(page, op.from.shape);
      const to = findShape(page, op.to.shape);
      if (!from || !to) {
        requireShape(doc, from ? op.to.shape : op.from.shape);
        throw invalidRequest({ 'op.from.shape': 'Connect two shapes on this page.' });
      }
      if (from.id === to.id) {
        throw invalidRequest({ 'op.to.shape': 'Connect two different shapes.' });
      }
      refuseLockedLayer(page, from.layer);
      refuseLockedLayer(page, to.layer);
      if (page.connectors.length >= LIMITS.connectorsPerPage) {
        throw invalidRequest({ 'op.page': `A page holds at most ${LIMITS.connectorsPerPage} connectors.` });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      const id = context.mintId('c');
      page.connectors.push({
        id,
        layer: from.layer,
        from: { shape: from.id, port: op.from.port },
        to: { shape: to.id, port: op.to.port },
        label: op.label,
        route: [],
      });
      outcome.ids[op.clientRef] = id;
      outcome.created.push({ id, kind: 'connector' });
      changed.push(`connector:${id}:*`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'delete_connector': {
      const page = pageOfConnector(doc, op.connector);
      const connector = page?.connectors.find((c) => c.id === op.connector);
      if (!page || !connector) throw conflict('connector_deleted', 'That connector was deleted.');
      refuseLockedLayer(page, connector.layer);
      const from = findShape(page, connector.from.shape);
      const to = findShape(page, connector.to.shape);
      if (from) refuseLockedLayer(page, from.layer);
      if (to) refuseLockedLayer(page, to.layer);
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      page.connectors = page.connectors.filter((c) => c.id !== op.connector);
      changed.push(`connector:${op.connector}:*`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'duplicate_shapes': {
      const found = op.shapes.map((id) => requireShape(doc, id));
      const page = found[0]?.page;
      if (!page) throw invalidRequest({ 'op.shapes': 'Name at least one shape.' });
      for (const entry of found) refuseLockedLayer(entry.page, entry.shape.layer);
      if (page.shapes.length + found.length > LIMITS.shapesPerPage) {
        throw invalidRequest({ 'op.shapes': `A page holds at most ${LIMITS.shapesPerPage} shapes.` });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      const groupMap = new Map<string, Group>();
      for (const entry of found) {
        const id = context.mintId('s');
        let group: string | null = null;
        if (entry.shape.group !== null) {
          let copyGroup = groupMap.get(entry.shape.group);
          if (!copyGroup) {
            copyGroup = { id: context.mintId('g'), members: [] };
            groupMap.set(entry.shape.group, copyGroup);
            page.groups.push(copyGroup);
            outcome.created.push({ id: copyGroup.id, kind: 'group' });
          }
          copyGroup.members.push(id);
          group = copyGroup.id;
        }
        page.shapes.push({
          ...entry.shape,
          id,
          x: entry.shape.x + op.dx,
          y: entry.shape.y + op.dy,
          z: nextZ(page, entry.shape.layer),
          group,
        });
        outcome.created.push({ id, kind: 'shape' });
        changed.push(...allShapeFields(id));
      }
      for (const [, group] of groupMap) {
        if (group.members.length < 2) {
          for (const memberId of group.members) {
            const member = findShape(page, memberId);
            if (member) member.group = null;
          }
          page.groups = page.groups.filter((g) => g.id !== group.id);
        }
      }
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'reorder_shape': {
      const found = op.shapes.map((id) => requireShape(doc, id));
      const page = found[0]?.page;
      if (!page) throw invalidRequest({ 'op.shapes': 'Name at least one shape.' });
      for (const entry of found) refuseLockedLayer(entry.page, entry.shape.layer);
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      for (const entry of found) {
        const siblings = page.shapes
          .filter((s) => s.layer === entry.shape.layer)
          .sort((a, b) => a.z - b.z || byId(a.id, b.id));
        const index = siblings.findIndex((s) => s.id === entry.shape.id);
        const swapWith = op.direction === 'forward' ? siblings[index + 1] : siblings[index - 1];
        if (!swapWith) continue;
        const z = entry.shape.z;
        entry.shape.z = swapWith.z;
        swapWith.z = z;
      }
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'group_shapes': {
      const found = op.shapes.map((id) => requireShape(doc, id));
      const page = found[0]?.page;
      if (!page || found.length < 2) {
        throw invalidRequest({ 'op.shapes': 'Group two or more shapes.' });
      }
      for (const entry of found) refuseLockedLayer(entry.page, entry.shape.layer);
      const layers = new Set(found.map((f) => f.shape.layer));
      if (layers.size > 1 || new Set(found.map((f) => f.page.id)).size > 1) {
        throw invalidRequest({ 'op.shapes': copy.crossLayerGroupRefusal });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      for (const entry of found) detachFromGroup(page, entry.shape);
      const group: Group = { id: context.mintId('g'), members: found.map((f) => f.shape.id) };
      page.groups.push(group);
      for (const entry of found) {
        entry.shape.group = group.id;
        changed.push(shapeField(entry.shape.id, '*'));
      }
      outcome.created.push({ id: group.id, kind: 'group' });
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'ungroup_shapes': {
      const page = doc.pages.find((p) => p.groups.some((g) => op.groups.includes(g.id)));
      if (!page) throw notFound();
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      for (const groupId of op.groups) {
        const group = page.groups.find((g) => g.id === groupId);
        if (!group) continue;
        for (const memberId of group.members) {
          const member = findShape(page, memberId);
          if (!member) continue;
          refuseLockedLayer(page, member.layer);
          member.group = null;
          changed.push(shapeField(member.id, '*'));
        }
        page.groups = page.groups.filter((g) => g.id !== groupId);
      }
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'add_page': {
      if (doc.pages.length >= LIMITS.pagesPerDiagram) {
        throw invalidRequest({ 'op.name': `A diagram holds at most ${LIMITS.pagesPerDiagram} pages.` });
      }
      outcome.inverse = { pageOrder: pageOrderOf(doc) };
      const page = newPage(context.mintId, op.name, doc.pages.length);
      doc.pages.push(page);
      outcome.created.push({ id: page.id, kind: 'page' });
      for (const layer of page.layers) outcome.created.push({ id: layer.id, kind: 'layer' });
      outcome.inverse.createdPages = [page.id];
      outcome.ids['page'] = page.id;
      changed.push(`page:${page.id}:*`);
      break;
    }

    case 'rename_page': {
      const page = requirePage(doc, op.page);
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      page.name = op.name;
      changed.push(`page:${page.id}:name`);
      break;
    }

    case 'reorder_page': {
      const page = requirePage(doc, op.page);
      outcome.inverse = { pageOrder: pageOrderOf(doc) };
      const ordered = pagesInOrder(doc);
      const index = ordered.findIndex((p) => p.id === page.id);
      const swapWith = op.direction === 'up' ? ordered[index - 1] : ordered[index + 1];
      if (!swapWith) return emptyOutcome();
      const order = page.order;
      page.order = swapWith.order;
      swapWith.order = order;
      changed.push(`page:${page.id}:order`, `page:${swapWith.id}:order`);
      break;
    }

    case 'delete_page': {
      const page = requirePage(doc, op.page);
      if (doc.pages.length <= 1) {
        throw invalidRequest({ 'op.page': 'A diagram keeps at least one page.' });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]), pageOrder: pageOrderOf(doc) };
      doc.pages = doc.pages.filter((p) => p.id !== page.id);
      pagesInOrder(doc).forEach((p, index) => {
        p.order = index;
      });
      for (const shape of page.shapes) outcome.unanchoredShapes.push(shape.id);
      changed.push(`page:${page.id}:*`);
      break;
    }

    case 'add_layer': {
      const page = requirePage(doc, op.page);
      if (page.layers.length >= LIMITS.layersPerPage) {
        throw invalidRequest({ 'op.name': `A page holds at most ${LIMITS.layersPerPage} layers.` });
      }
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      const layer: Layer = {
        id: context.mintId('l'),
        name: op.name,
        order: page.layers.reduce((max, l) => Math.max(max, l.order), -1) + 1,
        visible: true,
        locked: false,
      };
      page.layers.push(layer);
      outcome.created.push({ id: layer.id, kind: 'layer' });
      outcome.ids['layer'] = layer.id;
      changed.push(`layer:${layer.id}:*`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'rename_layer': {
      const page = pageOfLayer(doc, op.layer);
      const layer = page ? findLayer(page, op.layer) : undefined;
      if (!page || !layer) throw notFound();
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      layer.name = op.name;
      changed.push(`layer:${layer.id}:name`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'reorder_layer': {
      const page = pageOfLayer(doc, op.layer);
      const layer = page ? findLayer(page, op.layer) : undefined;
      if (!page || !layer) throw notFound();
      outcome.inverse = { layerOrder: layerOrderOf(page) };
      // The rail lists layers top first, so moving an item up raises its order.
      const ordered = [...page.layers].sort((a, b) => a.order - b.order);
      const index = ordered.findIndex((l) => l.id === layer.id);
      const swapWith = op.direction === 'up' ? ordered[index + 1] : ordered[index - 1];
      if (!swapWith) return emptyOutcome();
      const order = layer.order;
      layer.order = swapWith.order;
      swapWith.order = order;
      changed.push(`layer:${layer.id}:order`, `layer:${swapWith.id}:order`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'set_layer_flag': {
      const page = pageOfLayer(doc, op.layer);
      const layer = page ? findLayer(page, op.layer) : undefined;
      if (!page || !layer) throw notFound();
      outcome.inverse = { pages: snapshotPages(doc, [page.id]) };
      layer[op.flag] = op.value;
      changed.push(`layer:${layer.id}:${op.flag}`);
      outcome.touchedPages.push(page.id);
      break;
    }

    case 'restore_version': {
      const restored = context.versionDocument?.(op.version);
      if (!restored) throw notFound();
      outcome.inverse = {
        pages: snapshotPages(doc, doc.pages.map((p) => p.id)),
        createdPages: restored.pages.filter((p) => !findPage(doc, p.id)).map((p) => p.id),
        commentAnchors: (context.comments ?? []).map((c) => ({ comment: c.id, anchored: c.anchored })),
      };
      doc.pages = (structuredClone(restored.pages) as Page[]);
      changed.push(DOCUMENT_FIELD);
      for (const comment of context.comments ?? []) {
        const exists = doc.pages.some((p) => p.shapes.some((s) => s.id === comment.shape));
        if (exists) outcome.anchoredShapes.push(comment.shape);
        else outcome.unanchoredShapes.push(comment.shape);
      }
      outcome.touchedPages.push(...doc.pages.map((p) => p.id));
      break;
    }

    case 'undo':
    case 'redo':
      throw invalidRequest({ 'op.kind': 'Undo is resolved from the stored operation log.' });
  }

  outcome.rerouted = rerouteTouched(doc, outcome);
  return outcome;
}

/** Derives routes again on every page the operation touched and lists the stored routes that changed. */
export function rerouteTouched(doc: DiagramDocument, outcome: EngineOutcome): string[] {
  const createdConnectors = outcome.created.filter((c) => c.kind === 'connector').map((c) => c.id);
  const changed: string[] = [];
  for (const pageId of new Set(outcome.touchedPages)) {
    const page = findPage(doc, pageId);
    if (!page) continue;
    changed.push(...reroutePage(page).filter((id) => !createdConnectors.includes(id)));
  }
  return changed.sort(byId);
}

export function rerouteEveryPage(doc: DiagramDocument): string[] {
  const changed: string[] = [];
  for (const page of doc.pages) changed.push(...reroutePage(page));
  return changed.sort(byId);
}

export function newPage(mintId: MintId, name: string, order: number): Page {
  return {
    id: mintId('p'),
    name,
    order,
    layers: [{ id: mintId('l'), name: 'Layer 1', order: 0, visible: true, locked: false }],
    shapes: [],
    connectors: [],
    groups: [],
  };
}

export function newDocument(mintId: MintId, id: string, title: string): DiagramDocument {
  return { id, title, seq: 0, pages: [newPage(mintId, 'Page 1', 0)] };
}
