import type { DesignObject } from "../../shared/types";
import type { Bounds, MeshData } from "./types";

const CIRCULAR_SEGMENTS = 64;
const SPHERE_RINGS = 32;

const DEG = Math.PI / 180;

interface RawMesh {
  /** x,y,z per vertex relative to the object's centre, before any scaling. */
  points: number[];
  triangles: number[];
}

/** Volume of a closed triangle mesh, summed in double precision about the first vertex to keep far-from-origin meshes exact. */
function signedVolume(points: ArrayLike<number>, triangles: ArrayLike<number>): number {
  if (triangles.length === 0) return 0;
  const ox = points[0] ?? 0, oy = points[1] ?? 0, oz = points[2] ?? 0;
  let sum = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = (triangles[t] ?? 0) * 3, b = (triangles[t + 1] ?? 0) * 3, c = (triangles[t + 2] ?? 0) * 3;
    const ax = (points[a] ?? 0) - ox, ay = (points[a + 1] ?? 0) - oy, az = (points[a + 2] ?? 0) - oz;
    const bx = (points[b] ?? 0) - ox, by = (points[b + 1] ?? 0) - oy, bz = (points[b + 2] ?? 0) - oz;
    const cx = (points[c] ?? 0) - ox, cy = (points[c + 1] ?? 0) - oy, cz = (points[c + 2] ?? 0) - oz;
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/** Mesh volume in cubic millimetres, double precision. */
export function meshVolume(mesh: MeshData): number {
  return signedVolume(mesh.positions, mesh.indices);
}

export function meshBounds(positions: Float32Array): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0, y = positions[i + 1] ?? 0, z = positions[i + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function boxMesh(): RawMesh {
  const points: number[] = [];
  for (let i = 0; i < 8; i++) points.push(i & 1 ? 0.5 : -0.5, i & 2 ? 0.5 : -0.5, i & 4 ? 0.5 : -0.5);
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [3, 2, 6, 7], [2, 0, 4, 6], [1, 3, 7, 5]];
  const triangles: number[] = [];
  for (const [a, b, c, d] of quads) triangles.push(a ?? 0, b ?? 0, c ?? 0, a ?? 0, c ?? 0, d ?? 0);
  return { points, triangles };
}

/** Quad strip between two rings of `count` vertices starting at `lower` and `upper`, outward counter-clockwise. */
function stitchRings(triangles: number[], lower: number, upper: number, count: number): void {
  for (let k = 0; k < count; k++) {
    const next = (k + 1) % count;
    const a = lower + k, b = lower + next, c = upper + next, d = upper + k;
    triangles.push(a, b, c, a, c, d);
  }
}

/** Unit-diameter, unit-height cylinder about the origin; the radial scale that equalises volume is applied by the caller. */
function cylinderMesh(): RawMesh {
  const n = CIRCULAR_SEGMENTS;
  const points: number[] = [];
  for (const z of [-0.5, 0.5]) {
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n;
      points.push(0.5 * Math.cos(angle), 0.5 * Math.sin(angle), z);
    }
  }
  points.push(0, 0, -0.5, 0, 0, 0.5);
  const triangles: number[] = [];
  stitchRings(triangles, 0, n, n);
  const bottomCentre = 2 * n;
  const topCentre = 2 * n + 1;
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    triangles.push(topCentre, n + i, n + next);
    triangles.push(bottomCentre, next, i);
  }
  return { points, triangles };
}

/** Unit-diameter sphere with `SPHERE_RINGS` bands pole to pole and `CIRCULAR_SEGMENTS` around. */
function sphereMesh(): RawMesh {
  const n = CIRCULAR_SEGMENTS;
  const points: number[] = [0, 0, -0.5];
  for (let ring = 1; ring < SPHERE_RINGS; ring++) {
    const latitude = -Math.PI / 2 + (Math.PI * ring) / SPHERE_RINGS;
    const radius = 0.5 * Math.cos(latitude);
    const z = 0.5 * Math.sin(latitude);
    for (let i = 0; i < n; i++) {
      const angle = (2 * Math.PI * i) / n;
      points.push(radius * Math.cos(angle), radius * Math.sin(angle), z);
    }
  }
  points.push(0, 0, 0.5);
  const south = 0;
  const north = points.length / 3 - 1;
  const ringStart = (ring: number) => 1 + (ring - 1) * n;
  const triangles: number[] = [];
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    triangles.push(south, ringStart(1) + next, ringStart(1) + i);
    triangles.push(ringStart(SPHERE_RINGS - 1) + i, ringStart(SPHERE_RINGS - 1) + next, north);
  }
  for (let ring = 1; ring < SPHERE_RINGS - 1; ring++) stitchRings(triangles, ringStart(ring), ringStart(ring + 1), n);
  return { points, triangles };
}

const UNIT_BOX = boxMesh();
const UNIT_CYLINDER = cylinderMesh();
const UNIT_SPHERE = sphereMesh();

/**
 * Uniform stretch that takes the unit mesh's volume to the exact one. The unit cylinder (diameter 1, height 1) is
 * stretched radially only, so its factor is a square root; the unit sphere grows in all three axes.
 */
function volumeRatio(raw: RawMesh, exact: number): number {
  return exact / signedVolume(raw.points, raw.triangles);
}

const CYLINDER_RADIAL_SCALE = Math.sqrt(volumeRatio(UNIT_CYLINDER, Math.PI / 4));
const SPHERE_SCALE = Math.cbrt(volumeRatio(UNIT_SPHERE, Math.PI / 6));

/** Mesh of one box, cylinder or sphere in world coordinates with its rotationZ applied. Groups have no primitive mesh. */
export function primitiveMesh(object: DesignObject): MeshData {
  if (object.kind === "group") throw new Error("A group has no primitive mesh; resolve it in the geometry worker.");
  const raw = object.kind === "box" ? UNIT_BOX : object.kind === "cylinder" ? UNIT_CYLINDER : UNIT_SPHERE;
  const radial = object.kind === "cylinder" ? CYLINDER_RADIAL_SCALE : object.kind === "sphere" ? SPHERE_SCALE : 1;
  const vertical = object.kind === "sphere" ? SPHERE_SCALE : 1;
  const sx = object.w * radial, sy = object.d * radial, sz = object.h * vertical;
  const turns = object.rotationZ % 360 !== 0;
  const cos = turns ? Math.cos(object.rotationZ * DEG) : 1;
  const sin = turns ? Math.sin(object.rotationZ * DEG) : 0;
  const positions = new Float32Array(raw.points.length);
  for (let i = 0; i < raw.points.length; i += 3) {
    const x = (raw.points[i] ?? 0) * sx;
    const y = (raw.points[i + 1] ?? 0) * sy;
    positions[i] = object.x + x * cos - y * sin;
    positions[i + 1] = object.y + x * sin + y * cos;
    positions[i + 2] = object.z + (raw.points[i + 2] ?? 0) * sz;
  }
  return { positions, indices: Uint32Array.from(raw.triangles) };
}
