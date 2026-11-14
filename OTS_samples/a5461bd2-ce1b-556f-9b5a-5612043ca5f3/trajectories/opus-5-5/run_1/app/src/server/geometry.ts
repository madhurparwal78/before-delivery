export interface Mesh {
  positions: number[];
  normals: number[];
  indices: number[];
}

export type Vec3 = [number, number, number];

export interface Placement {
  at?: Vec3;
  rotate?: Vec3;
  scale?: Vec3;
}

function emptyMesh(): Mesh {
  return { positions: [], normals: [], indices: [] };
}

function rotate(v: Vec3, r: Vec3): Vec3 {
  let [x, y, z] = v;
  const [rx, ry, rz] = r;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x, y, z];
}

function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function place(mesh: Mesh, placement: Placement): Mesh {
  const at = placement.at ?? [0, 0, 0];
  const r = placement.rotate ?? [0, 0, 0];
  const s = placement.scale ?? [1, 1, 1];
  const out = emptyMesh();
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const p = rotate([mesh.positions[i] * s[0], mesh.positions[i + 1] * s[1], mesh.positions[i + 2] * s[2]], r);
    out.positions.push(p[0] + at[0], p[1] + at[1], p[2] + at[2]);
    const n = normalise(rotate([mesh.normals[i] / s[0], mesh.normals[i + 1] / s[1], mesh.normals[i + 2] / s[2]], r));
    out.normals.push(...n);
  }
  out.indices = [...mesh.indices];
  return out;
}

export function merge(...meshes: Mesh[]): Mesh {
  const out = emptyMesh();
  for (const mesh of meshes) {
    const offset = out.positions.length / 3;
    out.positions.push(...mesh.positions);
    out.normals.push(...mesh.normals);
    for (const index of mesh.indices) out.indices.push(index + offset);
  }
  return out;
}

export function box(w: number, h: number, d: number): Mesh {
  const mesh = emptyMesh();
  const faces: Array<{ n: Vec3; u: Vec3; v: Vec3 }> = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  const half: Vec3 = [w / 2, h / 2, d / 2];
  for (const { n, u, v } of faces) {
    const base = mesh.positions.length / 3;
    for (const [su, sv] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      mesh.positions.push(
        (n[0] + u[0] * su + v[0] * sv) * half[0],
        (n[1] + u[1] * su + v[1] * sv) * half[1],
        (n[2] + u[2] * su + v[2] * sv) * half[2],
      );
      mesh.normals.push(...n);
    }
    mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mesh;
}

/** Surface of revolution around the y axis from a profile of [radius, y] points, top to bottom. */
export function lathe(profile: Array<[number, number]>, segments: number): Mesh {
  const mesh = emptyMesh();
  for (let j = 0; j < profile.length; j++) {
    const prev = profile[Math.max(0, j - 1)];
    const next = profile[Math.min(profile.length - 1, j + 1)];
    const dr = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const [nr, ny] = [-dy, dr];
    const length = Math.hypot(nr, ny) || 1;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const [r, y] = profile[j];
      mesh.positions.push(Math.cos(a) * r, y, Math.sin(a) * r);
      mesh.normals.push((Math.cos(a) * nr) / length, ny / length, (Math.sin(a) * nr) / length);
    }
  }
  for (let j = 0; j < profile.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * (segments + 1) + i;
      const b = a + segments + 1;
      mesh.indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  return mesh;
}

function disc(radius: number, y: number, segments: number, up: boolean): Mesh {
  const mesh = emptyMesh();
  mesh.positions.push(0, y, 0);
  mesh.normals.push(0, up ? 1 : -1, 0);
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    mesh.positions.push(Math.cos(a) * radius, y, Math.sin(a) * radius);
    mesh.normals.push(0, up ? 1 : -1, 0);
  }
  for (let i = 1; i <= segments; i++) {
    if (up) mesh.indices.push(0, i + 1, i);
    else mesh.indices.push(0, i, i + 1);
  }
  return mesh;
}

export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number): Mesh {
  const side = lathe(
    [
      [radiusTop, height / 2],
      [radiusBottom, -height / 2],
    ],
    segments,
  );
  return merge(side, disc(radiusTop, height / 2, segments, true), disc(radiusBottom, -height / 2, segments, false));
}

export function sphere(radius: number, widthSegments: number, heightSegments: number): Mesh {
  const profile: Array<[number, number]> = [];
  for (let j = 0; j <= heightSegments; j++) {
    const t = (j / heightSegments) * Math.PI;
    profile.push([Math.sin(t) * radius, Math.cos(t) * radius]);
  }
  const mesh = lathe(profile, widthSegments);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const n = normalise([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    mesh.normals.splice(i, 3, ...n);
  }
  return mesh;
}

export function torus(radius: number, tube: number, radialSegments: number, tubularSegments: number): Mesh {
  const profile: Array<[number, number]> = [];
  for (let j = 0; j <= tubularSegments; j++) {
    const t = (j / tubularSegments) * Math.PI * 2;
    profile.push([radius + Math.cos(t) * tube, Math.sin(t) * tube]);
  }
  const mesh = lathe(profile, radialSegments);
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const z = mesh.positions[i + 2];
    const r = Math.hypot(x, z) || 1;
    const centre: Vec3 = [(x / r) * radius, 0, (z / r) * radius];
    mesh.normals.splice(i, 3, ...normalise([x - centre[0], mesh.positions[i + 1], z - centre[2]]));
  }
  return mesh;
}

/** Extrudes a counter-clockwise polygon in the x-z plane upwards by height; the polygon must be star-shaped from its centroid. */
export function extrude(polygon: Array<[number, number]>, height: number): Mesh {
  const mesh = emptyMesh();
  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length;
  const cz = polygon.reduce((s, p) => s + p[1], 0) / polygon.length;
  for (const [y, up] of [
    [height, true],
    [0, false],
  ] as const) {
    const base = mesh.positions.length / 3;
    mesh.positions.push(cx, y, cz);
    mesh.normals.push(0, up ? 1 : -1, 0);
    for (const [x, z] of polygon) {
      mesh.positions.push(x, y, z);
      mesh.normals.push(0, up ? 1 : -1, 0);
    }
    for (let i = 0; i < polygon.length; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % polygon.length);
      if (up) mesh.indices.push(base, b, a);
      else mesh.indices.push(base, a, b);
    }
  }
  for (let i = 0; i < polygon.length; i++) {
    const [x0, z0] = polygon[i];
    const [x1, z1] = polygon[(i + 1) % polygon.length];
    const n = normalise([z1 - z0, 0, -(x1 - x0)]);
    const base = mesh.positions.length / 3;
    mesh.positions.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, height, z0);
    for (let k = 0; k < 4; k++) mesh.normals.push(...n);
    mesh.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return mesh;
}
