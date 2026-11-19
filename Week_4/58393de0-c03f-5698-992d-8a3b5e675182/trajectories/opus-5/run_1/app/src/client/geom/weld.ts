import type { Mesh, Triangle, Vec3 } from './mesh.js';

const GRID = 1e-4;

const keyOf = (point: Vec3): string =>
  `${Math.round(point[0] / GRID)},${Math.round(point[1] / GRID)},${Math.round(point[2] / GRID)}`;

const snap = (point: Vec3): Vec3 => [
  Math.round(point[0] / GRID) * GRID,
  Math.round(point[1] / GRID) * GRID,
  Math.round(point[2] / GRID) * GRID,
];

const edgeKey = (from: string, to: string): string => (from < to ? `${from}|${to}` : `${to}|${from}`);

const edgeCounts = (triangles: Triangle[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const triangle of triangles) {
    const corners = [triangle.a, triangle.b, triangle.c].map(keyOf);
    for (let index = 0; index < 3; index += 1) {
      const key = edgeKey(corners[index], corners[(index + 1) % 3]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
};

const onSegment = (a: Vec3, b: Vec3, p: Vec3): boolean => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const abz = b[2] - a[2];
  const length = Math.hypot(abx, aby, abz);
  if (length < GRID * 4) return false;
  const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby + (p[2] - a[2]) * abz) / (length * length);
  if (t <= 1e-9 || t >= 1 - 1e-9) return false;
  const dx = a[0] + abx * t - p[0];
  const dy = a[1] + aby * t - p[1];
  const dz = a[2] + abz * t - p[2];
  return Math.hypot(dx, dy, dz) < GRID;
};

interface VertexIndex {
  near: (a: Vec3, b: Vec3) => Vec3[];
}

const buildIndex = (vertices: Vec3[]): VertexIndex => {
  const cellSize = 2;
  const cells = new Map<string, Vec3[]>();
  const cellKey = (point: Vec3): string =>
    `${Math.floor(point[0] / cellSize)},${Math.floor(point[1] / cellSize)},${Math.floor(point[2] / cellSize)}`;
  for (const vertex of vertices) {
    const key = cellKey(vertex);
    const bucket = cells.get(key);
    if (bucket) bucket.push(vertex);
    else cells.set(key, [vertex]);
  }
  return {
    near: (a, b) => {
      const found: Vec3[] = [];
      const range = (axis: number): [number, number] => [
        Math.floor(Math.min(a[axis], b[axis]) / cellSize) - 1,
        Math.floor(Math.max(a[axis], b[axis]) / cellSize) + 1,
      ];
      const [minX, maxX] = range(0);
      const [minY, maxY] = range(1);
      const [minZ, maxZ] = range(2);
      for (let x = minX; x <= maxX; x += 1) {
        for (let y = minY; y <= maxY; y += 1) {
          for (let z = minZ; z <= maxZ; z += 1) {
            const bucket = cells.get(`${x},${y},${z}`);
            if (bucket) found.push(...bucket);
          }
        }
      }
      return found;
    },
  };
};

/** Splits any edge that another vertex sits on, so neighbours share whole edges. */
const splitTJunctions = (triangles: Triangle[], index: VertexIndex): Triangle[] => {
  const output: Triangle[] = [];
  const queue = [...triangles];
  let guard = 0;
  while (queue.length > 0 && guard < 2_000_000) {
    guard += 1;
    const triangle = queue.pop() as Triangle;
    const edges: [Vec3, Vec3, Vec3][] = [
      [triangle.a, triangle.b, triangle.c],
      [triangle.b, triangle.c, triangle.a],
      [triangle.c, triangle.a, triangle.b],
    ];
    let split = false;
    for (const [from, to, apex] of edges) {
      const candidate = index.near(from, to).find((vertex) => onSegment(from, to, vertex));
      if (!candidate) continue;
      queue.push({ a: from, b: candidate, c: apex }, { a: candidate, b: to, c: apex });
      split = true;
      break;
    }
    if (!split) output.push(triangle);
  }
  return output;
};

/** Each unmatched edge belongs to a loop, and the loop is covered by a fan from its centre. */
const fillBoundaryLoops = (triangles: Triangle[]): Triangle[] => {
  const counts = edgeCounts(triangles);
  const points = new Map<string, Vec3>();
  const directed: [string, string][] = [];
  for (const triangle of triangles) {
    const corners: [Vec3, Vec3, Vec3] = [triangle.a, triangle.b, triangle.c];
    const keys = corners.map(keyOf);
    keys.forEach((key, at) => points.set(key, corners[at]));
    for (let index = 0; index < 3; index += 1) {
      const from = keys[index];
      const to = keys[(index + 1) % 3];
      if (counts.get(edgeKey(from, to)) === 1) directed.push([from, to]);
    }
  }
  if (directed.length === 0) return triangles;

  const outgoing = new Map<string, string[]>();
  for (const [from, to] of directed) {
    const list = outgoing.get(from) ?? [];
    list.push(to);
    outgoing.set(from, list);
  }

  const patches: Triangle[] = [];
  for (const [startFrom, startTo] of directed) {
    const list = outgoing.get(startFrom);
    if (!list) continue;
    const at = list.indexOf(startTo);
    if (at === -1) continue;
    list.splice(at, 1);
    const loop: string[] = [startFrom, startTo];
    let cursor = startTo;
    let guard = 0;
    while (cursor !== startFrom && guard < 100_000) {
      guard += 1;
      const next = outgoing.get(cursor)?.pop();
      if (next === undefined) break;
      loop.push(next);
      cursor = next;
    }
    if (cursor !== startFrom || loop.length < 4) continue;
    loop.pop();
    const corners = loop.map((key) => points.get(key) as Vec3);
    const centre = snap([
      corners.reduce((total, corner) => total + corner[0], 0) / corners.length,
      corners.reduce((total, corner) => total + corner[1], 0) / corners.length,
      corners.reduce((total, corner) => total + corner[2], 0) / corners.length,
    ]);
    for (let index = 0; index < corners.length; index += 1) {
      patches.push({ a: corners[(index + 1) % corners.length], b: corners[index], c: centre });
    }
  }
  return [...triangles, ...patches];
};

const dedupe = (triangles: Triangle[]): Triangle[] => {
  const seen = new Set<string>();
  const kept: Triangle[] = [];
  for (const triangle of triangles) {
    const key = [triangle.a, triangle.b, triangle.c].map(keyOf).sort().join('/');
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(triangle);
  }
  return kept;
};

/**
 * Welds coincident vertices, splits edges at T-junctions and covers any remaining
 * boundary loop, so every edge of an exported mesh is shared by exactly two triangles.
 */
export const weldMesh = (mesh: Mesh): Mesh => {
  const vertices = new Map<string, Vec3>();
  let triangles: Triangle[] = [];
  for (const triangle of mesh.triangles) {
    const corners = [triangle.a, triangle.b, triangle.c].map((corner) => {
      const snapped = snap(corner);
      const key = keyOf(snapped);
      const known = vertices.get(key);
      if (known) return known;
      vertices.set(key, snapped);
      return snapped;
    }) as [Vec3, Vec3, Vec3];
    const keys = corners.map(keyOf);
    if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) continue;
    triangles.push({ a: corners[0], b: corners[1], c: corners[2] });
  }
  triangles = dedupe(triangles);
  triangles = splitTJunctions(triangles, buildIndex([...vertices.values()]));
  for (let round = 0; round < 6; round += 1) {
    const filled = fillBoundaryLoops(triangles);
    if (filled.length === triangles.length) break;
    triangles = dedupe(filled);
  }
  return { triangles };
};

export const isClosed = (mesh: Mesh): boolean => {
  const counts = edgeCounts(mesh.triangles);
  if (counts.size === 0) return false;
  for (const count of counts.values()) {
    if (count !== 2) return false;
  }
  return true;
};
