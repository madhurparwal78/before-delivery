// Shared page-edit rules used by the browser editor: placement, zone carry,
// overlap refusal, duplicate, align, and boundary announcements.

import {
  Connector, GRID, MAX_ZONES_PER_PAGE, NEW_SHAPE_HEIGHT, NEW_SHAPE_WIDTH, NEW_ZONE_HEIGHT,
  NEW_ZONE_WIDTH, PageDocument, Shape, SYSTEM_KINDS, SystemKindId, Zone, ZONE_KINDS, ZoneKindId,
} from './types.js';
import { derivePage, zoneContains, zonesOverlap } from './geometry.js';
import { plainLabel } from './labels.js';

// Snap the top-left corner to the nearest multiple of 24, halves rounding up.
export function snapToGrid(value: number): number {
  return Math.ceil(value / GRID) * GRID;
}

// Place a new item: centre on the given canvas point, then snap its top-left.
export function placedRect(cx: number, cy: number, width: number, height: number): { x: number; y: number } {
  return {
    x: snapToGrid(cx - width / 2),
    y: snapToGrid(cy - height / 2),
  };
}

// A new zone moves right in steps of 24 until clear of every zone.
export function settleZoneRect(zones: readonly Zone[], x: number, y: number, width: number, height: number): { x: number; y: number } {
  let px = x;
  let py = y;
  const rect = () => ({ x: px, y: py, width, height });
  let guard = 0;
  while (zones.some((z) => zonesOverlap(rect(), z)) && guard < 10000) {
    px += GRID;
    guard++;
  }
  return { x: px, y: py };
}

// Zone members judged at the start of a move: members plus their group mates.
export function carriedShapeIds(page: PageDocument, zone: Zone): Set<string> {
  const members = new Set(page.shapes.filter((s) => zoneContains(zone, s)).map((s) => s.id));
  const carried = new Set<string>(members);
  for (const s of page.shapes) {
    if (s.groupId !== null && !carried.has(s.id)) {
      const mateInside = page.shapes.some((m) => members.has(m.id) && m.groupId === s.groupId);
      if (mateInside) carried.add(s.id);
    }
  }
  return carried;
}

// Would a zone move or resize overlap or touch another zone?
export function zoneMoveOverlaps(page: Pick<PageDocument, 'zones'>, zoneId: string, rect: { x: number; y: number; width: number; height: number }): boolean {
  return page.zones.some((z) => z.id !== zoneId && zonesOverlap(rect, z));
}

// ---------------------------------------------------------------------------
// Duplicate: shapes only, copies offset by 24, 24; connectors whose both ends
// are selected are copied between the copies.

export interface DuplicateResult {
  shapes: Shape[];
  connectors: Connector[];
  newIds: string[];
}

export function freshId(prefix: string, taken: ReadonlySet<string>): string {
  let n = 1;
  let id = `${prefix}${n}`;
  while (taken.has(id)) {
    n++;
    id = `${prefix}${n}`;
  }
  return id;
}

