import { zoneMembers } from "../../shared/derive.ts";
import { anyZonesTouch, closestPorts, elbowPath, portPoint, rerouteAttached, routeBetween, snapToGrid, zonesTouch } from "../../shared/geometry.ts";
import { plainLabel } from "../../shared/label.ts";
import { GRID, LIMITS, NEW_SHAPE_SIZE, NEW_ZONE_SIZE, SYSTEM_KINDS, ZONE_KINDS, type Connector, type PageDoc, type Point, type Shape, type SystemKind, type Zone, type ZoneKind } from "../../shared/model.ts";

type Ids = ReadonlySet<string>;

let counter = 0;
function freshId(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Selecting any member of a group selects the whole group. */
export function withGroups(doc: PageDoc, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  const groups = new Set(doc.shapes.filter((s) => out.has(s.id) && s.groupId).map((s) => s.groupId));
  for (const s of doc.shapes) if (s.groupId && groups.has(s.groupId)) out.add(s.id);
  return out;
}

/** Drops group ids left with fewer than two members. */
function normalizeGroups(shapes: Shape[]): Shape[] {
  const counts = new Map<string, number>();
  for (const s of shapes) if (s.groupId) counts.set(s.groupId, (counts.get(s.groupId) ?? 0) + 1);
  return shapes.map((s) => (s.groupId && (counts.get(s.groupId) ?? 0) < 2 ? { ...s, groupId: null } : s));
}

type Refusal = "overlap";

/**
 * Zone carry and overlap refusal: zones in the selection move with the shapes that were their members at the
 * start of the move (and those shapes' group mates); selected shapes move with their groups; each shape moves once.
 * A move that leaves two zones overlapping or touching is refused whole. A drag preview ("drag") is judged on drop and
 * draws attached connectors as plain elbows while the pointer moves.
 */
export function moveItems(doc: PageDoc, ids: Ids, dx: number, dy: number, routing: "full" | "drag" = "full"): PageDoc | Refusal {
  const zoneIds = new Set(doc.zones.filter((z) => ids.has(z.id)).map((z) => z.id));
  const carried = new Set<string>(doc.shapes.filter((s) => ids.has(s.id)).map((s) => s.id));
  for (const z of doc.zones) if (zoneIds.has(z.id)) for (const m of zoneMembers(z, doc.shapes)) carried.add(m.id);
  const moving = withGroups(doc, carried);
  const zones = doc.zones.map((z) => (zoneIds.has(z.id) ? { ...z, x: z.x + dx, y: z.y + dy } : z));
  if (routing === "full" && zoneIds.size && anyZonesTouch(zones)) return "overlap";
  const shapes = doc.shapes.map((s) => (moving.has(s.id) ? { ...s, x: s.x + dx, y: s.y + dy } : s));
  const next = { ...doc, zones, shapes };
  if (routing === "full") return { ...next, connectors: rerouteAttached(next, moving) };
  const byId = new Map(shapes.map((s) => [s.id, s]));
  return {
    ...next,
    connectors: doc.connectors.map((c) => {
      if (!moving.has(c.from.shapeId) && !moving.has(c.to.shapeId)) return c;
      return { ...c, points: elbowPath(portPoint(byId.get(c.from.shapeId)!, c.from.port), portPoint(byId.get(c.to.shapeId)!, c.to.port)) };
    }),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

/** Resizing a zone moves no shape; membership is recomputed by the derivation. */
export function resizeZone(doc: PageDoc, id: string, width: number, height: number): PageDoc | Refusal {
  const zones = doc.zones.map((z) => (z.id === id ? { ...z, width: clamp(width, LIMITS.zoneSize.min, LIMITS.zoneSize.max), height: clamp(height, LIMITS.zoneSize.min, LIMITS.zoneSize.max) } : z));
  if (anyZonesTouch(zones)) return "overlap";
  return { ...doc, zones };
}

export function resizeShape(doc: PageDoc, id: string, width: number, height: number): PageDoc {
  const shapes = doc.shapes.map((s) => (s.id === id ? { ...s, width: clamp(width, LIMITS.shapeSize.min, LIMITS.shapeSize.max), height: clamp(height, LIMITS.shapeSize.min, LIMITS.shapeSize.max) } : s));
  const next = { ...doc, shapes };
  return { ...next, connectors: rerouteAttached(next, new Set([id])) };
}

/** Top-left of an item centred on `center`, snapped to the 24-unit grid (halves round up). */
function placed(center: Point, size: { width: number; height: number }): Point {
  return [snapToGrid(center[0] - size.width / 2, GRID), snapToGrid(center[1] - size.height / 2, GRID)];
}

export function addShape(doc: PageDoc, kind: SystemKind, center: Point): { doc: PageDoc; id: string } {
  const [x, y] = placed(center, NEW_SHAPE_SIZE);
  const z = doc.shapes.reduce((m, s) => Math.max(m, s.z), 0) + 1;
  const shape: Shape = { id: freshId("shp"), kind, label: SYSTEM_KINDS[kind], x, y, ...NEW_SHAPE_SIZE, z, groupId: null };
  return { doc: { ...doc, shapes: [...doc.shapes, shape] }, id: shape.id };
}

/** A new zone that would overlap or touch another moves right in 24-unit steps until clear. */
export function addZone(doc: PageDoc, kind: ZoneKind, center: Point): { doc: PageDoc; id: string } {
  let [x, y] = placed(center, NEW_ZONE_SIZE);
  const zone = (): Zone => ({ id: "", kind, name: ZONE_KINDS[kind].defaultName, note: "", x, y, ...NEW_ZONE_SIZE });
  while (doc.zones.some((z) => zonesTouch(z, zone()))) x += GRID;
  const made = { ...zone(), id: freshId("zone") };
  return { doc: { ...doc, zones: [...doc.zones, made] }, id: made.id };
}

export function connect(doc: PageDoc, fromId: string, toId: string): { doc: PageDoc; id: string } {
  const a = doc.shapes.find((s) => s.id === fromId)!, b = doc.shapes.find((s) => s.id === toId)!;
  const [pa, pb] = closestPorts(a, b);
  const connector: Connector = { id: freshId("con"), label: "", from: { shapeId: a.id, port: pa }, to: { shapeId: b.id, port: pb }, points: routeBetween(a, pa, b, pb, doc.shapes) };
  return { doc: { ...doc, connectors: [...doc.connectors, connector] }, id: connector.id };
}

/** A connector dragged from a port: the target port is the one closest to the source port, ties north, east, south, west. */
export function connectFromPort(doc: PageDoc, fromId: string, port: Connector["from"]["port"], toId: string): { doc: PageDoc; id: string } {
  const a = doc.shapes.find((s) => s.id === fromId)!, b = doc.shapes.find((s) => s.id === toId)!;
  const [sx, sy] = portPoint(a, port);
  let best: Connector["to"]["port"] = "n";
  let bestD = Infinity;
  for (const p of ["n", "e", "s", "w"] as const) {
    const [tx, ty] = portPoint(b, p);
    const d = (tx - sx) ** 2 + (ty - sy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  const connector: Connector = { id: freshId("con"), label: "", from: { shapeId: a.id, port }, to: { shapeId: b.id, port: best }, points: routeBetween(a, port, b, best, doc.shapes) };
  return { doc: { ...doc, connectors: [...doc.connectors, connector] }, id: connector.id };
}

export function updateZone(doc: PageDoc, id: string, patch: Partial<Pick<Zone, "name" | "note" | "kind">>): PageDoc {
  return { ...doc, zones: doc.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)) };
}

export function updateShape(doc: PageDoc, id: string, patch: Partial<Pick<Shape, "label" | "kind">>): PageDoc {
  return { ...doc, shapes: doc.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function updateConnector(doc: PageDoc, id: string, label: string): PageDoc {
  return { ...doc, connectors: doc.connectors.map((c) => (c.id === id ? { ...c, label } : c)) };
}

export function group(doc: PageDoc, ids: Ids): PageDoc | null {
  const members = doc.shapes.filter((s) => ids.has(s.id));
  if (members.length < 2) return null;
  const groupId = freshId("grp");
  return { ...doc, shapes: doc.shapes.map((s) => (ids.has(s.id) ? { ...s, groupId } : s)) };
}

export function ungroup(doc: PageDoc, ids: Ids): PageDoc | null {
  if (!doc.shapes.some((s) => ids.has(s.id) && s.groupId)) return null;
  return { ...doc, shapes: doc.shapes.map((s) => (ids.has(s.id) ? { ...s, groupId: null } : s)) };
}

export type Edge = "left" | "right" | "top" | "bottom";

/** Units are each selected group (as its bounding box) and each ungrouped selected shape; zones are ignored. */
export function align(doc: PageDoc, ids: Ids, edge: Edge): PageDoc | null {
  const units = new Map<string, Shape[]>();
  for (const s of doc.shapes) if (ids.has(s.id)) units.set(s.groupId ?? `#${s.id}`, [...(units.get(s.groupId ?? `#${s.id}`) ?? []), s]);
  if (units.size < 2) return null;
  const box = (members: Shape[]) => ({
    left: Math.min(...members.map((m) => m.x)), right: Math.max(...members.map((m) => m.x + m.width)),
    top: Math.min(...members.map((m) => m.y)), bottom: Math.max(...members.map((m) => m.y + m.height)),
  });
  const boxes = [...units.values()].map(box);
  const target = edge === "left" || edge === "top" ? Math.min(...boxes.map((b) => b[edge])) : Math.max(...boxes.map((b) => b[edge]));
  const shift = new Map<string, number>();
  for (const members of units.values()) {
    const d = target - box(members)[edge];
    for (const m of members) shift.set(m.id, d);
  }
  const horizontal = edge === "left" || edge === "right";
  const shapes = doc.shapes.map((s) => (shift.has(s.id) && shift.get(s.id) !== 0 ? { ...s, x: s.x + (horizontal ? shift.get(s.id)! : 0), y: s.y + (horizontal ? 0 : shift.get(s.id)!) } : s));
  const moved = new Set([...shift].filter(([, d]) => d !== 0).map(([id]) => id));
  if (moved.size === 0) return null;
  const next = { ...doc, shapes };
  return { ...next, connectors: rerouteAttached(next, moved) };
}

const OFFSET = 24;

/** Copies offset by 24, 24 with fresh ids, z above every shape, fresh group ids; connectors copied only when both ends are selected. */
export function duplicate(doc: PageDoc, ids: Ids): { doc: PageDoc; ids: Set<string> } | null {
  const originals = doc.shapes.filter((s) => ids.has(s.id)).sort((a, b) => a.z - b.z);
  if (originals.length === 0) return null;
  let z = doc.shapes.reduce((m, s) => Math.max(m, s.z), 0);
  const idMap = new Map<string, string>();
  const groupMap = new Map<string, string>();
  const copies = originals.map((s) => {
    const id = freshId("shp");
    idMap.set(s.id, id);
    const groupId = s.groupId ? groupMap.get(s.groupId) ?? (groupMap.set(s.groupId, freshId("grp")), groupMap.get(s.groupId)!) : null;
    return { ...s, id, x: s.x + OFFSET, y: s.y + OFFSET, z: ++z, groupId };
  });
  const links = doc.connectors
    .filter((c) => idMap.has(c.from.shapeId) && idMap.has(c.to.shapeId))
    .map((c) => ({
      ...c, id: freshId("con"),
      from: { ...c.from, shapeId: idMap.get(c.from.shapeId)! },
      to: { ...c.to, shapeId: idMap.get(c.to.shapeId)! },
      points: c.points.map(([x, y]): Point => [x + OFFSET, y + OFFSET]),
    }));
  return { doc: { ...doc, shapes: normalizeGroups([...doc.shapes, ...copies]), connectors: [...doc.connectors, ...links] }, ids: new Set(copies.map((c) => c.id)) };
}

export type LayerDirection = "forward" | "backward";

/**
 * Layer order: one shape exchanges z with the next higher (forward) or lower (backward) shape. With several selected,
 * each is handled in turn (frontmost first for forward, backmost first for backward) and never exchanges with another selected shape.
 */
export function layer(doc: PageDoc, ids: Ids, direction: LayerDirection): { doc: PageDoc | null; sentence: string } | null {
  const selected = doc.shapes.filter((s) => ids.has(s.id));
  if (selected.length === 0) return null;
  const z = new Map(doc.shapes.map((s) => [s.id, s.z]));
  const order = [...selected].sort((a, b) => (direction === "forward" ? b.z - a.z : a.z - b.z));
  let movedAny = false;
  for (const s of order) {
    const mine = z.get(s.id)!;
    const others = doc.shapes.filter((o) => o.id !== s.id).map((o) => ({ id: o.id, z: z.get(o.id)! }));
    const neighbour = direction === "forward"
      ? others.filter((o) => o.z > mine).sort((a, b) => a.z - b.z)[0]
      : others.filter((o) => o.z < mine).sort((a, b) => b.z - a.z)[0];
    if (!neighbour || ids.has(neighbour.id)) continue;
    z.set(s.id, neighbour.z);
    z.set(neighbour.id, mine);
    movedAny = true;
  }
  const word = direction === "forward" ? "brought forward" : "sent backward";
  const limit = direction === "forward" ? "front" : "back";
  if (selected.length === 1) {
    const label = plainLabel(selected[0]!.label);
    if (!movedAny) return { doc: null, sentence: `${label} is already at the ${limit}.` };
    const k = [...z.values()].sort((a, b) => a - b).indexOf(z.get(selected[0]!.id)!) + 1;
    return { doc: { ...doc, shapes: doc.shapes.map((s) => ({ ...s, z: z.get(s.id)! })) }, sentence: `${label} ${word}. Layer ${k} of ${doc.shapes.length}.` };
  }
  if (!movedAny) return { doc: null, sentence: `${selected.length} shapes are already at the ${limit}.` };
  return { doc: { ...doc, shapes: doc.shapes.map((s) => ({ ...s, z: z.get(s.id)! })) }, sentence: `${selected.length} shapes ${word}.` };
}

/** Removes the selection and every connector attached to a removed shape. */
export function remove(doc: PageDoc, ids: Ids): PageDoc | null {
  if (![...doc.zones, ...doc.shapes, ...doc.connectors].some((i) => ids.has(i.id))) return null;
  const shapes = doc.shapes.filter((s) => !ids.has(s.id));
  const kept = new Set(shapes.map((s) => s.id));
  return {
    ...doc,
    zones: doc.zones.filter((z) => !ids.has(z.id)),
    shapes: normalizeGroups(shapes),
    connectors: doc.connectors.filter((c) => !ids.has(c.id) && kept.has(c.from.shapeId) && kept.has(c.to.shapeId)),
  };
}
