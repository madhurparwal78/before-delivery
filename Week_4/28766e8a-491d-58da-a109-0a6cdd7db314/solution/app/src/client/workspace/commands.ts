// Editing commands shared by the canvas, keyboard, menus, rails and inspector. Each one turns a
// person's intent into operations and the published notices (brief: Interactions, Feedback states).
import { copy, labelFor, shapeLabel } from "../../shared/copy";
import { align, boundingBox, canAlign, canDistribute, defaultPorts, distribute, DUPLICATE_OFFSET, readingOrder, type AlignSide } from "../../shared/geometry";
import type { Box, Layer, Op, Page, Port, Shape, ShapeFields } from "../../shared/types";
import { announce } from "../announce";
import { newRef, reducedMotion, type WorkspaceStore } from "./store";

export const SETTLE_MS = 200;

export function layerOf(page: Page, shape: Shape): Layer | undefined {
  return page.layers.find((l) => l.id === shape.layer);
}

export function visibleShapes(page: Page): Shape[] {
  const visible = new Set(page.layers.filter((l) => l.visible).map((l) => l.id));
  return page.shapes.filter((s) => visible.has(s.layer));
}

export function isLocked(page: Page, shape: Shape): boolean {
  return !!layerOf(page, shape)?.locked;
}

/** Shapes in the selection that still exist on the open page. */
export function selectedShapes(store: WorkspaceStore): Shape[] {
  const page = store.page;
  if (!page) return [];
  const ids = new Set(store.selection.map((id) => store.resolve(id)));
  return page.shapes.filter((s) => ids.has(s.id));
}

/** A shape and the rest of its group: clicking a member selects the whole group. */
export function withGroup(page: Page, shape: Shape): string[] {
  return shape.group ? page.shapes.filter((s) => s.group === shape.group).map((s) => s.id) : [shape.id];
}

/** Refuses a locked shape with the locked notice; true when the shape may be changed. */
export function guardLocked(page: Page, shape: Shape): boolean {
  const layer = layerOf(page, shape);
  if (layer?.locked) {
    announce(copy.locked(layer.name));
    return false;
  }
  return true;
}

export function select(store: WorkspaceStore, ids: string[]): void {
  store.selection = ids;
  store.emit();
}

/** Marks connectors bound to the moved shapes as settling for 200 ms (not under reduced motion). */
function settle(store: WorkspaceStore, shapeIds: string[]): void {
  const page = store.page;
  if (!page || reducedMotion()) return;
  const moved = new Set(shapeIds);
  const ids = page.connectors.filter((c) => moved.has(c.from.shape) || moved.has(c.to.shape)).map((c) => c.id);
  if (!ids.length) return;
  for (const id of ids) store.settling.add(id);
  store.emit();
  setTimeout(() => {
    for (const id of ids) store.settling.delete(id);
    store.emit();
  }, SETTLE_MS);
}

/** One operation for one action: `update_shape` for a single shape, otherwise one all-or-nothing `update_shapes`. */
function shapeUpdates(moves: Map<string, ShapeFields>): Op {
  const shapes = [...moves].map(([shape, set]) => ({ shape, set }));
  const only = shapes[0];
  return shapes.length === 1 && only ? { kind: "update_shape", shape: only.shape, set: only.set } : { kind: "update_shapes", shapes };
}

/** Only the fields that differ, so a concurrent change to another field of the same shape survives. */
function changedFields(start: Box, next: Box): ShapeFields {
  const set: ShapeFields = {};
  for (const key of ["x", "y", "w", "h"] as const) if (next[key] !== start[key]) set[key] = next[key];
  return set;
}

/** Commits new positions (and sizes) for shapes as one operation and announces the move on acknowledgement. */
export function commitMoves(store: WorkspaceStore, boxes: Map<string, { start: Box; next: Box }>, label: string): void {
  const moves = new Map([...boxes].map(([id, b]): [string, ShapeFields] => [id, changedFields(b.start, b.next)]).filter(([, set]) => Object.keys(set).length));
  if (!moves.size) return;
  store.submit(shapeUpdates(moves), { moveLabel: label });
  settle(store, [...moves.keys()]);
}

/** The moved notice's `<label>`: the shape's label, or `<k> shapes` (group members counted). */
export function selectionLabel(shapes: readonly Shape[]): string {
  return labelFor(shapes.map(shapeLabel));
}

/** Arrow nudges move the selection, or the focused shape when nothing is selected; never snapped. Returns the moved ids. */
export function nudge(store: WorkspaceStore, dx: number, dy: number): string[] {
  const page = store.page;
  if (!page || !store.editable) return [];
  let shapes = selectedShapes(store);
  if (!shapes.length && store.focusId) {
    const focused = page.shapes.find((s) => s.id === store.resolve(store.focusId as string));
    shapes = focused ? page.shapes.filter((s) => withGroup(page, focused).includes(s.id)) : [];
  }
  if (!shapes.length || !shapes.every((s) => guardLocked(page, s))) return [];
  commitMoves(store, new Map(shapes.map((s) => [s.id, { start: s, next: { ...s, x: s.x + dx, y: s.y + dy } }])), selectionLabel(shapes));
  return shapes.map((s) => s.id);
}