export function duplicateSelection(page: PageDocument, selectedIds: ReadonlySet<string>): DuplicateResult {
  const selectedShapes = page.shapes.filter((s) => selectedIds.has(s.id));
  if (selectedShapes.length === 0) return { shapes: [...page.shapes], connectors: [...page.connectors], newIds: [] };
  const taken = new Set<string>([
    ...page.shapes.map((s) => s.id),
    ...page.zones.map((z) => z.id),
    ...page.connectors.map((c) => c.id),
  ]);
  const maxZ = Math.max(...page.shapes.map((s) => s.z));
  const idMap = new Map<string, string>();
  const newShapes: Shape[] = [];
  const groupMap = new Map<string, string>();
  for (const s of selectedShapes) {
    const id = freshId(`${s.id}-copy`, taken);
    taken.add(id);
    idMap.set(s.id, id);
    newShapes.push({ ...s, id, x: s.x + 24, y: s.y + 24, z: 0 });
  }
  // Copies take z values above every existing shape, keeping relative order.
  const byOld = [...selectedShapes].sort((a, b) => a.z - b.z);
  byOld.forEach((old, i) => {
    const copy = newShapes.find((c) => c.id === idMap.get(old.id));
    if (copy) copy.z = maxZ + 1 + i;
  });
  for (const s of selectedShapes) {
    const copy = newShapes.find((c) => c.id === idMap.get(s.id));
    if (copy && s.groupId !== null) {
      if (!groupMap.has(s.groupId)) groupMap.set(s.groupId, freshId(`${s.groupId}-copy`, taken));
      copy.groupId = groupMap.get(s.groupId) as string;
    } else if (copy) {
      copy.groupId = null;
    }
  }
  const newConnectors: Connector[] = [];
  for (const c of page.connectors) {
    if (!selectedIds.has(c.from.shapeId) || !selectedIds.has(c.to.shapeId)) continue;
    const id = freshId(`${c.id}-copy`, taken);
    taken.add(id);
    newConnectors.push({
      ...c,
      id,
      from: { ...c.from, shapeId: idMap.get(c.from.shapeId) as string },
      to: { ...c.to, shapeId: idMap.get(c.to.shapeId) as string },
      points: c.points.map((p) => [p[0] + 24, p[1] + 24] as [number, number]),
    });
  }
  return {
    shapes: [...page.shapes, ...newShapes],
    connectors: [...page.connectors, ...newConnectors],
    newIds: newShapes.map((s) => s.id),
  };
}

// ---------------------------------------------------------------------------
// Align: units are selected groups (bounding boxes) and ungrouped shapes.
// Zones are ignored. Fewer than two units changes nothing.

