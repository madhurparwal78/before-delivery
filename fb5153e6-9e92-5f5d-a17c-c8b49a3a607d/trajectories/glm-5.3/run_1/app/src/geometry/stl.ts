import type { Mesh } from './glb.js';

interface Tri {
  p0: [number, number, number];
  p1: [number, number, number];
  p2: [number, number, number];
}

/** Binary STL in millimetres, Z up: stl_x = glb_x × 1000, stl_y = −glb_z × 1000, stl_z = glb_y × 1000. */
export function buildStl(mesh: Mesh): Buffer {
  const triangles = mesh.indices.length / 3;
  const out = Buffer.alloc(84 + triangles * 50);
  out.write('Turnstone Studio', 0, 'ascii');
  out.writeUInt32LE(triangles, 80);
  let offset = 84;
  const writeVertex = (value: number): void => {
    out.writeFloatLE(value, offset);
    offset += 4;
  };
  for (let t = 0; t < triangles; t++) {
    const tri = readTriangle(mesh, t);
    const u: [number, number, number] = [tri.p1[0] - tri.p0[0], tri.p1[1] - tri.p0[1], tri.p1[2] - tri.p0[2]];
    const v: [number, number, number] = [tri.p2[0] - tri.p0[0], tri.p2[1] - tri.p0[1], tri.p2[2] - tri.p0[2]];
    let normal: [number, number, number] = [
      (u[1] ?? 0) * (v[2] ?? 0) - (u[2] ?? 0) * (v[1] ?? 0),
      (u[2] ?? 0) * (v[0] ?? 0) - (u[0] ?? 0) * (v[2] ?? 0),
      (u[0] ?? 0) * (v[1] ?? 0) - (u[1] ?? 0) * (v[0] ?? 0),
    ];
    const len = Math.hypot(normal[0], normal[1], normal[2]);
    normal = len === 0 ? [0, 0, 0] : [normal[0] / len, normal[1] / len, normal[2] / len];
    writeVertex(normal[0] ?? 0);
    writeVertex(-(normal[2] ?? 0));
    writeVertex(normal[1] ?? 0);
    for (const p of [tri.p0, tri.p1, tri.p2]) {
      writeVertex((p[0] ?? 0) * 1000);
      writeVertex(-(p[2] ?? 0) * 1000);
      writeVertex((p[1] ?? 0) * 1000);
    }
    out.writeUInt16LE(0, offset);
    offset += 2;
  }
  return out;
}

function readTriangle(mesh: Mesh, index: number): Tri {
  const read = (corner: number): [number, number, number] => {
    const vertex = mesh.indices[index * 3 + corner] ?? 0;
    return [
      mesh.positions[vertex * 3 + 0] ?? 0,
      mesh.positions[vertex * 3 + 1] ?? 0,
      mesh.positions[vertex * 3 + 2] ?? 0,
    ];
  };
  return { p0: read(0), p1: read(1), p2: read(2) };
}
