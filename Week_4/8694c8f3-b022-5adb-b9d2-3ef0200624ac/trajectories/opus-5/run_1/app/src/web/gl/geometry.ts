export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
}

function build(
  vertices: { position: [number, number, number]; normal: [number, number, number]; uv: [number, number] }[],
  indices: number[],
): MeshData {
  const positions = new Float32Array(vertices.length * 3);
  const normals = new Float32Array(vertices.length * 3);
  const uvs = new Float32Array(vertices.length * 2);
  vertices.forEach((vertex, index) => {
    positions.set(vertex.position, index * 3);
    normals.set(vertex.normal, index * 3);
    uvs.set(vertex.uv, index * 2);
  });
  return { positions, normals, uvs, indices: new Uint16Array(indices) };
}

export function cube(): MeshData {
  const faces: [[number, number, number], [number, number, number], [number, number, number]][] = [
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  ];
  const vertices: Parameters<typeof build>[0] = [];
  const indices: number[] = [];
  faces.forEach((face, faceIndex) => {
    const [normal, right, up] = face;
    for (const [sx, sy, u, v] of [
      [-1, -1, 0, 0],
      [1, -1, 1, 0],
      [1, 1, 1, 1],
      [-1, 1, 0, 1],
    ] as [number, number, number, number][]) {
      vertices.push({
        position: [
          (normal[0] + right[0] * sx + up[0] * sy) * 0.5,
          (normal[1] + right[1] * sx + up[1] * sy) * 0.5,
          (normal[2] + right[2] * sx + up[2] * sy) * 0.5,
        ],
        normal,
        uv: [u, v],
      });
    }
    const base = faceIndex * 4;
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  return build(vertices, indices);
}

export function sphere(segments = 24, rings = 16): MeshData {
  const vertices: Parameters<typeof build>[0] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const phi = (ring / rings) * Math.PI;
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const normal: [number, number, number] = [
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ];
      vertices.push({
        position: [normal[0] * 0.5, normal[1] * 0.5, normal[2] * 0.5],
        normal,
        uv: [segment / segments, 1 - ring / rings],
      });
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return build(vertices, indices);
}

export function plane(): MeshData {
  return build(
    [
      { position: [-0.5, 0, -0.5], normal: [0, 1, 0], uv: [0, 0] },
      { position: [0.5, 0, -0.5], normal: [0, 1, 0], uv: [1, 0] },
      { position: [0.5, 0, 0.5], normal: [0, 1, 0], uv: [1, 1] },
      { position: [-0.5, 0, 0.5], normal: [0, 1, 0], uv: [0, 1] },
    ],
    [0, 1, 2, 0, 2, 3],
  );
}

export function torus(majorSegments = 32, minorSegments = 16, majorRadius = 0.5, minorRadius = 0.18): MeshData {
  const vertices: Parameters<typeof build>[0] = [];
  const indices: number[] = [];
  for (let major = 0; major <= majorSegments; major += 1) {
    const u = (major / majorSegments) * Math.PI * 2;
    for (let minor = 0; minor <= minorSegments; minor += 1) {
      const v = (minor / minorSegments) * Math.PI * 2;
      const normal: [number, number, number] = [Math.cos(u) * Math.cos(v), Math.sin(v), Math.sin(u) * Math.cos(v)];
      vertices.push({
        position: [
          (majorRadius + minorRadius * Math.cos(v)) * Math.cos(u),
          minorRadius * Math.sin(v),
          (majorRadius + minorRadius * Math.cos(v)) * Math.sin(u),
        ],
        normal,
        uv: [major / majorSegments, minor / minorSegments],
      });
    }
  }
  for (let major = 0; major < majorSegments; major += 1) {
    for (let minor = 0; minor < minorSegments; minor += 1) {
      const a = major * (minorSegments + 1) + minor;
      const b = a + minorSegments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return build(vertices, indices);
}

/** A tube runs along Y; the vertex shader twists and widens it from the layer's props. */
export function tube(segments = 36, rings = 24, length = 6): MeshData {
  const vertices: Parameters<typeof build>[0] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const y = (ring / rings - 0.5) * length;
    for (let segment = 0; segment <= segments; segment += 1) {
      const theta = (segment / segments) * Math.PI * 2;
      const normal: [number, number, number] = [-Math.cos(theta), 0, -Math.sin(theta)];
      vertices.push({
        position: [Math.cos(theta), y, Math.sin(theta)],
        normal,
        uv: [segment / segments, ring / rings],
      });
    }
  }
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const a = ring * (segments + 1) + segment;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return build(vertices, indices);
}

/** The stage grid, with its axis lines drawn separately. */
export function gridLines(half = 10, step = 1): { grid: Float32Array; axes: Float32Array } {
  const grid: number[] = [];
  const axes: number[] = [];
  for (let i = -half; i <= half; i += step) {
    if (i === 0) {
      axes.push(-half, 0, 0, half, 0, 0, 0, 0, -half, 0, 0, half);
      continue;
    }
    grid.push(-half, 0, i, half, 0, i, i, 0, -half, i, 0, half);
  }
  return { grid: new Float32Array(grid), axes: new Float32Array(axes) };
}
