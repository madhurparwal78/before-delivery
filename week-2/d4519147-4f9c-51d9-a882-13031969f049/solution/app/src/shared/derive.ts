import type { Connector, CrossingPoint, Derived, Direction, PageDoc, Point, Rect, Shape, Zone, ZoneDerived } from "./model.ts";

type Side = "inside" | "outside";
type Place = Side | "edge";

/** A shape belongs to a zone when its centre lies inside the zone or on its edge. Compared in doubled units so half-unit centres stay exact. */
function isMember(shape: Rect, zone: Rect): boolean {
  const cx2 = 2 * shape.x + shape.width;
  const cy2 = 2 * shape.y + shape.height;
  return cx2 >= 2 * zone.x && cx2 <= 2 * (zone.x + zone.width) && cy2 >= 2 * zone.y && cy2 <= 2 * (zone.y + zone.height);
}

function readingOrder(a: Shape, b: Shape): number {
  return a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function zoneMembers(zone: Zone, shapes: readonly Shape[]): Shape[] {
  return shapes.filter((s) => isMember(s, zone)).sort(readingOrder);
}

function place(x: number, y: number, z: Rect): Place {
  const x0 = z.x, x1 = z.x + z.width, y0 = z.y, y1 = z.y + z.height;
  if (x < x0 || x > x1 || y < y0 || y > y1) return "outside";
  if (x === x0 || x === x1 || y === y0 || y === y1) return "edge";
  return "inside";
}

interface Run {
  place: Place;
  end: Point;
}

/** Splits an axis-aligned segment into runs of constant place, in travel order. */
function segmentRuns(a: Point, b: Point, z: Rect): Run[] {
  const horizontal = a[1] === b[1];
  const from = horizontal ? a[0] : a[1];
  const to = horizontal ? b[0] : b[1];
  const cuts = horizontal ? [z.x, z.x + z.width] : [z.y, z.y + z.height];
  const at = (v: number): Point => (horizontal ? [v, a[1]] : [a[0], v]);
  const step = to >= from ? 1 : -1;
  const stops = cuts.filter((c) => (c - from) * step > 0 && (to - c) * step > 0).sort((p, q) => (p - q) * step);
  const runs: Run[] = [];
  let cursor = from;
  for (const c of [...stops, to]) {
    if (c !== cursor) {
      const mid = (cursor + c) / 2;
      const [mx, my] = at(mid);
      runs.push({ place: place(mx, my, z), end: at(c) });
    }
    const [cx, cy] = at(c);
    runs.push({ place: place(cx, cy, z), end: at(c) });
    cursor = c;
  }
  return runs;
}

/** Crossing points of one connector over one zone edge, in path order. */
function connectorCrossings(points: readonly Point[], zone: Zone): { x: number; y: number; direction: Direction }[] {
  const first = points[0];
  if (!first) return [];
  const runs: Run[] = [{ place: place(first[0], first[1], zone), end: first }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    runs.push(...segmentRuns(a, b, zone));
  }
  const found: { x: number; y: number; direction: Direction }[] = [];
  let side: Side | null = null;
  let lastEdge: Point | null = null;
  for (const run of runs) {
    if (run.place === "edge") {
      lastEdge = run.end;
      continue;
    }
    if (side !== null && run.place !== side && lastEdge) {
      found.push({ x: lastEdge[0], y: lastEdge[1], direction: run.place === "inside" ? "in" : "out" });
    }
    side = run.place;
    lastEdge = null;
  }
  return found;
}

function compareCrossing(a: CrossingPoint, b: CrossingPoint): number {
  return (a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0) || a.x - b.x || a.y - b.y;
}

/** Zone membership and boundary crossings derived from saved geometry. The single rule shared by browser and server. */
export function derivePage(doc: Pick<PageDoc, "zones" | "shapes" | "connectors">): Derived {
  const crossings: CrossingPoint[] = [];
  const zones: ZoneDerived[] = doc.zones.map((zone) => {
    const members = zoneMembers(zone, doc.shapes).map((s) => s.id);
    let count = 0;
    for (const c of doc.connectors) {
      for (const p of connectorCrossings(c.points, zone)) {
        crossings.push({ zoneId: zone.id, connectorId: c.id, ...p });
        count++;
      }
    }
    return { id: zone.id, systems: members.length, crossings: count, members };
  });
  crossings.sort(compareCrossing);
  return { zones, crossings };
}

/** The direction of travel just after a crossing point, used to point a marker's chevron. */
export function crossingHeading(connector: Connector, x: number, y: number): Point {
  const pts = connector.points;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const onSegment = (a[0] === b[0] && x === a[0] && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) ||
      (a[1] === b[1] && y === a[1] && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0]));
    if (onSegment && !(x === b[0] && y === b[1])) return [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
  }
  return [1, 0];
}
