export type Mat4 = Float32Array;
export type Vec3Tuple = [number, number, number];

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0);
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

export function translation([x, y, z]: Vec3Tuple): Mat4 {
  const m = identity();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

export function scaling([x, y, z]: Vec3Tuple): Mat4 {
  const m = identity();
  m[0] = x;
  m[5] = y;
  m[10] = z;
  return m;
}

function degrees(value: number): number {
  return (value * Math.PI) / 180;
}

export function rotationXYZ([rx, ry, rz]: Vec3Tuple): Mat4 {
  const x = degrees(rx);
  const y = degrees(ry);
  const z = degrees(rz);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  const m = identity();
  m[0] = cy * cz + sy * sx * sz;
  m[1] = cx * sz;
  m[2] = cy * sx * sz - sy * cz;
  m[4] = sy * sx * cz - cy * sz;
  m[5] = cx * cz;
  m[6] = sy * sz + cy * sx * cz;
  m[8] = sy * cx;
  m[9] = -sx;
  m[10] = cy * cx;
  return m;
}

export function compose(position: Vec3Tuple, rotation: Vec3Tuple, scale: Vec3Tuple): Mat4 {
  return multiply(multiply(translation(position), rotationXYZ(rotation)), scaling(scale));
}

export function perspective(fovDegrees: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(degrees(fovDegrees) / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

function normalise(v: Vec3Tuple): Vec3Tuple {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lookAt(eye: Vec3Tuple, target: Vec3Tuple, up: Vec3Tuple): Mat4 {
  const forward = normalise([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const right = normalise(cross(up, forward));
  const trueUp = cross(forward, right);
  const m = identity();
  m[0] = right[0];
  m[4] = right[1];
  m[8] = right[2];
  m[1] = trueUp[0];
  m[5] = trueUp[1];
  m[9] = trueUp[2];
  m[2] = forward[0];
  m[6] = forward[1];
  m[10] = forward[2];
  m[12] = -dot(right, eye);
  m[13] = -dot(trueUp, eye);
  m[14] = -dot(forward, eye);
  return m;
}

export function transformPoint(m: Mat4, p: Vec3Tuple): [number, number, number, number] {
  return [
    (m[0] ?? 0) * p[0] + (m[4] ?? 0) * p[1] + (m[8] ?? 0) * p[2] + (m[12] ?? 0),
    (m[1] ?? 0) * p[0] + (m[5] ?? 0) * p[1] + (m[9] ?? 0) * p[2] + (m[13] ?? 0),
    (m[2] ?? 0) * p[0] + (m[6] ?? 0) * p[1] + (m[10] ?? 0) * p[2] + (m[14] ?? 0),
    (m[3] ?? 0) * p[0] + (m[7] ?? 0) * p[1] + (m[11] ?? 0) * p[2] + (m[15] ?? 0),
  ];
}
