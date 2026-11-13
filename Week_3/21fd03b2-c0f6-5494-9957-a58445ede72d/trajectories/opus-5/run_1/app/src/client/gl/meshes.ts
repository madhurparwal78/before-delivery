export interface MeshData {
  positions: number[];
  normals: number[];
}

function pushTriangle(
  mesh: MeshData,
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
): void {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  for (const point of [a, b, c]) {
    mesh.positions.push(point[0], point[1], point[2]);
    mesh.normals.push(nx / length, ny / length, nz / length);
  }
}

function quad(
  mesh: MeshData,
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
): void {
  pushTriangle(mesh, a, b, c);
  pushTriangle(mesh, a, c, d);
}

/** A unit cube centred on the origin. */
export function cubeMesh(): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  const h = 0.5;
  const points = [
    [-h, -h, -h],
    [h, -h, -h],
    [h, h, -h],
    [-h, h, -h],
    [-h, -h, h],
    [h, -h, h],
    [h, h, h],
    [-h, h, h],
  ];
  quad(mesh, points[4], points[5], points[6], points[7]);
  quad(mesh, points[1], points[0], points[3], points[2]);
  quad(mesh, points[0], points[4], points[7], points[3]);
  quad(mesh, points[5], points[1], points[2], points[6]);
  quad(mesh, points[3], points[7], points[6], points[2]);
  quad(mesh, points[0], points[1], points[5], points[4]);
  return mesh;
}

/** A right-triangle prism: the ramp wedge, rising along +x over a unit run. */
export function wedgeMesh(): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  const z = 0.5;
  const a = [0, 0, -z];
  const b = [1, 0, -z];
  const c = [1, 1, -z];
  const a2 = [0, 0, z];
  const b2 = [1, 0, z];
  const c2 = [1, 1, z];
  pushTriangle(mesh, a, c, b);
  pushTriangle(mesh, a2, b2, c2);
  quad(mesh, a, b, b2, a2);
  quad(mesh, b, c, c2, b2);
  quad(mesh, c, a, a2, c2);
  return mesh;
}

export function sphereMesh(segments = 16): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  for (let ring = 0; ring < segments; ring += 1) {
    const phi0 = (ring / segments) * Math.PI;
    const phi1 = ((ring + 1) / segments) * Math.PI;
    for (let slice = 0; slice < segments * 2; slice += 1) {
      const theta0 = (slice / (segments * 2)) * Math.PI * 2;
      const theta1 = ((slice + 1) / (segments * 2)) * Math.PI * 2;
      const point = (phi: number, theta: number): number[] => [
        0.5 * Math.sin(phi) * Math.cos(theta),
        0.5 * Math.cos(phi),
        0.5 * Math.sin(phi) * Math.sin(theta),
      ];
      quad(
        mesh,
        point(phi0, theta0),
        point(phi1, theta0),
        point(phi1, theta1),
        point(phi0, theta1),
      );
    }
  }
  return mesh;
}

/** A unit cylinder along y, radius 0.5, height 1. */
export function cylinderMesh(segments = 20): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  for (let slice = 0; slice < segments; slice += 1) {
    const t0 = (slice / segments) * Math.PI * 2;
    const t1 = ((slice + 1) / segments) * Math.PI * 2;
    const x0 = 0.5 * Math.cos(t0);
    const z0 = 0.5 * Math.sin(t0);
    const x1 = 0.5 * Math.cos(t1);
    const z1 = 0.5 * Math.sin(t1);
    quad(mesh, [x0, -0.5, z0], [x1, -0.5, z1], [x1, 0.5, z1], [x0, 0.5, z0]);
    pushTriangle(mesh, [0, 0.5, 0], [x0, 0.5, z0], [x1, 0.5, z1]);
    pushTriangle(mesh, [0, -0.5, 0], [x1, -0.5, z1], [x0, -0.5, z0]);
  }
  return mesh;
}

/** A capsule along x: the cart's own rounded shape. */
export function capsuleMesh(segments = 14): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  const radius = 0.5;
  const half = 0.5;
  for (let slice = 0; slice < segments; slice += 1) {
    const t0 = (slice / segments) * Math.PI * 2;
    const t1 = ((slice + 1) / segments) * Math.PI * 2;
    const y0 = radius * Math.cos(t0);
    const z0 = radius * Math.sin(t0);
    const y1 = radius * Math.cos(t1);
    const z1 = radius * Math.sin(t1);
    quad(mesh, [-half, y0, z0], [half, y0, z0], [half, y1, z1], [-half, y1, z1]);
    for (let ring = 0; ring < segments / 2; ring += 1) {
      const p0 = (ring / (segments / 2)) * (Math.PI / 2);
      const p1 = ((ring + 1) / (segments / 2)) * (Math.PI / 2);
      const cap = (sign: number, phi: number, theta: number): number[] => [
        sign * (half + radius * Math.sin(phi)),
        radius * Math.cos(phi) * Math.cos(theta),
        radius * Math.cos(phi) * Math.sin(theta),
      ];
      quad(mesh, cap(1, p0, t0), cap(1, p1, t0), cap(1, p1, t1), cap(1, p0, t1));
      quad(mesh, cap(-1, p0, t1), cap(-1, p1, t1), cap(-1, p1, t0), cap(-1, p0, t0));
    }
  }
  return mesh;
}

export function groundMesh(size: number): MeshData {
  const mesh: MeshData = { positions: [], normals: [] };
  quad(mesh, [-size, 0, -size], [-size, 0, size], [size, 0, size], [size, 0, -size]);
  return mesh;
}
