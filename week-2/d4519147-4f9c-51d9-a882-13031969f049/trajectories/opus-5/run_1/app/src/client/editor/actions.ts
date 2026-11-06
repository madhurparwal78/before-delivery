import {
  COPY,
  connectedAnnouncement,
  layerAlreadyBack,
  layerAlreadyFront,
  layerBroughtForward,
  layerManyAlreadyBack,
  layerManyAlreadyFront,
  layerManyBackward,
  layerManyForward,
  layerSentBackward,
} from '../../shared/copy';
import {
  allIds,
  alignSelection,
  changeLayer,
  clonePage,
  deleteSelection,
  duplicateSelection,
  expandSelection,
  groupSelection,
  highestZ,
  layerPosition,
  newItemId,
  placeZoneClear,
  resizeZone,
  translateSelection,
  ungroupSelection,
  type AlignEdge,
} from '../../shared/editing';
import { closestPortPair, portPoint, rerouteConnectorsFor, routeConnector, snapToGrid } from '../../shared/geometry';
import { plainLabel } from '../../shared/labels';
import { GRID, NEW_SHAPE_HEIGHT, NEW_SHAPE_WIDTH, NEW_ZONE_HEIGHT, NEW_ZONE_WIDTH, systemKindName, zoneKindDefaultName } from '../../shared/kinds';
import type { SystemKindId, ZoneKindId } from '../../shared/types';
import { announce } from '../dom';
import type { EditorState, EditMeta } from './state';

export interface EditorContext {
  state: EditorState;
  paneSize(): { width: number; height: number };
  view: { zoom: number; panX: number; panY: number };
  focusItem(id: string): void;
  openInspectorFor(id: string): void;
  focusLabelField(): void;
}

function snap(value: number): number {
  return snapToGrid(value, GRID);
}

/** The canvas point a new item is centred on: the drop point, or the centre of the pane. */
function placementCentre(context: EditorContext, at?: { x: number; y: number }): { x: number; y: number } {
  if (at) return at;
  const size = context.paneSize();
  return {
    x: (size.width / 2 - context.view.panX) / context.view.zoom,
    y: (size.height / 2 - context.view.panY) / context.view.zoom,
  };
}

/** Places a library shape centred on its target point and snapped to the grid. */
export function addShapeOfKind(context: EditorContext, kind: SystemKindId, at?: { x: number; y: number }): void {
  const { state } = context;
  if (!state.canEdit) return;
  const { x: centreX, y: centreY } = placementCentre(context, at);
  const next = clonePage(state.doc);
  const id = newItemId('shp', allIds(next));
  next.shapes.push({
    id,
    kind,
    label: systemKindName(kind),
    x: snap(centreX - NEW_SHAPE_WIDTH / 2),
    y: snap(centreY - NEW_SHAPE_HEIGHT / 2),
    width: NEW_SHAPE_WIDTH,
    height: NEW_SHAPE_HEIGHT,
    z: highestZ(next) + 1,
    groupId: null,
  });
  state.applyEdit(next, { movedShapeIds: [id] });
  state.select([id], id);
  context.focusItem(id);
}

export function addZoneOfKind(context: EditorContext, kind: ZoneKindId, at?: { x: number; y: number }): void {
  const { state } = context;
  if (!state.canEdit || state.doc.zones.length >= 20) return;
  const { x: centreX, y: centreY } = placementCentre(context, at);
  const next = clonePage(state.doc);
  const id = newItemId('zone', allIds(next));
  const candidate = {
    id,
    kind,
    name: zoneKindDefaultName(kind),
    note: '',
    x: snap(centreX - NEW_ZONE_WIDTH / 2),
    y: snap(centreY - NEW_ZONE_HEIGHT / 2),
    width: NEW_ZONE_WIDTH,
    height: NEW_ZONE_HEIGHT,
  };
  next.zones.push(placeZoneClear(next.zones, candidate));
  state.applyEdit(next, { zoneAction: { zoneId: id, kind: 'moved' } });
  state.select([id], id);
  context.focusItem(id);
}

export function moveSelection(context: EditorContext, dx: number, dy: number): void {
  const { state } = context;
  if (!state.canEdit || state.selection.size === 0) return;
  const selection = expandSelection(state.doc, state.selection);
  const outcome = translateSelection(state.doc, selection, dx, dy);
  if (!outcome.ok) {
    if (outcome.movedZoneIds.size > 0) announce(COPY.overlapRefusal);
    return;
  }
  const meta: EditMeta = { movedShapeIds: [...outcome.movedShapeIds] };
  const movedZone = [...outcome.movedZoneIds][0];
  if (movedZone) meta.zoneAction = { zoneId: movedZone, kind: 'moved' };
  state.applyEdit(outcome.doc, meta);
}