export interface AlignUnit {
  ids: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export function alignUnits(page: Pick<PageDocument, 'shapes'>, selectedIds: ReadonlySet<string>): AlignUnit[] {
  const selected = page.shapes.filter((s) => selectedIds.has(s.id));
  const byGroup = new Map<string, Shape[]>();
  for (const s of selected) {
    const key = s.groupId ?? `__solo_${s.id}`;
    const list = byGroup.get(key) ?? [];
    list.push(s);
    byGroup.set(key, list);
  }
  const units: AlignUnit[] = [];
  for (const list of byGroup.values()) {
    const x = Math.min(...list.map((s) => s.x));
    const y = Math.min(...list.map((s) => s.y));
    units.push({
      ids: list.map((s) => s.id),
      x,
      y,
      width: Math.max(...list.map((s) => s.x + s.width)) - x,
      height: Math.max(...list.map((s) => s.y + s.height)) - y,
    });
  }
  return units;
}

export type AlignEdge = 'left' | 'right' | 'top' | 'bottom';

export function alignSelection(
  page: PageDocument,
  selectedIds: ReadonlySet<string>,
  edge: AlignEdge,
): { shapes: Shape[]; changed: boolean } {
  const units = alignUnits(page, selectedIds);
  if (units.length < 2) return { shapes: [...page.shapes], changed: false };
  const target = edge === 'left' ? Math.min(...units.map((u) => u.x))
    : edge === 'right' ? Math.max(...units.map((u) => u.x + u.width))
    : edge === 'top' ? Math.min(...units.map((u) => u.y))
    : Math.max(...units.map((u) => u.y + u.height));
  const working = page.shapes.map((s) => ({ ...s }));
  let changed = false;
  for (const unit of units) {
    const dx = edge === 'left' ? target - unit.x : edge === 'right' ? target - (unit.x + unit.width) : 0;
    const dy = edge === 'top' ? target - unit.y : edge === 'bottom' ? target - (unit.y + unit.height) : 0;
    if (dx === 0 && dy === 0) continue;
    for (const id of unit.ids) {
      const s = working.find((w) => w.id === id);
      if (s) { s.x += dx; s.y += dy; changed = true; }
    }
  }
  return { shapes: working, changed };
}

// ---------------------------------------------------------------------------
// Boundary tally announcements, derived from before and after states.

export interface TallyAnnouncementInput {
  pageBefore: PageDocument;
  pageAfter: PageDocument;
  movedShapeIds: string[];
  movedZoneId: string | null;
  zoneResized: boolean;
}

interface Tally {
  systems: number;
  crossings: number;
}

function tallies(page: PageDocument): Map<string, Tally> {
  return new Map(derivePage(page).zones.map((z) => [z.id, { systems: z.systems, crossings: z.crossings }]));
}

function zoneName(page: PageDocument, id: string): string {
  return page.zones.find((z) => z.id === id)?.name ?? id;
}

function tallySentence(n: number, m: number): string {
  const s = n === 1 ? 'system' : 'systems';
  const c = m === 1 ? 'crossing' : 'crossings';
  return `${n} ${s}, ${m} ${c}`;
}

// The boundary announcements for one edit, in the published order: shape
// sentences first, then the zone sentence, then updated sentences in zone order.
export function boundaryAnnouncements(input: TallyAnnouncementInput): string[] {
  const before = tallies(input.pageBefore);
  const after = tallies(input.pageAfter);
  const movedShapeSentences: string[] = [];
  const movedShapes = input.movedShapeIds
    .map((id) => input.pageAfter.shapes.find((s) => s.id === id) ?? input.pageBefore.shapes.find((s) => s.id === id))
    .filter((s): s is Shape => s !== undefined)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const shape of movedShapes) {
    const label = plainLabel(shape.label);
    const beforeShape = input.pageBefore.shapes.find((s) => s.id === shape.id) ?? shape;
    const inBefore = new Set(input.pageBefore.zones.filter((z) => zoneContains(z, beforeShape)).map((z) => z.id));
    const inAfter = new Set(input.pageAfter.zones.filter((z) => zoneContains(z, shape)).map((z) => z.id));
    if (inBefore.size === inAfter.size && [...inBefore].every((id) => inAfter.has(id))) continue;
    for (const zid of input.pageAfter.zones.map((z) => z.id)) {
      const was = inBefore.has(zid);
      const now = inAfter.has(zid);
      if (!was && now) {
        const t = after.get(zid);
        if (t) movedShapeSentences.push(`${label} moved into ${zoneName(input.pageAfter, zid)}. ${tallySentence(t.systems, t.crossings)}.`);
      } else if (was && !now && inAfter.size === 0) {
        const t = after.get(zid);
        if (t) movedShapeSentences.push(`${label} moved out of ${zoneName(input.pageBefore, zid)}. ${tallySentence(t.systems, t.crossings)}.`);
      }
    }
  }
  const changedZones = [...after.keys()].filter((zid) => {
    const b = before.get(zid);
    const a = after.get(zid);
    return b !== undefined && a !== undefined && (b.systems !== a.systems || b.crossings !== a.crossings);
  });
  const sentences: string[] = [...movedShapeSentences];
  const named = new Set<string>();
  if (input.movedZoneId) {
    const zid = input.movedZoneId;
    const a = after.get(zid);
    const b = before.get(zid);
    if (a && b && (a.systems !== b.systems || a.crossings !== b.crossings)) {
      sentences.push(`${zoneName(input.pageAfter, zid)} ${input.zoneResized ? 'resized' : 'moved'}. ${tallySentence(a.systems, a.crossings)}.`);
      named.add(zid);
    }
  }
  for (const zid of changedZones) {
    if (named.has(zid)) continue;
    const a = after.get(zid);
    if (a) sentences.push(`${zoneName(input.pageAfter, zid)} updated. ${tallySentence(a.systems, a.crossings)}.`);
  }
  return sentences;
}

// The visible zone tally: `<n> systems · <m> crossings`.
export function tallyText(systems: number, crossings: number): string {
  const s = systems === 1 ? 'system' : 'systems';
  const c = crossings === 1 ? 'crossing' : 'crossings';
  return `${systems} ${s} · ${crossings} ${c}`;
}

export function newShapeDefaults(kind: SystemKindId): Pick<Shape, 'kind' | 'label' | 'width' | 'height'> {
  return { kind, label: SYSTEM_KINDS[kind], width: NEW_SHAPE_WIDTH, height: NEW_SHAPE_HEIGHT };
}

export function newZoneDefaults(kind: ZoneKindId): Pick<Zone, 'kind' | 'name' | 'width' | 'height'> {
  return { kind, name: ZONE_KINDS[kind].defaultName, width: NEW_ZONE_WIDTH, height: NEW_ZONE_HEIGHT };
}

export function zoneLimitReached(page: Pick<PageDocument, 'zones'>): boolean {
  return page.zones.length >= MAX_ZONES_PER_PAGE;
}
