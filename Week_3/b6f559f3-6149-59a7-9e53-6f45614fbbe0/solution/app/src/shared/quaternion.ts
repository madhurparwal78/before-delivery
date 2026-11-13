import type { Mat4 } from './projection';

export type Quat = [number, number, number, number];
export type Triple = [number, number, number];

export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] as number) * (b[column * 4 + k] as number);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** T·R·S as a column-major matrix. */
export function composeMatrix(translation: Triple, rotation: Quat, scale: Triple): Mat4 {
  const [x, y, z, w] = rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  return [
    (1 - 2 * (yy + zz)) * scale[0],
    2 * (xy + wz) * scale[0],
    2 * (xz - wy) * scale[0],
    0,
    2 * (xy - wz) * scale[1],
    (1 - 2 * (xx + zz)) * scale[1],
    2 * (yz + wx) * scale[1],
    0,
    2 * (xz + wy) * scale[2],
    2 * (yz - wx) * scale[2],
    (1 - 2 * (xx + yy)) * scale[2],
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

export function transformByMatrix(m: Mat4, p: Triple): Triple {
  return [
    (m[0] as number) * p[0] + (m[4] as number) * p[1] + (m[8] as number) * p[2] + (m[12] as number),
    (m[1] as number) * p[0] + (m[5] as number) * p[1] + (m[9] as number) * p[2] + (m[13] as number),
    (m[2] as number) * p[0] + (m[6] as number) * p[1] + (m[10] as number) * p[2] + (m[14] as number),
  ];
}

function normaliseQuat(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

/** Normalised slerp; the second quaternion is negated when the dot is negative, and nlerp is used above 0.9995. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let second = b;
  if (dot < 0) {
    second = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normaliseQuat([a[0] + (second[0] - a[0]) * t, a[1] + (second[1] - a[1]) * t, a[2] + (second[2] - a[2]) * t, a[3] + (second[3] - a[3]) * t]);
  }
  const theta = Math.acos(dot);
  const sine = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sine;
  const wb = Math.sin(t * theta) / sine;
  return normaliseQuat([wa * a[0] + wb * second[0], wa * a[1] + wb * second[1], wa * a[2] + wb * second[2], wa * a[3] + wb * second[3]]);
}

/** Euler degrees (X, Y, Z) for the transform order Rz·Ry·Rx. */
export function eulerDegrees(q: Quat): Triple {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m21 = 2 * (x * y + w * z);
  const m31 = 2 * (x * z - w * y);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m31)));
  const degrees = (r: number): number => (r * 180) / Math.PI;
  if (Math.abs(m31) < 0.9999999) return [degrees(Math.atan2(m32, m33)), degrees(pitch), degrees(Math.atan2(m21, m11))];
  const m22 = 1 - 2 * (x * x + z * z);
  return [degrees(Math.atan2(-(2 * (y * z - w * x)), m22)), degrees(pitch), 0];
}
