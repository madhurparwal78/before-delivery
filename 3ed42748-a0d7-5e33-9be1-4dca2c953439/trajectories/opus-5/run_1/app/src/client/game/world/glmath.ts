export type Vec3 = [number, number, number];
export type Mat4 = Float32Array;

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function normalise(a: Vec3): Vec3 {
  const size = length(a) || 1;
  return [a[0] / size, a[1] / size, a[2] / size];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function perspective(fovYDeg: number, aspect: number, near: number, far: number): Mat4 {
  const out = new Float32Array(16);
  const f = 1 / Math.tan(((fovYDeg * Math.PI) / 180) / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye: Vec3, centre: Vec3, up: Vec3): Mat4 {
  const forward = normalise(sub(centre, eye));
  const side = normalise(cross(forward, up));
  const trueUp = cross(side, forward);
  const out = new Float32Array(16);
  out[0] = side[0];
  out[1] = trueUp[0];
  out[2] = -forward[0];
  out[4] = side[1];
  out[5] = trueUp[1];
  out[6] = -forward[1];
  out[8] = side[2];
  out[9] = trueUp[2];
  out[10] = -forward[2];
  out[12] = -dot(side, eye);
  out[13] = -dot(trueUp, eye);
  out[14] = dot(forward, eye);
  out[15] = 1;
  return out;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[column * 4 + k]!;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A frame whose columns are the given axes, placed at an origin. */
export function frameMatrix(right: Vec3, up: Vec3, forward: Vec3, origin: Vec3): Mat4 {
  const out = new Float32Array(16);
  out[0] = right[0];
  out[1] = right[1];
  out[2] = right[2];
  out[4] = up[0];
  out[5] = up[1];
  out[6] = up[2];
  out[8] = forward[0];
  out[9] = forward[1];
  out[10] = forward[2];
  out[12] = origin[0];
  out[13] = origin[1];
  out[14] = origin[2];
  out[15] = 1;
  return out;
}

export interface Projected {
  x: number;
  y: number;
  depth: number;
  onScreen: boolean;
}

/** Projects a world point to whole viewport pixels through a view-projection matrix. */
export function project(viewProjection: Mat4, point: Vec3, width: number, height: number): Projected {
  const m = viewProjection;
  const clip = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    clip[row] =
      m[0 * 4 + row]! * point[0] +
      m[1 * 4 + row]! * point[1] +
      m[2 * 4 + row]! * point[2] +
      m[3 * 4 + row]!;
  }
  const w = clip[3]!;
  if (w <= 0.0001) return { x: 0, y: 0, depth: -1, onScreen: false };
  const ndcX = clip[0]! / w;
  const ndcY = clip[1]! / w;
  return {
    x: Math.round(((ndcX + 1) / 2) * width),
    y: Math.round(((1 - ndcY) / 2) * height),
    depth: w,
    onScreen: ndcX >= -1 && ndcX <= 1 && ndcY >= -1 && ndcY <= 1,
  };
}

/** True when the planet stands between the eye and a point on its surface. */
export function hiddenByPlanet(eye: Vec3, surfacePoint: Vec3): boolean {
  return dot(normalise(surfacePoint), normalise(sub(eye, surfacePoint))) <= 0.02;
}
