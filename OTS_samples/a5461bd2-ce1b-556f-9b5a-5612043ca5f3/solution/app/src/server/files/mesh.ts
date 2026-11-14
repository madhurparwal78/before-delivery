/** A tiny indexed-mesh toolkit: just the shapes the eight islands are built from. */

export type Vec3 = [number, number, number];

function valueAt(values: number[], index: number): number {
  return values[index] ?? 0;
}

export interface Mesh {
  positions: number[];
  normals: number[];
  colors: number[] | null;
  indices: number[];
}

interface Placement {
  scale?: number;
  rx?: number;
  ry?: number;
  rz?: number;
  at?: Vec3;
}

export function emptyMesh(): Mesh {
  return { positions: [], normals: [], colors: null, indices: [] };
}

export function vertexCount(mesh: Mesh): number {
  return mesh.positions.length / 3;
}

/** Deterministic noise source, so every start generates identical files. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rotate(point: Vec3, rx: number, ry: number, rz: number): Vec3 {
  let [x, y, z] = point;
  if (rx) [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  if (rz) [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  if (ry) [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  return [x, y, z];
}

/** Copies a mesh into the target after scaling, turning (x, then z, then y) and moving it. */
export function addTo(target: Mesh, source: Mesh, placement: Placement = {}): void {
  const { scale = 1, rx = 0, ry = 0, rz = 0, at = [0, 0, 0] } = placement;
  const base = vertexCount(target);
  for (let i = 0; i < source.positions.length; i += 3) {
    const p = rotate([valueAt(source.positions, i) * scale, valueAt(source.positions, i + 1) * scale, valueAt(source.positions, i + 2) * scale], rx, ry, rz);
    target.positions.push(p[0] + at[0], p[1] + at[1], p[2] + at[2]);
    const n = rotate([valueAt(source.normals, i), valueAt(source.normals, i + 1), valueAt(source.normals, i + 2)], rx, ry, rz);
    target.normals.push(n[0], n[1], n[2]);
  }
  if (source.colors) {
    target.colors ??= new Array<number>(base * 3).fill(1);
    target.colors.push(...source.colors);
  } else if (target.colors) {
    target.colors.push(...new Array<number>((vertexCount(source)) * 3).fill(1));
  }
  for (const index of source.indices) target.indices.push(index + base);
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** Smooth normals from the faces around each vertex. */
function smoothNormals(positions: number[], indices: number[]): number[] {
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [valueAt(indices, i) * 3, valueAt(indices, i + 1) * 3, valueAt(indices, i + 2) * 3];
    const e1: Vec3 = [valueAt(positions, b) - (valueAt(positions, a)), valueAt(positions, b + 1) - (valueAt(positions, a + 1)), valueAt(positions, b + 2) - (valueAt(positions, a + 2))];
    const e2: Vec3 = [valueAt(positions, c) - (valueAt(positions, a)), valueAt(positions, c + 1) - (valueAt(positions, a + 1)), valueAt(positions, c + 2) - (valueAt(positions, a + 2))];
    const n: Vec3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const at of [a, b, c]) {
      normals[at] = (valueAt(normals, at)) + n[0];
      normals[at + 1] = (valueAt(normals, at + 1)) + n[1];
      normals[at + 2] = (valueAt(normals, at + 2)) + n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const n = normalize([valueAt(normals, i), valueAt(normals, i + 1), valueAt(normals, i + 2)]);
    normals[i] = n[0];
    normals[i + 1] = n[1];
    normals[i + 2] = n[2];
  }
  return normals;
}

/** A surface from a grid of points (rows × columns); columns wrap round when `wrap` is set. */
export function grid(rows: number, columns: number, point: (row: number, column: number) => Vec3, options: { wrap?: boolean; color?: (row: number, column: number) => Vec3 } = {}): Mesh {
  const mesh = emptyMesh();
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) mesh.positions.push(...point(r, c));
  if (options.color) {
    mesh.colors = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) mesh.colors.push(...options.color(r, c));
  }
  const span = options.wrap ? columns : columns - 1;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < span; c++) {
      const a = r * columns + c;
      const b = r * columns + ((c + 1) % columns);
      const d = (r + 1) * columns + c;
      const e = (r + 1) * columns + ((c + 1) % columns);
      mesh.indices.push(a, b, d, b, e, d);
    }
  }
  mesh.normals = smoothNormals(mesh.positions, mesh.indices);
  return mesh;
}

/** A solid of revolution about the y axis from (radius, height) points, base first. */
export function lathe(profile: [number, number][], segments: number, color?: Vec3): Mesh {
  const mesh = grid(profile.length, segments, (r, c) => {
    const [radius, y] = profile[r] as [number, number];
    const angle = (c / segments) * Math.PI * 2;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  }, { wrap: true, ...(color ? { color: () => color } : {}) });
  return mesh;
}

