// 3D math: vectors, matrices, transforms, projection — exactly as published.
import type { Vec3 } from './types.js';

export type Mat4 = Float64Array; // column-major, length 16

export const DEG = Math.PI / 180;

export function v3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function mul(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return mul(a, 1 / l);
}

export function identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = p.x, y = p.y, z = p.z;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

export function translation(t: Vec3): Mat4 {
  const m = identity();
  m[12] = t.x; m[13] = t.y; m[14] = t.z;
  return m;
}

export function scaling(s: Vec3): Mat4 {
  const m = identity();
  m[0] = s.x; m[5] = s.y; m[10] = s.z;
  return m;
}

export function rotX(deg: number): Mat4 {
  const a = deg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

export function rotY(deg: number): Mat4 {
  const a = deg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function rotZ(deg: number): Mat4 {
  const a = deg * DEG;
  const c = Math.cos(a), s = Math.sin(a);
  const m = identity();
  m[0] = c; m[1] = s; m[4] = -s; m[5] = c;
  return m;
}

// Layer transform: v' = T·Rz·Ry·Rx·S·v
export function layerMatrix(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  let m = translation(position);
  m = multiply(m, rotZ(rotation.z));
  m = multiply(m, rotY(rotation.y));
  m = multiply(m, rotX(rotation.x));
  m = multiply(m, scaling(scale));
  return m;
}

export function lookAt(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  // Standard right-handed lookAt: the camera looks down −z, so the rows of
  // the rotation carry the basis axes (x, y, z) and the translation is
  // −axis·eye. Stored column-major, so the basis vectors run along the rows.
  const zAxis = normalize(sub(eye, target));
  let xAxis = cross(up, zAxis);
  if (length(xAxis) < 1e-9) {
    xAxis = cross(v3(0, 1, 0), zAxis);
    if (length(xAxis) < 1e-9) xAxis = cross(v3(1, 0, 0), zAxis);
  }
  xAxis = normalize(xAxis);
  const yAxis = cross(zAxis, xAxis);
  const m = new Float64Array(16);
  m[0] = xAxis.x; m[4] = xAxis.y; m[8] = xAxis.z; m[12] = -dot(xAxis, eye);
  m[1] = yAxis.x; m[5] = yAxis.y; m[9] = yAxis.z; m[13] = -dot(yAxis, eye);
  m[2] = zAxis.x; m[6] = zAxis.y; m[10] = zAxis.z; m[14] = -dot(zAxis, eye);
  m[3] = 0; m[7] = 0; m[11] = 0; m[15] = 1;
  return m;
}

export interface ProjectResult {
  x: number;
  y: number;
  zc: number;
  visible: boolean;
}

// f = 1/tan(fov/2); ndc x = (f/aspect)·xc/(−zc), ndc y = f·yc/(−zc)
export function projectToScreen(
  world: Vec3,
  view: Mat4,
  fovDeg: number,
  W: number,
  H: number,
  near: number,
  far: number,
): ProjectResult {
  const c = transformPoint(view, world);
  const f = 1 / Math.tan((fovDeg * DEG) / 2);
  const aspect = W / H;
  const nzc = -c.z;
  if (nzc < near || nzc > far || nzc === 0) {
    return { x: NaN, y: NaN, zc: c.z, visible: false };
  }
  const ndcX = ((f / aspect) * c.x) / nzc;
  const ndcY = (f * c.y) / nzc;
  return {
    x: ((ndcX + 1) / 2) * W,
    y: ((1 - ndcY) / 2) * H,
    zc: c.z,
    visible: true,
  };
}

export function quaternionFromAxisAngle(axis: 'x' | 'y' | 'z', deg: number): [number, number, number, number] {
  const a = (deg * DEG) / 2;
  const s = Math.sin(a);
  const c = Math.cos(a);
  if (axis === 'x') return [s, 0, 0, c];
  if (axis === 'y') return [0, s, 0, c];
  return [0, 0, s, c];
}

export function normalizeQuat(q: [number, number, number, number]): [number, number, number, number] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  if (l === 0) return [0, 0, 0, 1];
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function quatDot(a: [number, number, number, number], b: [number, number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}

export function quatSlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let q1 = normalizeQuat(a);
  let q2 = normalizeQuat(b);
  let d = quatDot(q1, q2);
  if (d < 0) {
    q2 = [-q2[0], -q2[1], -q2[2], -q2[3]];
    d = -d;
  }
  if (d > 0.9995) {
    const l: [number, number, number, number] = [
      q1[0] + t * (q2[0] - q1[0]),
      q1[1] + t * (q2[1] - q1[1]),
      q1[2] + t * (q2[2] - q1[2]),
      q1[3] + t * (q2[3] - q1[3]),
    ];
    return normalizeQuat(l);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, d)));
  const s = Math.sin(theta);
  const w1 = Math.sin((1 - t) * theta) / s;
  const w2 = Math.sin(t * theta) / s;
  return normalizeQuat([w1 * q1[0] + w2 * q2[0], w1 * q1[1] + w2 * q2[1], w1 * q1[2] + w2 * q2[2], w1 * q1[3] + w2 * q2[3]]);
}

export function quatToEulerXYZ(q: [number, number, number, number]): Vec3 {
  // The transform order is Rx then Ry then Rz, so the matrix is
  // R = Rz(ψ)·Ry(θ)·Rx(φ), and the angles come out of that matrix.
  const [x, y, z, w] = q;
  const m = quatToMatrix({ x, y, z, w });
  // m[8] holds R[0][2] = sin θ for the Rz·Ry·Rx composition.
  const sy = m[8];
  const thetaY = Math.asin(Math.max(-1, Math.min(1, sy)));
  let phi: number;
  let psi: number;
  if (Math.abs(sy) < 0.99999) {
    // m[9] = R[1][2] = cosθ·sinφ? For R = Rz·Ry·Rx: R[1][2] = cosθ sinφ and
    // R[2][2] = cosθ cosφ, so φ = atan2(m[9], m[10]).
    phi = Math.atan2(m[9], m[10]);
    // m[4] = R[0][1] = cosθ sinψ and m[0] = R[0][0] = cosθ cosψ.
    psi = Math.atan2(m[4], m[0]);
  } else {
    phi = Math.atan2(-m[6], m[5]);
    psi = 0;
  }
  return { x: phi / DEG, y: thetaY / DEG, z: psi / DEG };
}

export function quatToMatrix(q: { x: number; y: number; z: number; w: number }): Mat4 {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m = identity();
  m[0] = 1 - (yy + zz); m[1] = xy + wz; m[2] = xz - wy;
  m[4] = xy - wz; m[5] = 1 - (xx + zz); m[6] = yz + wx;
  m[8] = xz + wy; m[9] = yz - wx; m[10] = 1 - (xx + yy);
  return m;
}
