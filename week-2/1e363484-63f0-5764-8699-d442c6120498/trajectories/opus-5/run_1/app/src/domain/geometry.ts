import { divideRounded, type Dec } from './decimal';

export type Point = readonly [number, number];
export type Ring = readonly Point[];

/** A non-vertical polygon edge, left endpoint first. */
type Edge = readonly [number, number, number, number];

function shoelace(ring: Ring): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[(index + 1) % ring.length]!;
    total += from[0] * to[1] - to[0] * from[1];
  }
  return Math.abs(total) / 2;
}

function roundHalfEvenToWholeMetres(area: number): bigint {
  const floor = Math.floor(area);
  const fraction = area - floor;
  if (fraction > 0.5) return BigInt(floor + 1);
  if (fraction < 0.5) return BigInt(floor);
  return BigInt(floor % 2 === 0 ? floor : floor + 1);
}

export function polygonArea(ring: Ring): bigint {
  return roundHalfEvenToWholeMetres(shoelace(ring));
}

function edgesOf(ring: Ring): Edge[] {
  const edges: Edge[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const from = ring[index]!;
    const to = ring[(index + 1) % ring.length]!;
    if (from[0] === to[0]) continue;
    edges.push(
      from[0] < to[0] ? [from[0], from[1], to[0], to[1]] : [to[0], to[1], from[0], from[1]],
    );
  }
  return edges;
}

function yAt(edge: Edge, x: number): number {
  const [x1, y1, x2, y2] = edge;
  return y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
}

function spans(edge: Edge, left: number, right: number): boolean {
  return edge[0] <= left && edge[2] >= right;
}

function crossingX(a: Edge, b: Edge): number | null {
  const slopeA = (a[3] - a[1]) / (a[2] - a[0]);
  const slopeB = (b[3] - b[1]) / (b[2] - b[0]);
  if (slopeA === slopeB) return null;
  const x = (b[1] - a[1] + slopeA * a[0] - slopeB * b[0]) / (slopeA - slopeB);
  if (!Number.isFinite(x)) return null;
  if (x <= Math.max(a[0], b[0]) || x >= Math.min(a[2], b[2])) return null;
  return x;
}

/** Ray casting: true when the point lies inside the simple polygon. */
function contains(ring: Ring, x: number, y: number): boolean {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index, index += 1
  ) {
    const current = ring[index]!;
    const before = ring[previous]!;
    if (current[1] > y !== before[1] > y) {
      const crossing =
        current[0] + ((y - current[1]) * (before[0] - current[0])) / (before[1] - current[1]);
      if (x < crossing) inside = !inside;
    }
  }
  return inside;
}

export interface AreaCandidate {
  readonly id: string;
  readonly polygon: Ring;
}

/**
 * Allocates boundary ground to candidates in the order given. Every edge of the boundary and
 * the candidate polygons cuts the plane into vertical slabs, and each strip of ground within a
 * slab falls to the first candidate that covers it, so no ground is ever counted twice.
 */
export function allocateAreas(
  boundary: Ring,
  candidates: readonly AreaCandidate[],
): Map<string, bigint> {
  if (candidates.length === 0) return new Map();
  const totals = new Map<string, number>(candidates.map((candidate) => [candidate.id, 0]));

  const rings = [boundary, ...candidates.map((candidate) => candidate.polygon)];
  const edges = rings.flatMap(edgesOf);
  const boundaryXs = boundary.map((point) => point[0]);
  const minX = Math.min(...boundaryXs);
  const maxX = Math.max(...boundaryXs);

  const cuts = new Set<number>([minX, maxX]);
  for (const ring of rings) {
    for (const point of ring) {
      if (point[0] > minX && point[0] < maxX) cuts.add(point[0]);
    }
  }
  for (let left = 0; left < edges.length; left += 1) {
    for (let right = left + 1; right < edges.length; right += 1) {
      const x = crossingX(edges[left]!, edges[right]!);
      if (x !== null && x > minX && x < maxX) cuts.add(x);
    }
  }
  const slabs = [...cuts].sort((a, b) => a - b);

  for (let index = 0; index + 1 < slabs.length; index += 1) {
    const left = slabs[index]!;
    const right = slabs[index + 1]!;
    const width = right - left;
    if (width <= 0) continue;
    const middle = (left + right) / 2;
    const crossings = edges
      .filter((edge) => spans(edge, left, right))
      .map((edge) => ({
        atLeft: yAt(edge, left),
        atRight: yAt(edge, right),
        atMiddle: yAt(edge, middle),
      }))
      .sort((a, b) => a.atMiddle - b.atMiddle);

    for (let strip = 0; strip + 1 < crossings.length; strip += 1) {
      const lower = crossings[strip]!;
      const upper = crossings[strip + 1]!;
      if (upper.atMiddle - lower.atMiddle <= 0) continue;
      const centre = (lower.atMiddle + upper.atMiddle) / 2;
      if (!contains(boundary, middle, centre)) continue;
      const owner = candidates.find((candidate) => contains(candidate.polygon, middle, centre));
      if (owner === undefined) continue;
      const area = ((upper.atLeft - lower.atLeft + (upper.atRight - lower.atRight)) / 2) * width;
      totals.set(owner.id, totals.get(owner.id)! + area);
    }
  }

  return new Map([...totals].map(([id, area]) => [id, roundHalfEvenToWholeMetres(area)]));
}

/** Coverage as a percentage of the boundary area, rounded half to even to one decimal. */
export function coveragePercent(coveredM2: bigint, boundaryAreaM2: bigint): Dec {
  return divideRounded(coveredM2 * 100n, boundaryAreaM2, 1);
}