export function deleteSelection(store: WorkspaceStore): string | null {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !shapes.length || !shapes.every((s) => guardLocked(page, s))) return null;
  const order = readingOrder(visibleShapes(page));
  const gone = new Set(shapes.map((s) => s.id));
  const last = Math.max(...shapes.map((s) => order.findIndex((o) => o.id === s.id)));
  const next = order.slice(last + 1).find((s) => !gone.has(s.id)) ?? null;
  const ops: Op[] = shapes.map((s) => ({ kind: "delete_shape", shape: s.id }));
  store.submit(ops.length === 1 ? (ops[0] as Op) : { kind: "batch", ops }, { deleteLabel: selectionLabel(shapes) });
  store.selection = [];
  return next?.id ?? null;
}

export function duplicateSelection(store: WorkspaceStore): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !shapes.length) return;
  const ops: Op[] = [];
  const created: string[] = [];
  for (const s of shapes) {
    const layer = layerOf(page, s);
    if (!layer || layer.locked) continue;
    const ref = newRef();
    created.push(`s_tmp${ref}`);
    ops.push({ kind: "add_shape", page: page.id, layer: layer.id, clientRef: ref,
      shape: { kind: s.kind, x: s.x + DUPLICATE_OFFSET, y: s.y + DUPLICATE_OFFSET, w: s.w, h: s.h, label: s.label } });
  }
  if (!ops.length) return;
  store.submit(ops.length === 1 ? (ops[0] as Op) : { kind: "batch", ops });
  store.selection = created;
  store.emit();
}

export function zStep(store: WorkspaceStore, direction: "forward" | "backward"): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !shapes.length || !shapes.every((s) => guardLocked(page, s))) return;
  const ops: Op[] = shapes.map((s) => ({ kind: "set_z", shape: s.id, direction }));
  store.submit(ops.length === 1 ? (ops[0] as Op) : { kind: "batch", ops });
}

export function groupSelection(store: WorkspaceStore): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || shapes.length < 2 || !shapes.every((s) => guardLocked(page, s))) return;
  if (new Set(shapes.map((s) => s.layer)).size > 1) {
    announce(copy.crossLayer);
    return;
  }
  store.submit({ kind: "group", shapes: shapes.map((s) => s.id), clientRef: newRef() });
  announce(copy.grouped(shapes.length));
}

export function ungroupSelection(store: WorkspaceStore): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable) return;
  const groups = [...new Set(shapes.map((s) => s.group).filter((g): g is string => !!g))];
  if (!groups.length || !shapes.every((s) => guardLocked(page, s))) return;
  const count = page.shapes.filter((s) => s.group && groups.includes(s.group)).length;
  const ops: Op[] = groups.map((group) => ({ kind: "ungroup", group }));
  store.submit(ops.length === 1 ? (ops[0] as Op) : { kind: "batch", ops });
  announce(copy.ungrouped(count));
}

export function alignSelection(store: WorkspaceStore, side: AlignSide): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !canAlign(shapes) || !shapes.every((s) => guardLocked(page, s))) return;
  const moves = new Map([...align(shapes, side)].filter(([id, p]) => {
    const s = shapes.find((sh) => sh.id === id) as Shape;
    return s.x !== p.x || s.y !== p.y;
  }));
  if (moves.size) store.submit(shapeUpdates(moves));
  announce(copy.aligned(shapes.length, side));
}

export function distributeSelection(store: WorkspaceStore, axis: "horizontal" | "vertical"): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !canDistribute(shapes) || !shapes.every((s) => guardLocked(page, s))) return;
  const moves = new Map([...distribute(shapes, axis)].filter(([id, p]) => {
    const s = shapes.find((sh) => sh.id === id) as Shape;
    return s.x !== p.x || s.y !== p.y;
  }));
  if (moves.size) store.submit(shapeUpdates(moves));
  announce(copy.distributed(shapes.length));
}

export function setSelectionLayer(store: WorkspaceStore, layer: string): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !shapes.length) return;
  const target = page.layers.find((l) => l.id === layer);
  if (!target || !shapes.every((s) => guardLocked(page, s))) return;
  if (target.locked) {
    announce(copy.locked(target.name));
    return;
  }
  const lead = [...new Set(shapes.map((s) => s.group ?? s.id))].map((key) => shapes.find((s) => (s.group ?? s.id) === key) as Shape);
  const moves = new Map(lead.filter((s) => s.layer !== layer).map((s): [string, ShapeFields] => [s.id, { layer }]));
  if (moves.size) store.submit(shapeUpdates(moves));
}

