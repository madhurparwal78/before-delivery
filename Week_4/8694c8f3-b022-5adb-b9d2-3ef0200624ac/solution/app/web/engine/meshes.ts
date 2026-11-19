export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array | Uint32Array;
}

function finish(positions: number[], normals: number[], uvs: number[], indices: number[]): MeshData {
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
  };
}

export function cubeMesh(): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  for (const [n, u, v] of faces) {
    const base = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      positions.push(
        0.5 * (n[0]! + u[0]! * a + v[0]! * b), 0.5 * (n[1]! + u[1]! * a + v[1]! * b), 0.5 * (n[2]! + u[2]! * a + v[2]! * b),
      );
      normals.push(...n);
      uvs.push((a + 1) / 2, (b + 1) / 2);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return finish(positions, normals, uvs, indices);
}

export function sphereMesh(segments = 28, rings = 18): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i += 1) {
    const phi = (i / rings) * Math.PI;
    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * Math.PI * 2;
      const n = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
      positions.push(n[0]! * 0.5, n[1]! * 0.5, n[2]! * 0.5);
      normals.push(...n);
      uvs.push(j / segments, i / rings);
    }
  }
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finish(positions, normals, uvs, indices);
}

export function planeMesh(): MeshData {
  return finish(
    [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5],
    [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    [0, 0, 1, 0, 1, 1, 0, 1],
    [0, 2, 1, 0, 3, 2],
  );
}

export function torusMesh(major = 0.36, minor = 0.14, segments = 36, sides = 18): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i += 1) {
    const u = (i / segments) * Math.PI * 2;
    for (let j = 0; j <= sides; j += 1) {
      const v = (j / sides) * Math.PI * 2;
      const n = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
      positions.push((major + minor * Math.cos(v)) * Math.cos(u), minor * Math.sin(v), (major + minor * Math.cos(v)) * Math.sin(u));
      normals.push(...n);
      uvs.push(i / segments, j / sides);
    }
  }
  for (let i = 0; i < segments; i += 1) {
    for (let j = 0; j < sides; j += 1) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finish(positions, normals, uvs, indices);
}

/** An open cylinder along Y with unit radius and unit length; the vertex shader twists and scales it. */
export function tubeMesh(segments = 48, slices = 48): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= slices; i += 1) {
    const y = i / slices - 0.5;
    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * Math.PI * 2;
      positions.push(Math.cos(theta), y, Math.sin(theta));
      normals.push(Math.cos(theta), 0, Math.sin(theta));
      uvs.push(j / segments, i / slices);
    }
  }
  for (let i = 0; i < slices; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return finish(positions, normals, uvs, indices);
}
