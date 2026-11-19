export type Vec3 = [number, number, number];

export interface Triangle {
  a: Vec3;
  b: Vec3;
  c: Vec3;
}

export interface Mesh {
  triangles: Triangle[];
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

export const subtractVec = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const crossVec = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const dotVec = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const lengthVec = (a: Vec3): number => Math.sqrt(dotVec(a, a));
export const normaliseVec = (a: Vec3): Vec3 => {
  const length = lengthVec(a);
  return length === 0 ? [0, 0, 0] : [a[0] / length, a[1] / length, a[2] / length];
};

/** Signed volume of a closed triangle mesh, in cubic millimetres. */
export const meshVolume = (mesh: Mesh): number => {
  let total = 0;
  for (const triangle of mesh.triangles) {
    total += dotVec(triangle.a, crossVec(triangle.b, triangle.c));
  }
  return total / 6;
};

export const meshBox = (mesh: Mesh): Box => {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const triangle of mesh.triangles) {
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], corner[axis]);
        max[axis] = Math.max(max[axis], corner[axis]);
      }
    }
  }
  return { min, max };
};

export const boxSize = (box: Box): Vec3 => [
  box.max[0] - box.min[0],
  box.max[1] - box.min[1],
  box.max[2] - box.min[2],
];

export const boxCentre = (box: Box): Vec3 => [
  (box.min[0] + box.max[0]) / 2,
  (box.min[1] + box.max[1]) / 2,
  (box.min[2] + box.max[2]) / 2,
];

export const mergeBoxes = (boxes: Box[]): Box => {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], box.min[axis]);
      max[axis] = Math.max(max[axis], box.max[axis]);
    }
  }
  return { min, max };
};

export const transformMesh = (mesh: Mesh, move: (point: Vec3) => Vec3): Mesh => ({
  triangles: mesh.triangles.map((triangle) => ({
    a: move(triangle.a),
    b: move(triangle.b),
    c: move(triangle.c),
  })),
});

export const rotateZ = (point: Vec3, degrees: number): Vec3 => {
  if (degrees === 0) return [point[0], point[1], point[2]];
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [point[0] * cos - point[1] * sin, point[0] * sin + point[1] * cos, point[2]];
};

export const triangleNormal = (triangle: Triangle): Vec3 =>
  normaliseVec(crossVec(subtractVec(triangle.b, triangle.a), subtractVec(triangle.c, triangle.a)));
