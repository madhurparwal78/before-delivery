/** Loaf proportions in world units; the loaf is one unit long whatever its bar count. */
export const LOAF = {
  length: 1,
  height: 0.26,
  depth: 0.24,
  dome: 0.028,
  pitchDegrees: 14,
  /** Share of the figure's width the standing loaf takes. */
  widthShare: 0.78,
  /** Where world y = 0 sits down the figure. */
  baselineShare: 0.5,
} as const;

export const FACE = { front: 0, cut: 1, top: 2, plain: 3 } as const;

export type Mesh = {
  positions: Float32Array;
  normals: Float32Array;
  faces: Float32Array;
  uvs: Float32Array;
  count: number;
};

type Vertex = {
  position: [number, number, number];
  normal: [number, number, number];
  face: number;
  uv: [number, number];
};

function quad(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
  normal: [number, number, number],
  face: number,
): Vertex[] {
  const uv: [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1],
  ];
  const points = [a, b, c, a, c, d];
  return points.map((position, index) => ({
    position,
    normal,
    face,
    uv: uv[index] as [number, number],
  }));
}

function domeAt(z: number): number {
  // A cylindrical rise along the loaf's length, so the crest runs unbroken across every bar.
  return LOAF.dome * Math.sin(Math.PI * (z + 0.5));
}

function handTexture(x: number, z: number): number {
  return 0.1 * LOAF.dome * Math.sin(x * 37) * Math.cos(z * 23);
}

function toMesh(vertices: readonly Vertex[]): Mesh {
  return {
    positions: new Float32Array(vertices.flatMap((vertex) => vertex.position)),
    normals: new Float32Array(vertices.flatMap((vertex) => vertex.normal)),
    faces: new Float32Array(vertices.map((vertex) => vertex.face)),
    uvs: new Float32Array(vertices.flatMap((vertex) => vertex.uv)),
    count: vertices.length,
  };
}

/**
 * One bar in local coordinates: x and z from -0.5 to 0.5, y from 0 to 1. The caller scales it into
 * its slot, and the dome is evaluated in loaf coordinates so it lines up across neighbours.
 */
export function buildBarMesh(centreX: number, slotWidth: number): Mesh {
  const vertices: Vertex[] = [];
  const half = 0.5;
  const topY = (x: number, z: number): number =>
    1 + (domeAt(z) + handTexture(centreX + x * slotWidth, z)) / LOAF.height;

  vertices.push(
    ...quad(
      [-half, 0, half],
      [half, 0, half],
      [half, topY(half, half), half],
      [-half, topY(-half, half), half],
      [0, 0, 1],
      FACE.front,
    ),
  );
  vertices.push(
    ...quad(
      [half, 0, -half],
      [-half, 0, -half],
      [-half, topY(-half, -half), -half],
      [half, topY(half, -half), -half],
      [0, 0, -1],
      FACE.plain,
    ),
  );
  vertices.push(
    ...quad(
      [half, 0, half],
      [half, 0, -half],
      [half, topY(half, -half), -half],
      [half, topY(half, half), half],
      [1, 0, 0],
      FACE.cut,
    ),
  );
  vertices.push(
    ...quad(
      [-half, 0, -half],
      [-half, 0, half],
      [-half, topY(-half, half), half],
      [-half, topY(-half, -half), -half],
      [-1, 0, 0],
      FACE.cut,
    ),
  );
  vertices.push(
    ...quad([-half, 0, -half], [half, 0, -half], [half, 0, half], [-half, 0, half], [0, -1, 0], FACE.plain),
  );

  const steps = 8;
  for (let index = 0; index < steps; index += 1) {
    const z0 = -half + index / steps;
    const z1 = -half + (index + 1) / steps;
    const slope = (domeAt(z1) - domeAt(z0)) / LOAF.height;
    const length = Math.hypot(1, slope);
    const normal: [number, number, number] = [0, 1 / length, -slope / length];
    vertices.push(
      ...quad(
        [-half, topY(-half, z0), z0],
        [half, topY(half, z0), z0],
        [half, topY(half, z1), z1],
        [-half, topY(-half, z1), z1],
        normal,
        FACE.top,
      ),
    );
  }
  return toMesh(vertices);
}

export function buildBoxMesh(): Mesh {
  const vertices: Vertex[] = [];
  const h = 0.5;
  vertices.push(...quad([-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h], [0, 0, 1], FACE.plain));
  vertices.push(...quad([h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h], [0, 0, -1], FACE.plain));
  vertices.push(...quad([h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h], [1, 0, 0], FACE.plain));
  vertices.push(...quad([-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h], [-1, 0, 0], FACE.plain));
  vertices.push(...quad([-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h], [0, 1, 0], FACE.plain));
  vertices.push(...quad([-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h], [0, -1, 0], FACE.plain));
  return toMesh(vertices);
}

export type Camera = {
  scale: number;
  originX: number;
  originY: number;
  yawRadians: number;
  pitchRadians: number;
};

export function cameraFor(width: number, height: number, yawDegrees: number): Camera {
  return {
    scale: (LOAF.widthShare * width) / LOAF.length,
    originX: width / 2,
    originY: height * LOAF.baselineShare,
    yawRadians: (yawDegrees * Math.PI) / 180,
    pitchRadians: (LOAF.pitchDegrees * Math.PI) / 180,
  };
}

/** Screen position in CSS pixels, measured from the figure box's top-left corner. */
export function project(camera: Camera, x: number, y: number, z: number): { x: number; y: number } {
  const rotatedX = x * Math.cos(camera.yawRadians) + z * Math.sin(camera.yawRadians);
  const rotatedZ = -x * Math.sin(camera.yawRadians) + z * Math.cos(camera.yawRadians);
  const vertical = y * Math.cos(camera.pitchRadians) - rotatedZ * Math.sin(camera.pitchRadians);
  return {
    x: camera.originX + camera.scale * rotatedX,
    y: camera.originY - camera.scale * vertical,
  };
}

export function barEdgeX(barsTotal: number, index: number): number {
  return -LOAF.length / 2 + (LOAF.length * index) / barsTotal;
}

export type Mat4 = Float32Array;

/** Column-major 4x4 helpers; `multiply(a, b)` applies b first, then a. */
export function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] as number) * (b[column * 4 + k] as number);
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const out = identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scaling(x: number, y: number, z: number): Mat4 {
  const out = identity();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotationX(radians: number): Mat4 {
  const out = identity();
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out[5] = c;
  out[6] = s;
  out[9] = -s;
  out[10] = c;
  return out;
}

export function rotationY(radians: number): Mat4 {
  const out = identity();
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

/** Orthographic view-projection matching `project`, with nearer geometry at smaller clip z. */
export function viewProjection(camera: Camera, width: number, height: number): Mat4 {
  const view = multiply(rotationX(camera.pitchRadians), rotationY(camera.yawRadians));
  const pixels = multiply(
    translation((2 * camera.originX) / width - 1, 1 - (2 * camera.originY) / height, 0),
    scaling((2 * camera.scale) / width, (2 * camera.scale) / height, -1),
  );
  return multiply(pixels, view);
}
