import type {
  Connector,
  CrossingDirection,
  Derived,
  DerivedCrossing,
  PageDocument,
  Shape,
  Zone,
} from './types';
import type { Point, Rect } from './geometry';

/**
 * Zone membership, crossing points and crossing direction. The server runs this
 * inside the same transaction as a page save; the editor runs the same code to
 * show the result before the save answers.
 */

type Side = 'in' | 'out' | 'edge';

function classify(x: number, y: number, rect: Rect): Side {
  const x0 = rect.x;
  const x1 = rect.x + rect.width;
  const y0 = rect.y;
  const y1 = rect.y + rect.height;
  if (x < x0 || x > x1 || y < y0 || y > y1) return 'out';
  if (x === x0 || x === x1 || y === y0 || y === y1) return 'edge';
  return 'in';
}

interface Run {
  side: Side;
  lastPoint: Point | null;
}

/** The ordered runs of inside / outside / on-edge positions along a connector path. */
function pathRuns(points: ReadonlyArray<readonly [number, number]>, rect: Rect): Run[] {
  const runs: Run[] = [];
  const push = (side: Side, point: Point | null): void => {
    const last = runs[runs.length - 1];
    if (last && last.side === side) {
      if (point) last.lastPoint = point;
      return;
    }
    runs.push({ side, lastPoint: point });
  };

  const first = points[0];
  if (!first) return runs;
  push(classify(first[0], first[1], rect), { x: first[0], y: first[1] });

  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const horizontal = a[1] === b[1];
    const from = horizontal ? a[0] : a[1];
    const to = horizontal ? b[0] : b[1];
    const fixed = horizontal ? a[1] : a[0];
    const low = horizontal ? rect.x : rect.y;
    const high = horizontal ? rect.x + rect.width : rect.y + rect.height;
    const forward = to > from;
    const breaks = [low, high]
      .filter((value) => (forward ? value > from && value < to : value < from && value > to))
      .sort((p, q) => (forward ? p - q : q - p));
    let cursor = from;
    for (const stop of [...breaks, to]) {
      const mid = (cursor + stop) / 2;
      push(horizontal ? classify(mid, fixed, rect) : classify(fixed, mid, rect), null);
      const point = horizontal ? { x: stop, y: fixed } : { x: fixed, y: stop };
      push(classify(point.x, point.y, rect), point);
      cursor = stop;
    }
  }
  return runs;
}

export interface ConnectorCrossing {
  x: number;
  y: number;
  direction: CrossingDirection;
}

/** Every crossing of one zone's edge by one connector, in path order. */
export function connectorCrossings(connector: Connector, zone: Zone): ConnectorCrossing[] {
  const crossings: ConnectorCrossing[] = [];
  const runs = pathRuns(connector.points, zone);
  let previousSide: 'in' | 'out' | null = null;
  let edgeExit: Point | null = null;
  for (const run of runs) {
    if (run.side === 'edge') {
      edgeExit = run.lastPoint;
      continue;
    }
    if (previousSide !== null && previousSide !== run.side && edgeExit) {
      crossings.push({ x: edgeExit.x, y: edgeExit.y, direction: run.side === 'in' ? 'in' : 'out' });
    }
    previousSide = run.side;
    edgeExit = null;
  }
  return crossings;
}

/** A shape belongs to a zone when its centre lies inside the zone rectangle or on its edge. */
export function shapeInZone(shape: Shape, zone: Zone): boolean {
  const centreX2 = 2 * shape.x + shape.width;
  const centreY2 = 2 * shape.y + shape.height;
  return (
    centreX2 >= 2 * zone.x &&
    centreX2 <= 2 * (zone.x + zone.width) &&
    centreY2 >= 2 * zone.y &&
    centreY2 <= 2 * (zone.y + zone.height)
  );
}

export function zoneMembers(zone: Zone, shapes: readonly Shape[]): string[] {
  return shapes
    .filter((shape) => shapeInZone(shape, zone))
    .slice()
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((shape) => shape.id);
}

export function deriveFromPage(doc: PageDocument): Derived {
  const crossings: DerivedCrossing[] = [];
  const zones = doc.zones.map((zone) => {
    let count = 0;
    for (const connector of doc.connectors) {
      for (const crossing of connectorCrossings(connector, zone)) {
        crossings.push({
          zoneId: zone.id,
          connectorId: connector.id,
          x: crossing.x,
          y: crossing.y,
          direction: crossing.direction,
        });
        count += 1;
      }
    }
    const members = zoneMembers(zone, doc.shapes);
    return { id: zone.id, systems: members.length, crossings: count, members };
  });
  crossings.sort((a, b) => (a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0) || a.x - b.x || a.y - b.y);
  return { zones, crossings };
}

export function crossingsOfZone(derived: Derived, zoneId: string): DerivedCrossing[] {
  return derived.crossings.filter((crossing) => crossing.zoneId === zoneId);
}

export function derivedZone(derived: Derived, zoneId: string): { systems: number; crossings: number; members: string[] } {
  const zone = derived.zones.find((entry) => entry.id === zoneId);
  return zone ?? { systems: 0, crossings: 0, members: [] };
}
