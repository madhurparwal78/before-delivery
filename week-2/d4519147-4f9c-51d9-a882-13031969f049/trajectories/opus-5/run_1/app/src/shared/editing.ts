import { anyZonesOverlap, dedupePoints, rerouteConnectorsFor } from './geometry';
import type { Connector, PageDocument, PointTuple, Shape, Zone } from './types';
import { zoneMembers } from './derive';

export function clonePage(doc: PageDocument): PageDocument {
  return {
    id: doc.id,
    name: doc.name,
    version: doc.version,
    zones: doc.zones.map((zone) => ({ ...zone })),
    shapes: doc.shapes.map((shape) => ({ ...shape })),
    connectors: doc.connectors.map((connector) => ({
      ...connector,
      from: { ...connector.from },
      to: { ...connector.to },
      points: connector.points.map((point) => [point[0], point[1]] as PointTuple),
    })),
  };
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newItemId(prefix: string, taken: ReadonlySet<string>): string {
  for (;;) {
    const bytes = new Uint8Array(6);
    globalThis.crypto.getRandomValues(bytes);
    let suffix = '';
    for (const byte of bytes) suffix += ID_ALPHABET[byte % ID_ALPHABET.length];
    const id = `${prefix}-${suffix}`;
    if (!taken.has(id)) return id;
  }
}

export function allIds(doc: PageDocument): Set<string> {
  return new Set<string>([
    ...doc.zones.map((zone) => zone.id),
    ...doc.shapes.map((shape) => shape.id),
    ...doc.connectors.map((connector) => connector.id),
  ]);
}

export function highestZ(doc: PageDocument): number {
  return doc.shapes.reduce((highest, shape) => Math.max(highest, shape.z), 0);
}

/** Selecting any member of a group selects the whole group. */
export function expandSelection(doc: PageDocument, ids: Iterable<string>): Set<string> {
  const selection = new Set<string>(ids);
  const groupIds = new Set<string>();
  for (const shape of doc.shapes) {
    if (shape.groupId && selection.has(shape.id)) groupIds.add(shape.groupId);
  }
  for (const shape of doc.shapes) {
    if (shape.groupId && groupIds.has(shape.groupId)) selection.add(shape.id);
  }
  return selection;
}

/**
 * The shapes a move takes with it: the selected shapes, the members of every
 * selected zone (judged before the move) and anything grouped with those.
 * Each shape moves exactly once.
 */
export function carriedShapeIds(doc: PageDocument, selection: ReadonlySet<string>): Set<string> {
  const shapeIds = new Set<string>();
  for (const shape of doc.shapes) {
    if (selection.has(shape.id)) shapeIds.add(shape.id);
  }
  for (const zone of doc.zones) {
    if (!selection.has(zone.id)) continue;
    for (const memberId of zoneMembers(zone, doc.shapes)) shapeIds.add(memberId);
  }
  const groupIds = new Set<string>();
  for (const shape of doc.shapes) {
    if (shape.groupId && shapeIds.has(shape.id)) groupIds.add(shape.groupId);
  }
  for (const shape of doc.shapes) {
    if (shape.groupId && groupIds.has(shape.groupId)) shapeIds.add(shape.id);
  }
  return shapeIds;
}

export interface MoveOutcome {
  ok: boolean;
  doc: PageDocument;
  movedZoneIds: Set<string>;
  movedShapeIds: Set<string>;
}

/**
 * Moves the selection, carrying each selected zone's members. A zone move that
 * would leave two zones overlapping or touching is refused whole.
 */
export function translateSelection(
  doc: PageDocument,
  selection: ReadonlySet<string>,
  dx: number,
  dy: number,
): MoveOutcome {
  const movedShapeIds = carriedShapeIds(doc, selection);
  const movedZoneIds = new Set<string>(doc.zones.filter((zone) => selection.has(zone.id)).map((zone) => zone.id));
  if (movedShapeIds.size === 0 && movedZoneIds.size === 0) {
    return { ok: false, doc, movedZoneIds, movedShapeIds };
  }
  const next = clonePage(doc);
  for (const zone of next.zones) {
    if (movedZoneIds.has(zone.id)) {
      zone.x += dx;
      zone.y += dy;
    }
  }
  if (movedZoneIds.size > 0 && anyZonesOverlap(next.zones)) {
    return { ok: false, doc, movedZoneIds, movedShapeIds };
  }
  for (const shape of next.shapes) {
    if (movedShapeIds.has(shape.id)) {
      shape.x += dx;
      shape.y += dy;
    }
  }
  rerouteConnectorsFor(next, movedShapeIds);
  return { ok: true, doc: next, movedZoneIds, movedShapeIds };
}

/** Resizes a zone from its top-left corner. No shape moves. */
export function resizeZone(doc: PageDocument, zoneId: string, width: number, height: number): MoveOutcome {
  const next = clonePage(doc);
  const zone = next.zones.find((entry) => entry.id === zoneId);
  if (!zone) return { ok: false, doc, movedZoneIds: new Set(), movedShapeIds: new Set() };
  zone.width = width;
  zone.height = height;
  if (anyZonesOverlap(next.zones)) {
    return { ok: false, doc, movedZoneIds: new Set([zoneId]), movedShapeIds: new Set() };
  }
  return { ok: true, doc: next, movedZoneIds: new Set([zoneId]), movedShapeIds: new Set() };
}

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom';

interface AlignUnit {
  shapeIds: string[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function alignUnits(doc: PageDocument, selection: ReadonlySet<string>): AlignUnit[] {
  const groups = new Map<string, AlignUnit>();
  const singles: AlignUnit[] = [];
  for (const shape of doc.shapes) {
    if (!selection.has(shape.id)) continue;
    const unit: AlignUnit = {
      shapeIds: [shape.id],
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + shape.width,
      maxY: shape.y + shape.height,
    };
    if (shape.groupId) {
      const existing = groups.get(shape.groupId);
      if (existing) {
        existing.shapeIds.push(shape.id);
        existing.minX = Math.min(existing.minX, unit.minX);
        existing.minY = Math.min(existing.minY, unit.minY);
        existing.maxX = Math.max(existing.maxX, unit.maxX);
        existing.maxY = Math.max(existing.maxY, unit.maxY);
      } else {
        groups.set(shape.groupId, unit);
      }
    } else {
      singles.push(unit);
    }
  }
  return [...groups.values(), ...singles];
}

/** Aligns each selected group (as one rigid box) and each selected ungrouped shape. */
export function alignSelection(doc: PageDocument, selection: ReadonlySet<string>, edge: AlignEdge): MoveOutcome {
  const units = alignUnits(doc, selection);
  if (units.length < 2) return { ok: false, doc, movedZoneIds: new Set(), movedShapeIds: new Set() };
  let target: number;
  switch (edge) {
    case 'left':
      target = Math.min(...units.map((unit) => unit.minX));
      break;
    case 'right':
      target = Math.max(...units.map((unit) => unit.maxX));
      break;
    case 'top':
      target = Math.min(...units.map((unit) => unit.minY));
      break;
    case 'bottom':
      target = Math.max(...units.map((unit) => unit.maxY));
      break;
  }
  const next = clonePage(doc);
  const shapeById = new Map(next.shapes.map((shape) => [shape.id, shape]));
  const movedShapeIds = new Set<string>();
  for (const unit of units) {
    let dx = 0;
    let dy = 0;
    if (edge === 'left') dx = target - unit.minX;
    if (edge === 'right') dx = target - unit.maxX;
    if (edge === 'top') dy = target - unit.minY;
    if (edge === 'bottom') dy = target - unit.maxY;
    if (dx === 0 && dy === 0) continue;
    for (const shapeId of unit.shapeIds) {
      const shape = shapeById.get(shapeId);
      if (!shape) continue;
      shape.x += dx;
      shape.y += dy;
      movedShapeIds.add(shapeId);
    }
  }
  if (movedShapeIds.size === 0) return { ok: false, doc, movedZoneIds: new Set(), movedShapeIds };
  rerouteConnectorsFor(next, movedShapeIds);
  return { ok: true, doc: next, movedZoneIds: new Set(), movedShapeIds };
}

export interface DuplicateOutcome {
  ok: boolean;
  doc: PageDocument;
  newShapeIds: string[];
}

/** Duplicates the selected shapes, offset by 24, 24, above every existing shape. */
export function duplicateSelection(doc: PageDocument, selection: ReadonlySet<string>): DuplicateOutcome {
  const originals = doc.shapes.filter((shape) => selection.has(shape.id));
  if (originals.length === 0) return { ok: false, doc, newShapeIds: [] };
  const next = clonePage(doc);
  const taken = allIds(next);
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const ordered = originals.slice().sort((a, b) => a.z - b.z);
  let z = highestZ(next);
  const newShapeIds: string[] = [];
  for (const shape of ordered) {
    const id = newItemId('shp', taken);
    taken.add(id);
    idMap.set(shape.id, id);
    let groupId: string | null = null;
    if (shape.groupId) {
      const mapped = groupMap.get(shape.groupId) ?? newItemId('grp', taken);
      groupMap.set(shape.groupId, mapped);
      taken.add(mapped);
      groupId = mapped;
    }
    z += 1;
    const copy: Shape = {
      ...shape,
      id,
      x: shape.x + 24,
      y: shape.y + 24,
      z,
      groupId,
    };
    next.shapes.push(copy);
    newShapeIds.push(id);
  }
  for (const connector of doc.connectors) {
    const fromId = idMap.get(connector.from.shapeId);
    const toId = idMap.get(connector.to.shapeId);
    if (!fromId || !toId) continue;
    const id = newItemId('con', taken);
    taken.add(id);
    const copy: Connector = {
      id,
      label: connector.label,
      from: { shapeId: fromId, port: connector.from.port },
      to: { shapeId: toId, port: connector.to.port },
      points: connector.points.map(([x, y]) => [x + 24, y + 24] as PointTuple),
    };
    next.connectors.push(copy);
  }
  return { ok: true, doc: next, newShapeIds };
}

export interface LayerOutcome {
  ok: boolean;
  doc: PageDocument;
  movedShapeIds: string[];
}

/** Bring forward and send backward, exchanging z with the neighbouring unselected shape. */
export function changeLayer(
  doc: PageDocument,
  selection: ReadonlySet<string>,
  direction: 'forward' | 'backward',
): LayerOutcome {
  const selected = doc.shapes.filter((shape) => selection.has(shape.id));
  if (selected.length === 0) return { ok: false, doc, movedShapeIds: [] };
  const next = clonePage(doc);
  const order = direction === 'forward' ? (a: Shape, b: Shape) => b.z - a.z : (a: Shape, b: Shape) => a.z - b.z;
  const queue = next.shapes.filter((shape) => selection.has(shape.id)).sort(order);
  const movedShapeIds: string[] = [];
  for (const shape of queue) {
    let partner: Shape | null = null;
    for (const other of next.shapes) {
      if (selection.has(other.id)) continue;
      if (direction === 'forward' ? other.z > shape.z : other.z < shape.z) {
        if (!partner || (direction === 'forward' ? other.z < partner.z : other.z > partner.z)) partner = other;
      }
    }
    if (!partner) continue;
    const shapeZ = shape.z;
    shape.z = partner.z;
    partner.z = shapeZ;
    movedShapeIds.push(shape.id);
  }
  if (movedShapeIds.length === 0) return { ok: false, doc, movedShapeIds: [] };
  return { ok: true, doc: next, movedShapeIds };
}

/** The shape's 1-based position counted from the back. */
export function layerPosition(doc: PageDocument, shapeId: string): number {
  const sorted = doc.shapes.slice().sort((a, b) => a.z - b.z);
  return sorted.findIndex((shape) => shape.id === shapeId) + 1;
}

export function groupSelection(doc: PageDocument, selection: ReadonlySet<string>): { ok: boolean; doc: PageDocument } {
  const members = doc.shapes.filter((shape) => selection.has(shape.id));
  if (members.length < 2) return { ok: false, doc };
  const next = clonePage(doc);
  const groupId = newItemId('grp', allIds(next));
  for (const shape of next.shapes) {
    if (selection.has(shape.id)) shape.groupId = groupId;
  }
  return { ok: true, doc: next };
}

export function ungroupSelection(doc: PageDocument, selection: ReadonlySet<string>): { ok: boolean; doc: PageDocument } {
  const members = doc.shapes.filter((shape) => selection.has(shape.id) && shape.groupId);
  if (members.length === 0) return { ok: false, doc };
  const next = clonePage(doc);
  for (const shape of next.shapes) {
    if (selection.has(shape.id)) shape.groupId = null;
  }
  return { ok: true, doc: next };
}

/** Deletes the selection, with every connector attached to a removed shape. */
export function deleteSelection(doc: PageDocument, selection: ReadonlySet<string>): { ok: boolean; doc: PageDocument } {
  const removedShapes = new Set(doc.shapes.filter((shape) => selection.has(shape.id)).map((shape) => shape.id));
  const removedZones = new Set(doc.zones.filter((zone) => selection.has(zone.id)).map((zone) => zone.id));
  const removedConnectors = new Set(
    doc.connectors
      .filter(
        (connector) =>
          selection.has(connector.id) ||
          removedShapes.has(connector.from.shapeId) ||
          removedShapes.has(connector.to.shapeId),
      )
      .map((connector) => connector.id),
  );
  if (removedShapes.size === 0 && removedZones.size === 0 && removedConnectors.size === 0) {
    return { ok: false, doc };
  }
  const next = clonePage(doc);
  next.shapes = next.shapes.filter((shape) => !removedShapes.has(shape.id));
  next.zones = next.zones.filter((zone) => !removedZones.has(zone.id));
  next.connectors = next.connectors.filter((connector) => !removedConnectors.has(connector.id));
  const orphanedGroups = new Map<string, number>();
  for (const shape of next.shapes) {
    if (shape.groupId) orphanedGroups.set(shape.groupId, (orphanedGroups.get(shape.groupId) ?? 0) + 1);
  }
  for (const shape of next.shapes) {
    if (shape.groupId && (orphanedGroups.get(shape.groupId) ?? 0) < 2) shape.groupId = null;
  }
  return { ok: true, doc: next };
}

/** Reading order of every canvas item: by top-left corner, top to bottom then left to right. */
export function readingOrder(doc: PageDocument): Array<{ kind: 'zone' | 'shape' | 'connector'; id: string }> {
  const entries: Array<{ kind: 'zone' | 'shape' | 'connector'; id: string; x: number; y: number }> = [];
  for (const zone of doc.zones) entries.push({ kind: 'zone', id: zone.id, x: zone.x, y: zone.y });
  for (const shape of doc.shapes) entries.push({ kind: 'shape', id: shape.id, x: shape.x, y: shape.y });
  for (const connector of doc.connectors) {
    const first = connector.points[0];
    entries.push({ kind: 'connector', id: connector.id, x: first ? first[0] : 0, y: first ? first[1] : 0 });
  }
  entries.sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return entries.map((entry) => ({ kind: entry.kind, id: entry.id }));
}

/** Moves a new zone right in steps of 24 units until it is clear of every zone. */
export function placeZoneClear(zones: Zone[], candidate: Zone): Zone {
  const placed = { ...candidate };
  for (;;) {
    const clash = zones.some(
      (zone) =>
        zone.id !== placed.id &&
        placed.x <= zone.x + zone.width &&
        zone.x <= placed.x + placed.width &&
        placed.y <= zone.y + zone.height &&
        zone.y <= placed.y + placed.height,
    );
    if (!clash) return placed;
    placed.x += 24;
  }
}

export function normalizeConnectorPoints(points: PointTuple[]): PointTuple[] {
  return dedupePoints(points);
}
