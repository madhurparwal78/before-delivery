import { BufferAttribute, BufferGeometry } from "three";
import type { MeshData } from "../geometry";

const CREASE_DEGREES = 35;

/**
 * Renderable geometry for a closed mesh: a vertex takes the area-weighted normal of the neighbouring faces within a
 * crease angle, so spheres and cylinder walls look smooth while box edges and cylinder rims stay sharp. Corners are
 * unshared. `period` is the distance between stripes (mm) of the diagonal hole pattern, written as u = (x+y+z)/period.
 */
export function creaseGeometry(mesh: MeshData, period: number): BufferGeometry {
  const { positions: p, indices: ix } = mesh;
  const triangles = ix.length / 3;
  const faceNormals = new Float64Array(triangles * 3);
  const incident: number[][] = Array.from({ length: p.length / 3 }, () => []);
  for (let t = 0; t < triangles; t++) {
    const a = (ix[t * 3] ?? 0) * 3, b = (ix[t * 3 + 1] ?? 0) * 3, c = (ix[t * 3 + 2] ?? 0) * 3;
    const ux = (p[b] ?? 0) - (p[a] ?? 0), uy = (p[b + 1] ?? 0) - (p[a + 1] ?? 0), uz = (p[b + 2] ?? 0) - (p[a + 2] ?? 0);
    const vx = (p[c] ?? 0) - (p[a] ?? 0), vy = (p[c + 1] ?? 0) - (p[a + 1] ?? 0), vz = (p[c + 2] ?? 0) - (p[a + 2] ?? 0);
    faceNormals[t * 3] = uy * vz - uz * vy;
    faceNormals[t * 3 + 1] = uz * vx - ux * vz;
    faceNormals[t * 3 + 2] = ux * vy - uy * vx;
    for (let corner = 0; corner < 3; corner++) incident[ix[t * 3 + corner] ?? 0]?.push(t);
  }
  const unit = new Float64Array(triangles * 3);
  for (let t = 0; t < triangles; t++) {
    const length = Math.hypot(faceNormals[t * 3] ?? 0, faceNormals[t * 3 + 1] ?? 0, faceNormals[t * 3 + 2] ?? 0) || 1;
    for (let k = 0; k < 3; k++) unit[t * 3 + k] = (faceNormals[t * 3 + k] ?? 0) / length;
  }
  const minDot = Math.cos((CREASE_DEGREES * Math.PI) / 180);
  const outPositions = new Float32Array(triangles * 9);
  const outNormals = new Float32Array(triangles * 9);
  const outUv = new Float32Array(triangles * 6);
  for (let t = 0; t < triangles; t++) {
    for (let corner = 0; corner < 3; corner++) {
      const vertex = ix[t * 3 + corner] ?? 0;
      let nx = 0, ny = 0, nz = 0;
      for (const other of incident[vertex] ?? []) {
        const dot = (unit[t * 3] ?? 0) * (unit[other * 3] ?? 0) + (unit[t * 3 + 1] ?? 0) * (unit[other * 3 + 1] ?? 0) + (unit[t * 3 + 2] ?? 0) * (unit[other * 3 + 2] ?? 0);
        if (dot < minDot) continue;
        nx += faceNormals[other * 3] ?? 0;
        ny += faceNormals[other * 3 + 1] ?? 0;
        nz += faceNormals[other * 3 + 2] ?? 0;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      const at = (t * 3 + corner) * 3;
      const x = p[vertex * 3] ?? 0, y = p[vertex * 3 + 1] ?? 0, z = p[vertex * 3 + 2] ?? 0;
      outPositions[at] = x;
      outPositions[at + 1] = y;
      outPositions[at + 2] = z;
      outNormals[at] = nx / length;
      outNormals[at + 1] = ny / length;
      outNormals[at + 2] = nz / length;
      outUv[(t * 3 + corner) * 2] = (x + y + z) / period;
      outUv[(t * 3 + corner) * 2 + 1] = 0.5;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(outPositions, 3));
  geometry.setAttribute("normal", new BufferAttribute(outNormals, 3));
  geometry.setAttribute("uv", new BufferAttribute(outUv, 2));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