function flatQuad(mesh: Mesh, a: Vec3, b: Vec3, c: Vec3, d: Vec3): void {
  const base = vertexCount(mesh);
  const n = normalize([
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ]);
  for (const p of [a, b, c, d]) {
    mesh.positions.push(...p);
    mesh.normals.push(...n);
  }
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A box standing on y = 0, centred on x and z. */
export function box(width: number, height: number, depth: number): Mesh {
  const mesh = emptyMesh();
  const [x, z] = [width / 2, depth / 2];
  const p = (px: number, py: number, pz: number): Vec3 => [px, py, pz];
  flatQuad(mesh, p(-x, 0, z), p(x, 0, z), p(x, height, z), p(-x, height, z));
  flatQuad(mesh, p(x, 0, -z), p(-x, 0, -z), p(-x, height, -z), p(x, height, -z));
  flatQuad(mesh, p(x, 0, z), p(x, 0, -z), p(x, height, -z), p(x, height, z));
  flatQuad(mesh, p(-x, 0, -z), p(-x, 0, z), p(-x, height, z), p(-x, height, -z));
  flatQuad(mesh, p(-x, height, z), p(x, height, z), p(x, height, -z), p(-x, height, -z));
  flatQuad(mesh, p(-x, 0, -z), p(x, 0, -z), p(x, 0, z), p(-x, 0, z));
  return mesh;
}

/** A convex outline in the x–z plane, lifted from y = 0 to the given height with flat sides. */
export function extrude(outline: [number, number][], height: number): Mesh {
  const mesh = emptyMesh();
  const area = outline.reduce((sum, [x, z], i) => {
    const [nx, nz] = outline[(i + 1) % outline.length] as [number, number];
    return sum + (x * nz - nx * z);
  }, 0);
  const ring = area > 0 ? [...outline].reverse() : outline;
  const count = ring.length;
  for (let i = 0; i < count; i++) {
    const [x0, z0] = ring[i] as [number, number];
    const [x1, z1] = ring[(i + 1) % count] as [number, number];
    flatQuad(mesh, [x0, 0, z0], [x1, 0, z1], [x1, height, z1], [x0, height, z0]);
  }
  const top = emptyMesh();
  for (const [x, z] of ring) {
    top.positions.push(x, height, z);
    top.normals.push(0, 1, 0);
  }
  const bottom = emptyMesh();
  for (const [x, z] of ring) {
    bottom.positions.push(x, 0, z);
    bottom.normals.push(0, -1, 0);
  }
  for (let i = 1; i < count - 1; i++) {
    top.indices.push(0, i, i + 1);
    bottom.indices.push(0, i + 1, i);
  }
  addTo(mesh, top);
  addTo(mesh, bottom);
  return mesh;
}

export function regularPolygon(sides: number, radius: number, turn = 0): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = turn + (i / sides) * Math.PI * 2;
    return [Math.cos(angle) * radius, Math.sin(angle) * radius] as [number, number];
  });
}

/** A smooth tapering cylinder standing on y = 0. */
export function cylinder(bottomRadius: number, topRadius: number, height: number, segments: number): Mesh {
  const mesh = lathe([[0, 0], [bottomRadius, 0], [bottomRadius, 0], [topRadius, height], [topRadius, height], [0, height]], segments);
  return capsFlat(mesh, segments);
}

/** Lathe ends collapse to the axis; flatten their normals so the caps shade as discs. */
function capsFlat(mesh: Mesh, segments: number): Mesh {
  const rows = mesh.positions.length / 3 / segments;
  for (const [row, y] of [[0, -1], [1, -1], [rows - 2, 1], [rows - 1, 1]] as [number, number][]) {
    for (let c = 0; c < segments; c++) mesh.normals.splice((row * segments + c) * 3, 3, 0, y, 0);
  }
  return mesh;
}

export function sphere(radius: number, segments: number, rings: number): Mesh {
  const profile: [number, number][] = Array.from({ length: rings + 1 }, (_, i) => {
    const angle = (i / rings) * Math.PI;
    return [Math.sin(angle) * radius, radius - Math.cos(angle) * radius];
  });
  return lathe(profile, segments);
}

/** A ring seen from above (outer and inner walls and both faces), standing on y = 0. */
export function annulus(innerRadius: number, outerRadius: number, height: number, segments: number): Mesh {
  const mesh = lathe([[innerRadius, 0], [outerRadius, 0], [outerRadius, 0], [outerRadius, height], [outerRadius, height], [innerRadius, height], [innerRadius, height], [innerRadius, 0]], segments);
  const set = (row: number, nx: number, ny: number) => {
    for (let c = 0; c < segments; c++) {
      const angle = (c / segments) * Math.PI * 2;
      mesh.normals.splice((row * segments + c) * 3, 3, nx * Math.cos(angle), ny, nx * Math.sin(angle));
    }
  };
  set(0, 0, -1); set(1, 0, -1); set(2, 1, 0); set(3, 1, 0); set(4, 0, 1); set(5, 0, 1); set(6, -1, 0); set(7, -1, 0);
  return mesh;
}

export function torus(majorRadius: number, minorRadius: number, majorSegments: number, minorSegments: number, arc = Math.PI * 2): Mesh {
  return grid(majorSegments + 1, minorSegments, (i, j) => {
    const u = (i / majorSegments) * arc;
    const v = (j / minorSegments) * Math.PI * 2;
    const ring = majorRadius + Math.cos(v) * minorRadius;
    return [Math.cos(u) * ring, Math.sin(v) * minorRadius, Math.sin(u) * ring];
  }, { wrap: true });
}

/** A thin curved sheet, drawn on both faces, from a surface function of u and v in 0..1. */
export function sheet(uSteps: number, vSteps: number, surface: (u: number, v: number) => Vec3): Mesh {
  const front = grid(uSteps + 1, vSteps + 1, (i, j) => surface(i / uSteps, j / vSteps));
  const back = emptyMesh();
  back.positions = [...front.positions];
  back.normals = front.normals.map((value) => -value);
  back.indices = [];
  for (let i = 0; i < front.indices.length; i += 3) back.indices.push(valueAt(front.indices, i), valueAt(front.indices, i + 2), valueAt(front.indices, i + 1));
  addTo(front, back);
  return front;
}
