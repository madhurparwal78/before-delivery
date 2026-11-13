import { booleans, extrusions, geometries } from '@jscad/modeling';
import type { Direction, Operation, Plane } from '../../shared/api.js';
import type { Profile } from '../../shared/profile.js';

export type Vertex3 = [number, number, number];
export type Triangle = [number, number, number];
export type Mesh = { vertices: Vertex3[]; triangles: Triangle[] };

export type MassProperties = {
  volume_mm3: number;
  area_mm2: number;
  centroid_mm: { x: number; y: number; z: number };
};

export const OPERATION_WORD: Record<Operation, string> = {
  new: 'New body',
  join: 'Join',
  cut: 'Cut',
  intersect: 'Intersect',
};

export type FeatureSpec = {
  name: string;
  operation: Operation;
  direction: Direction;
  depthMm: number;
  plane: Plane;
  offsetMm: number;
  profile: Profile;
};

export type BuildFailure = {
  reason: 'empty' | 'separate';
  operation: Operation;
};

export type BuildOutcome = { ok: true; mesh: Mesh } | { ok: false; failure: BuildFailure };

type Geom3 = ReturnType<typeof geometries.geom3.create>;

const WELD_GRID = 1e-6;

/** Material loops wind counter-clockwise and hole loops clockwise, as geom2 expects. */
function profileToGeom2(profile: Profile): ReturnType<typeof geometries.geom2.create> {
  const sides: [[number, number], [number, number]][] = [];
  for (const loop of profile.loops) {
    const points = loop.depth % 2 === 0 ? loop.points : [...loop.points].reverse();
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i] as { x: number; y: number };
      const b = points[(i + 1) % points.length] as { x: number; y: number };
      sides.push([
        [a.x, a.y],
        [b.x, b.y],
      ]);
    }
  }
  return geometries.geom2.create(sides);
}

type PartSpaceMap = { place: (u: number, v: number, w: number) => Vertex3; mirrored: boolean };

function partSpaceMap(plane: Plane, offsetMm: number): PartSpaceMap {
  if (plane === 'top') {
    return { place: (u, v, w) => [u, v, offsetMm + w], mirrored: false };
  }
  if (plane === 'front') {
    return { place: (u, v, w) => [u, offsetMm + w, v], mirrored: true };
  }
  return { place: (u, v, w) => [offsetMm + w, u, v], mirrored: false };
}

function sweepStart(direction: Direction, depthMm: number): number {
  if (direction === 'normal') return 0;
  if (direction === 'reverse') return -depthMm;
  return -depthMm / 2;
}

class Welder {
  private readonly buckets = new Map<string, number[]>();
  readonly vertices: Vertex3[] = [];

  add(vertex: Vertex3): number {
    const cell = vertex.map((value) => Math.round(value / WELD_GRID));
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const key = `${(cell[0] as number) + dx},${(cell[1] as number) + dy},${(cell[2] as number) + dz}`;
          const bucket = this.buckets.get(key);
          if (!bucket) continue;
          for (const index of bucket) {
            const candidate = this.vertices[index] as Vertex3;
            if (
              Math.abs(candidate[0] - vertex[0]) <= WELD_GRID &&
              Math.abs(candidate[1] - vertex[1]) <= WELD_GRID &&
              Math.abs(candidate[2] - vertex[2]) <= WELD_GRID
            ) {
              return index;
            }
          }
        }
      }
    }
    const index = this.vertices.length;
    this.vertices.push(vertex);
    const key = `${cell[0]},${cell[1]},${cell[2]}`;
    const bucket = this.buckets.get(key);
    if (bucket) bucket.push(index);
    else this.buckets.set(key, [index]);
    return index;
  }
}

function meshFromGeom3(solid: Geom3): Mesh {
  const welder = new Welder();
  const triangles: Triangle[] = [];
  for (const polygon of geometries.geom3.toPolygons(solid)) {
    const indices = polygon.vertices.map((vertex) =>
      welder.add([vertex[0] as number, vertex[1] as number, vertex[2] as number]),
    );
    for (let i = 1; i + 1 < indices.length; i += 1) {
      const a = indices[0] as number;
      const b = indices[i] as number;
      const c = indices[i + 1] as number;
      if (a !== b && b !== c && c !== a) triangles.push([a, b, c]);
    }
  }
  return { vertices: welder.vertices, triangles };
}