export function setGeometryOf(
  context: EditorContext,
  id: string,
  values: { x?: number; y?: number; width?: number; height?: number },
): void {
  const { state } = context;
  if (!state.canEdit) return;
  const zone = state.doc.zones.find((entry) => entry.id === id);
  if (zone) {
    if (values.x !== undefined || values.y !== undefined) {
      const dx = (values.x ?? zone.x) - zone.x;
      const dy = (values.y ?? zone.y) - zone.y;
      if (dx === 0 && dy === 0) return;
      const outcome = translateSelection(state.doc, new Set([zone.id]), dx, dy);
      if (!outcome.ok) {
        announce(COPY.overlapRefusal);
        state.notify({ selection: true });
        return;
      }
      state.applyEdit(outcome.doc, {
        movedShapeIds: [...outcome.movedShapeIds],
        zoneAction: { zoneId: zone.id, kind: 'moved' },
      });
      return;
    }
    const outcome = resizeZone(state.doc, zone.id, values.width ?? zone.width, values.height ?? zone.height);
    if (!outcome.ok) {
      announce(COPY.overlapRefusal);
      state.notify({ selection: true });
      return;
    }
    state.applyEdit(outcome.doc, { zoneAction: { zoneId: zone.id, kind: 'resized' } });
    return;
  }
  const next = clonePage(state.doc);
  const shape = next.shapes.find((entry) => entry.id === id);
  if (!shape) return;
  if (values.x !== undefined) shape.x = values.x;
  if (values.y !== undefined) shape.y = values.y;
  if (values.width !== undefined) shape.width = values.width;
  if (values.height !== undefined) shape.height = values.height;
  rerouteConnectorsFor(next, new Set([shape.id]));
  state.applyEdit(next, { movedShapeIds: [shape.id] });
}

export function setShapeLabelOf(context: EditorContext, id: string, label: string): void {
  const { state } = context;
  if (!state.canEdit) return;
  const next = clonePage(state.doc);
  const shape = next.shapes.find((entry) => entry.id === id);
  if (!shape || shape.label === label) return;
  shape.label = label;
  state.applyEdit(next, { silent: true });
}

export function setShapeKindOf(context: EditorContext, id: string, kind: string): void {
  const { state } = context;
  if (!state.canEdit) return;
  const next = clonePage(state.doc);
  const shape = next.shapes.find((entry) => entry.id === id);
  if (!shape) return;
  shape.kind = kind as SystemKindId;
  state.applyEdit(next, { silent: true });
}

export function setConnectorLabelOf(context: EditorContext, id: string, label: string): void {
  const { state } = context;
  if (!state.canEdit) return;
  const next = clonePage(state.doc);
  const connector = next.connectors.find((entry) => entry.id === id);
  if (!connector || connector.label === label) return;
  connector.label = label;
  state.applyEdit(next, { silent: true });
}

export function setZoneFieldOf(
  context: EditorContext,
  id: string,
  values: { name?: string; kind?: string; note?: string },
): void {
  const { state } = context;
  if (!state.canEdit) return;
  const next = clonePage(state.doc);
  const zone = next.zones.find((entry) => entry.id === id);
  if (!zone) return;
  if (values.name !== undefined) zone.name = values.name;
  if (values.kind !== undefined) zone.kind = values.kind as ZoneKindId;
  if (values.note !== undefined) zone.note = values.note;
  state.applyEdit(next, { silent: true });
}

export function alignSelected(context: EditorContext, edge: AlignEdge): void {
  const { state } = context;
  if (!state.canEdit) return;
  const outcome = alignSelection(state.doc, expandSelection(state.doc, state.selection), edge);
  if (!outcome.ok) return;
  state.applyEdit(outcome.doc, { movedShapeIds: [...outcome.movedShapeIds] });
}

export function duplicateSelected(context: EditorContext): void {
  const { state } = context;
  if (!state.canEdit) return;
  const outcome = duplicateSelection(state.doc, expandSelection(state.doc, state.selection));
  if (!outcome.ok) return;
  state.applyEdit(outcome.doc, { movedShapeIds: outcome.newShapeIds });
  state.select(outcome.newShapeIds, outcome.newShapeIds[0] ?? null);
}

export function groupSelected(context: EditorContext): void {
  const { state } = context;
  if (!state.canEdit) return;
  const outcome = groupSelection(state.doc, state.selection);
  if (!outcome.ok) return;
  state.applyEdit(outcome.doc, { silent: true });
}

