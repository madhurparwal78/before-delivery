export type Mat4 = Float32Array;
export type Vec3 = [number, number, number];

export function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = normalise([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalise(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -dot(x, eye);
  out[13] = -dot(y, eye);
  out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

export function compose(position: Vec3, rotation: Mat4, scale: Vec3): Mat4 {
  const out = new Float32Array(rotation);
  out[0] *= scale[0];
  out[1] *= scale[0];
  out[2] *= scale[0];
  out[4] *= scale[1];
  out[5] *= scale[1];
  out[6] *= scale[1];
  out[8] *= scale[2];
  out[9] *= scale[2];
  out[10] *= scale[2];
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  out[15] = 1;
  return out;
}

export function quaternionMatrix(q: readonly number[]): Mat4 {
  const [x, y, z, w] = q;
  return new Float32Array([
    1 - 2 * (y * y + z * z),
    2 * (x * y + z * w),
    2 * (x * z - y * w),
    0,
    2 * (x * y - z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z + x * w),
    0,
    2 * (x * z + y * w),
    2 * (y * z - x * w),
    1 - 2 * (x * x + y * y),
    0,
    0,
    0,
    0,
    1,
  ]);
}

export function rotationZ(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function normalise(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

export function orbitEye(target: Vec3, distance: number, yaw: number, pitch: number): Vec3 {
  const clamped = Math.max(-1.5, Math.min(1.5, pitch));
  return [
    target[0] + distance * Math.cos(clamped) * Math.sin(yaw),
    target[1] + distance * Math.sin(clamped),
    target[2] + distance * Math.cos(clamped) * Math.cos(yaw),
  ];
}

export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

/** The ray through a canvas pixel, in world space. */
export function screenRay(
  x: number,
  y: number,
  width: number,
  height: number,
  eye: Vec3,
  target: Vec3,
  fovY: number,
): Ray {
  const aspect = width / height;
  const ndcX = (x / width) * 2 - 1;
  const ndcY = 1 - (y / height) * 2;
  const forward = normalise([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = normalise(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const scale = Math.tan(fovY / 2);
  const direction = normalise([
    forward[0] + right[0] * ndcX * scale * aspect + up[0] * ndcY * scale,
    forward[1] + right[1] * ndcX * scale * aspect + up[1] * ndcY * scale,
    forward[2] + right[2] * ndcX * scale * aspect + up[2] * ndcY * scale,
  ]);
  return { origin: eye, direction };
}

/** Where a ray meets the ground plane y = 0, or null when it never does. */
export function groundHit(ray: Ray): Vec3 | null {
  if (Math.abs(ray.direction[1]) < 1e-6) return null;
  const t = -ray.origin[1] / ray.direction[1];
  if (t <= 0) return null;
  return [
    ray.origin[0] + ray.direction[0] * t,
    0,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** The distance along the ray where it enters the box, or null. */
export function boxHit(ray: Ray, box: Box): number | null {
  let near = -Infinity;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];
    if (Math.abs(direction) < 1e-9) {
      if (origin < box.min[axis] || origin > box.max[axis]) return null;
      continue;
    }
    const t1 = (box.min[axis] - origin) / direction;
    const t2 = (box.max[axis] - origin) / direction;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
  }
  if (far < Math.max(near, 0)) return null;
  return near >= 0 ? near : far;
}

/** Projects a world point to canvas pixels, or null when it is behind the camera. */
export function projectPoint(
  point: Vec3,
  viewProjection: Mat4,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const m = viewProjection;
  const clip = [
    m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
    m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
    m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14],
    m[3] * point[0] + m[7] * point[1] + m[11] * point[2] + m[15],
  ];
  if (clip[3] <= 0.0001) return null;
  return {
    x: ((clip[0] / clip[3]) * 0.5 + 0.5) * width,
    y: (0.5 - (clip[1] / clip[3]) * 0.5) * height,
  };
}