function geom3FromMesh(mesh: Mesh): Geom3 {
  const polygons = mesh.triangles.map((triangle) =>
    geometries.poly3.create(triangle.map((index) => [...(mesh.vertices[index] as Vertex3)])),
  );
  return geometries.geom3.create(polygons);
}

function extrudeFeature(feature: FeatureSpec): Mesh {
  const shape = profileToGeom2(feature.profile);
  const solid = extrusions.extrudeLinear({ height: feature.depthMm }, shape);
  const local = meshFromGeom3(solid);
  const map = partSpaceMap(feature.plane, feature.offsetMm);
  const shift = sweepStart(feature.direction, feature.depthMm);
  const vertices = local.vertices.map((vertex) =>
    map.place(vertex[0], vertex[1], vertex[2] + shift),
  );
  const triangles = map.mirrored
    ? local.triangles.map((triangle): Triangle => [triangle[0], triangle[2], triangle[1]])
    : local.triangles;
  return { vertices, triangles };
}

export function massProperties(mesh: Mesh): MassProperties {
  let volume = 0;
  let area = 0;
  let momentX = 0;
  let momentY = 0;
  let momentZ = 0;
  for (const triangle of mesh.triangles) {
    const a = mesh.vertices[triangle[0]] as Vertex3;
    const b = mesh.vertices[triangle[1]] as Vertex3;
    const c = mesh.vertices[triangle[2]] as Vertex3;
    const crossX = b[1] * c[2] - b[2] * c[1];
    const crossY = b[2] * c[0] - b[0] * c[2];
    const crossZ = b[0] * c[1] - b[1] * c[0];
    const tetra = (a[0] * crossX + a[1] * crossY + a[2] * crossZ) / 6;
    volume += tetra;
    momentX += (tetra * (a[0] + b[0] + c[0])) / 4;
    momentY += (tetra * (a[1] + b[1] + c[1])) / 4;
    momentZ += (tetra * (a[2] + b[2] + c[2])) / 4;
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return {
    volume_mm3: volume,
    area_mm2: area,
    centroid_mm: { x: momentX / volume, y: momentY / volume, z: momentZ / volume },
  };
}

function connectedPieces(mesh: Mesh): number {
  const parent = new Int32Array(mesh.vertices.length);
  for (let i = 0; i < parent.length; i += 1) parent[i] = i;
  const find = (index: number): number => {
    let root = index;
    while ((parent[root] as number) !== root) root = parent[root] as number;
    let walk = index;
    while ((parent[walk] as number) !== walk) {
      const next = parent[walk] as number;
      parent[walk] = root;
      walk = next;
    }
    return root;
  };
  const join = (left: number, right: number): void => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[a] = b;
  };
  const touched = new Set<number>();
  for (const triangle of mesh.triangles) {
    join(triangle[0], triangle[1]);
    join(triangle[1], triangle[2]);
    touched.add(triangle[0]);
    touched.add(triangle[1]);
    touched.add(triangle[2]);
  }
  const roots = new Set<number>();
  for (const vertex of touched) roots.add(find(vertex));
  return roots.size;
}

const EMPTY_VOLUME_TOLERANCE = 1e-6;

/** Applies a part's extrudes in order. Each step must leave one connected body. */
export function buildBody(features: FeatureSpec[]): BuildOutcome {
  let body: Mesh | null = null;
  for (const feature of features) {
    const tool = extrudeFeature(feature);
    let next: Mesh;
    if (feature.operation === 'new' || body === null) {
      next = tool;
    } else {
      const combined =
        feature.operation === 'join'
          ? booleans.union(geom3FromMesh(body), geom3FromMesh(tool))
          : feature.operation === 'cut'
            ? booleans.subtract(geom3FromMesh(body), geom3FromMesh(tool))
            : booleans.intersect(geom3FromMesh(body), geom3FromMesh(tool));
      next = meshFromGeom3(combined);
    }
    if (next.triangles.length === 0 || massProperties(next).volume_mm3 <= EMPTY_VOLUME_TOLERANCE) {
      return { ok: false, failure: { reason: 'empty', operation: feature.operation } };
    }
    if (connectedPieces(next) > 1) {
      return { ok: false, failure: { reason: 'separate', operation: feature.operation } };
    }
    body = next;
  }
  return { ok: true, mesh: body as Mesh };
}