export function ungroupSelected(context: EditorContext): void {
  const { state } = context;
  if (!state.canEdit) return;
  const outcome = ungroupSelection(state.doc, expandSelection(state.doc, state.selection));
  if (!outcome.ok) return;
  state.applyEdit(outcome.doc, { silent: true });
}

export function deleteSelected(context: EditorContext): void {
  const { state } = context;
  if (!state.canEdit) return;
  const outcome = deleteSelection(state.doc, expandSelection(state.doc, state.selection));
  if (!outcome.ok) return;
  const movedShapeIds = [...state.selection];
  state.applyEdit(outcome.doc, { movedShapeIds });
  state.select([], null);
}

/** Bring forward and send backward, with the published layer sentence. */
export function changeLayerOf(context: EditorContext, direction: 'forward' | 'backward'): void {
  const { state } = context;
  if (!state.canEdit) return;
  const selection = expandSelection(state.doc, state.selection);
  const selectedShapes = state.doc.shapes.filter((shape) => selection.has(shape.id));
  if (selectedShapes.length === 0) return;
  const outcome = changeLayer(state.doc, selection, direction);
  const total = state.doc.shapes.length;
  if (!outcome.ok) {
    if (selectedShapes.length === 1) {
      const shape = selectedShapes[0];
      if (!shape) return;
      announce(direction === 'forward' ? layerAlreadyFront(plainLabel(shape.label)) : layerAlreadyBack(plainLabel(shape.label)));
    } else {
      announce(
        direction === 'forward'
          ? layerManyAlreadyFront(selectedShapes.length)
          : layerManyAlreadyBack(selectedShapes.length),
      );
    }
    return;
  }
  state.applyEdit(outcome.doc, { silent: true });
  if (selectedShapes.length === 1) {
    const shape = selectedShapes[0];
    if (!shape) return;
    const position = layerPosition(state.doc, shape.id);
    announce(
      direction === 'forward'
        ? layerBroughtForward(plainLabel(shape.label), position, total)
        : layerSentBackward(plainLabel(shape.label), position, total),
    );
    return;
  }
  announce(
    direction === 'forward'
      ? layerManyForward(outcome.movedShapeIds.length)
      : layerManyBackward(outcome.movedShapeIds.length),
  );
}

/** Starts a connector between two shapes, using the closest port pair. */
export function connectShapes(context: EditorContext, sourceId: string, targetId: string): void {
  const { state } = context;
  if (!state.canEdit || sourceId === targetId) return;
  const next = clonePage(state.doc);
  const source = next.shapes.find((entry) => entry.id === sourceId);
  const target = next.shapes.find((entry) => entry.id === targetId);
  if (!source || !target) return;
  const ports = closestPortPair(source, target);
  const id = newItemId('con', allIds(next));
  next.connectors.push({
    id,
    label: '',
    from: { shapeId: source.id, port: ports.from },
    to: { shapeId: target.id, port: ports.to },
    points: routeConnector(source, ports.from, target, ports.to, next.shapes),
  });
  state.applyEdit(next, { movedShapeIds: [] });
  state.select([id], id);
  context.focusItem(id);
  announce(connectedAnnouncement(plainLabel(source.label), plainLabel(target.label)));
}

export function connectFromPort(
  context: EditorContext,
  sourceId: string,
  sourcePort: 'n' | 'e' | 's' | 'w',
  targetId: string,
): void {
  const { state } = context;
  if (!state.canEdit || sourceId === targetId) return;
  const next = clonePage(state.doc);
  const source = next.shapes.find((entry) => entry.id === sourceId);
  const target = next.shapes.find((entry) => entry.id === targetId);
  if (!source || !target) return;
  const from = portPoint(source, sourcePort);
  let bestPort: 'n' | 'e' | 's' | 'w' = 'n';
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const port of ['n', 'e', 's', 'w'] as const) {
    const point = portPoint(target, port);
    const distance = (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPort = port;
    }
  }
  const id = newItemId('con', allIds(next));
  next.connectors.push({
    id,
    label: '',
    from: { shapeId: source.id, port: sourcePort },
    to: { shapeId: target.id, port: bestPort },
    points: routeConnector(source, sourcePort, target, bestPort, next.shapes),
  });
  state.applyEdit(next, { movedShapeIds: [] });
  state.select([id], id);
  context.focusItem(id);
  announce(connectedAnnouncement(plainLabel(source.label), plainLabel(target.label)));
}
