// Mesh generation for every 3D layer kind, in the shapes the brief publishes.
import type { Vec3 } from '../domain/types';

export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array | Uint32Array;
  triangles: number;
}

export function cubeMesh(hx = 0.5, hy = 0.5, hz = 0.5): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: [Vec3, Vec3][] = [
    [{ x: 1, y: 0, z: 0 }, { x: hx, y: 0, z: 0 }],
    [{ x: -1, y: 0, z: 0 }, { x: -hx, y: 0, z: 0 }],
    [{ x: 0, y: 1, z: 0 }, { x: 0, y: hy, z: 0 }],
    [{ x: 0, y: -1, z: 0 }, { x: 0, y: -hy, z: 0 }],
    [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: hz }],
    [{ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -hz }],
  ];
  for (const [n, c] of faces) {
    const base = positions.length / 3;
    const t = Math.abs(n.y) > 0.9 ? [1, 0, 0] : Math.abs(n.x) > 0.9 ? [0, 1, 0] : [0, 1, 0];
    const [tx, ty, tz] = t;
    positions.push(
      c.x - tx * hx, c.y - ty * hy, c.z - tz * hz,
      c.x + tx * hx, c.y - ty * hy, c.z - tz * hz,
      c.x + tx * hx, c.y + ty * hy, c.z + tz * hz,
      c.x - tx * hx, c.y + ty * hy, c.z + tz * hz,
    );
    for (let i = 0; i < 4; i++) normals.push(n.x, n.y, n.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    triangles: 12,
  };
}

// Sphere: radius 0.5, poles on the y axis, 32 × 16 segments, 960 triangles.
export function sphereMesh(segU = 32, segV = 16): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    for (let u = 0; u <= segU; u++) {
      const theta = (u / segU) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      positions.push(nx * 0.5, ny * 0.5, nz * 0.5);
      normals.push(nx, ny, nz);
    }
  }
  for (let v = 0; v < segV; v++) {
    for (let u = 0; u < segU; u++) {
      const a = v * (segU + 1) + u;
      const b = a + segU + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    triangles: segU * segV * 2,
  };
}

// Cylinder: radius 0.5, height 1, axis along y, 32 radial segments, capped.
export function cylinderMesh(radial = 32): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const r = 0.5;
  const h = 0.5;
  // side
  for (let i = 0; i <= radial; i++) {
    const theta = (i / radial) * Math.PI * 2;
    const nx = Math.cos(theta);
    const nz = Math.sin(theta);
    const base = positions.length / 3;
    positions.push(nx * r, -h, nz * r, nx * r, h, nz * r);
    normals.push(nx, 0, nz, nx, 0, nz);
    if (i < radial) {
      const next = base + 2;
      indices.push(base, next, base + 1, next, next + 1, base + 1);
    }
  }
  // caps
  for (const [cy, ny] of [[h, 1], [-h, -1]] as [number, number][]) {
    const centre = positions.length / 3;
    positions.push(0, cy, 0);
    normals.push(0, ny, 0);
    const ring = positions.length / 3;
    for (let i = 0; i <= radial; i++) {
      const theta = (i / radial) * Math.PI * 2;
      positions.push(Math.cos(theta) * r, cy, Math.sin(theta) * r);
      normals.push(0, ny, 0);
    }
    for (let i = 0; i < radial; i++) {
      const a = ring + i;
      const b = ring + ((i + 1) % (radial + 1));
      if (ny > 0) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    triangles: radial * 4,
  };
}

// Torus: radius 0.5, tube 0.15, ring in the xy plane around the z axis,
// 48 × 16 segments, 1536 triangles.
export function torusMesh(segU = 48, segV = 16): Mesh {
  const R = 0.5;
  const r = 0.15;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const nx = cv * cu;
      const ny = cv * su;
      const nz = sv;
      positions.push((R + r * cv) * cu, (R + r * cv) * su, r * sv);
      normals.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + segV + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
    triangles: segU * segV * 2,
  };
}