/** Commits inspector fields for the selection (X and Y move a multi-selection by its bounding box). */
export function commitFields(store: WorkspaceStore, fields: ShapeFields): void {
  const page = store.page;
  const shapes = selectedShapes(store);
  if (!page || !store.editable || !shapes.length || !shapes.every((s) => guardLocked(page, s))) return;
  if (shapes.length === 1) {
    const s = shapes[0] as Shape;
    const moved = fields.x !== undefined || fields.y !== undefined;
    store.submit({ kind: "update_shape", shape: s.id, set: fields }, moved ? { moveLabel: shapeLabel(s) } : {});
    if (moved) settle(store, [s.id]);
    return;
  }
  const box = boundingBox(shapes);
  const dx = fields.x !== undefined ? fields.x - box.x : 0;
  const dy = fields.y !== undefined ? fields.y - box.y : 0;
  commitMoves(store, new Map(shapes.map((s) => [s.id, { start: s, next: { ...s, x: s.x + dx, y: s.y + dy } }])), selectionLabel(shapes));
}

export function connectShapes(store: WorkspaceStore, source: Shape, target: Shape, targetPort: Port | null): void {
  const page = store.page;
  if (!page || !store.editable) return;
  const ports = defaultPorts(source, target);
  store.submit({ kind: "add_connector", page: page.id, from: { shape: source.id, port: ports.from }, to: { shape: target.id, port: targetPort ?? ports.to }, label: "", clientRef: newRef() });
  announce(copy.connected(shapeLabel(source), shapeLabel(target)));
}

// ------------------------------------------------------------ pages and layers

export function addPage(store: WorkspaceStore): void {
  const doc = store.doc;
  if (!doc || !store.editable) return;
  const ref = newRef();
  store.submit({ kind: "add_page", name: `Page ${doc.pages.length + 1}`, clientRef: ref });
  store.setPage(`p_tmp${ref}`);
}

export function renamePage(store: WorkspaceStore, page: string, name: string): void {
  if (store.editable && name.trim()) store.submit({ kind: "update_page", page, name: name.trim() });
}

export function movePage(store: WorkspaceStore, pageId: string, delta: -1 | 1): void {
  const doc = store.doc;
  if (!doc || !store.editable) return;
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const index = pages.findIndex((p) => p.id === pageId);
  const to = index + delta;
  const page = pages[index];
  if (!page || to < 0 || to >= pages.length) return;
  store.submit({ kind: "move_page", page: pageId, index: to });
  store.focusKey = `page:${pageId}`;
  announce(copy.reordered(page.name, to + 1, pages.length));
}

export function deletePage(store: WorkspaceStore, pageId: string): void {
  const doc = store.doc;
  if (!doc || !store.editable || doc.pages.length <= 1) return;
  const pages = [...doc.pages].sort((a, b) => a.order - b.order);
  const index = pages.findIndex((p) => p.id === pageId);
  const neighbour = pages[index + 1] ?? pages[index - 1];
  store.submit({ kind: "delete_page", page: pageId });
  if (store.pageId === pageId && neighbour) store.setPage(neighbour.id);
  store.focusKey = neighbour ? `page:${neighbour.id}` : null;
}

export function addLayer(store: WorkspaceStore): void {
  const page = store.page;
  if (!page || !store.editable) return;
  const names = new Set(page.layers.map((l) => l.name));
  let n = page.layers.length + 1;
  while (names.has(`Layer ${n}`)) n++;
  store.submit({ kind: "add_layer", page: page.id, name: `Layer ${n}`, clientRef: newRef() });
}

export function renameLayer(store: WorkspaceStore, layer: string, name: string): void {
  if (store.editable && name.trim()) store.submit({ kind: "update_layer", layer, set: { name: name.trim() } });
}

/** Moves a layer one place in the list as shown (top layer first). */
export function moveLayer(store: WorkspaceStore, layerId: string, delta: -1 | 1): void {
  const page = store.page;
  if (!page || !store.editable) return;
  const shown = [...page.layers].sort((a, b) => b.order - a.order);
  const index = shown.findIndex((l) => l.id === layerId);
  const to = index + delta;
  const layer = shown[index];
  if (!layer || to < 0 || to >= shown.length) return;
  store.submit({ kind: "move_layer", layer: layerId, index: shown.length - 1 - to });
  store.focusKey = `layer:${layerId}`;
  announce(copy.reordered(layer.name, to + 1, shown.length));
}

export function toggleLayer(store: WorkspaceStore, layer: Layer, field: "visible" | "locked"): void {
  if (!store.editable) return;
  store.submit({ kind: "update_layer", layer: layer.id, set: { [field]: !layer[field] } });
  if (field === "visible" && layer.visible) store.selection = store.selection.filter((id) => store.page?.shapes.find((s) => s.id === id)?.layer !== layer.id);
}