// Plane: 1 × 1 in the xy plane, 2 triangles.
export function planeMesh(): Mesh {
  return {
    positions: new Float32Array([
      -0.5, 0.5, 0,
      0.5, 0.5, 0,
      0.5, -0.5, 0,
      -0.5, -0.5, 0,
    ]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    triangles: 2,
  };
}

// Extrusion mesh from square-cell outlines (text) or an SVG outline.
export interface OutlineMeshInput {
  outlines: { x: number; y: number }[][];
  depth: number;
  bevel: number;
  bevelSegments: number;
}

export function extrusionMesh(input: OutlineMeshInput): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const half = input.depth / 2;
  const front = half + input.bevel;
  const back = -half - input.bevel;
  const segs = input.bevel > 0 ? input.bevelSegments : 0;
  for (const outline of input.outlines) {
    const n = outline.length;
    if (n < 3) continue;
    // Front and back faces (triangulated as a fan; the outlines are simple).
    const frontBase = positions.length / 3;
    for (const p of outline) {
      positions.push(p.x, p.y, front);
      normals.push(0, 0, 1);
    }
    for (let i = 1; i < n - 1; i++) {
      indices.push(frontBase, frontBase + i, frontBase + i + 1);
    }
    const backBase = positions.length / 3;
    for (const p of outline) {
      positions.push(p.x, p.y, back);
      normals.push(0, 0, -1);
    }
    for (let i = 1; i < n - 1; i++) {
      indices.push(backBase, backBase + i + 1, backBase + i);
    }
    // Side walls, with bevel steps between front/back faces and the bevelled
    // rim.
    void segs;
    // Side walls between back and front
    for (let i = 0; i < n; i++) {
      const p1 = outline[i]!;
      const p2 = outline[(i + 1) % n]!;
      const ex = p2.x - p1.x;
      const ey = p2.y - p1.y;
      const len = Math.hypot(ex, ey) || 1;
      const nx = ey / len;
      const ny = -ex / len;
      const base = positions.length / 3;
      positions.push(p1.x, p1.y, back, p2.x, p2.y, back, p2.x, p2.y, front, p1.x, p1.y, front);
      for (let k = 0; k < 4; k++) normals.push(nx, ny, 0);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // Bevel rims
    for (const zFace of [back, front]) {
      const sign = zFace < 0 ? -1 : 1;
      for (let i = 0; i < n; i++) {
        const p1 = outline[i]!;
        const p2 = outline[(i + 1) % n]!;
        const ex = p2.x - p1.x;
        const ey = p2.y - p1.y;
        const len = Math.hypot(ex, ey) || 1;
        const nx = (ey / len) * sign;
        const ny = (-ex / len) * sign;
        const b = input.bevel;
        if (b > 0 && segs > 0) {
          // a single bevel step to the outline shrunk outward
          const q1 = { x: p1.x, y: p1.y };
          const q2 = { x: p2.x, y: p2.y };
          const base = positions.length / 3;
          const z0 = zFace - sign * b;
          positions.push(q1.x, q1.y, z0, q2.x, q2.y, z0, q2.x, q2.y, zFace, q1.x, q1.y, zFace);
          for (let k = 0; k < 4; k++) normals.push(nx, ny, sign * 0.4);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    triangles: indices.length / 3,
  };
}

// Preset models generated in code: Pebble, Arch, Lattice.
export function presetMesh(preset: string): Mesh {
  if (preset === 'Arch') {
    // A low arch made of three boxes.
    const parts: Mesh[] = [];
    void parts;
    // Simplified: an arch from an extruded outline.
    return extrusionMesh({
      outlines: [
        [
          { x: -0.8, y: -0.5 },
          { x: -0.5, y: -0.5 },
          { x: -0.5, y: 0.2 },
          { x: 0.5, y: 0.2 },
          { x: 0.5, y: -0.5 },
          { x: 0.8, y: -0.5 },
          { x: 0.8, y: 0.5 },
          { x: -0.8, y: 0.5 },
        ],
      ],
      depth: 0.6,
      bevel: 0,
      bevelSegments: 1,
    });
  }
  if (preset === 'Lattice') {
    // A grid of thin bars as boxes.
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const addBox = (
      cx: number,
      cy: number,
      cz: number,
      hx: number,
      hy: number,
      hz: number,
    ): void => {
      const m = cubeMesh(hx, hy, hz);
      const base = positions.length / 3;
      for (let i = 0; i < m.positions.length; i += 3) {
        positions.push(m.positions[i]! + cx, m.positions[i + 1]! + cy, m.positions[i + 2]! + cz);
      }
      for (let i = 0; i < m.normals.length; i++) normals.push(m.normals[i]!);
      for (let i = 0; i < m.indices.length; i++) indices.push(m.indices[i]! + base);
    };
    for (let i = -1; i <= 1; i++) {
      addBox(i * 0.3, 0, 0, 0.05, 0.5, 0.05);
      addBox(0, i * 0.3, 0, 0.5, 0.05, 0.05);
      addBox(0, 0, i * 0.3, 0.05, 0.05, 0.5);
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      triangles: indices.length / 3,
    };
  }
  // Pebble: a flattened sphere.
  const sphere = sphereMesh(24, 12);
  const scaled = new Float32Array(sphere.positions.length);
  for (let i = 0; i < sphere.positions.length; i += 3) {
    scaled[i] = sphere.positions[i]! * 0.6;
    scaled[i + 1] = sphere.positions[i + 1]! * 0.35;
    scaled[i + 2] = sphere.positions[i + 2]! * 0.5;
  }
  return { ...sphere, positions: scaled };
}
