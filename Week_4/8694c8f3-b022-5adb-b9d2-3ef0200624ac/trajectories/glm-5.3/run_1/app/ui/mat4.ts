// Minimal column-major 4x4 matrix math for the stage renderer.
export type Mat4 = Float32Array;

export function identity (): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function multiply (a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function translation (x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function rotationXYZ (rx: number, ry: number, rz: number): Mat4 {
  const rad = (d: number): number => d * Math.PI / 180;
  const cx = Math.cos(rad(rx)), sx = Math.sin(rad(rx));
  const cy = Math.cos(rad(ry)), sy = Math.sin(rad(ry));
  const cz = Math.cos(rad(rz)), sz = Math.sin(rad(rz));
  const mx = identity();
  mx[5] = cx; mx[6] = sx; mx[9] = -sx; mx[10] = cx;
  const my = identity();
  my[0] = cy; my[2] = -sy; my[8] = sy; my[10] = cy;
  const mz = identity();
  mz[0] = cz; mz[1] = sz; mz[4] = -sz; mz[5] = cz;
  return multiply(multiply(mx, my), mz);
}

export function scaling (x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[0] = x; m[5] = y; m[10] = z;
  return m;
}

export function perspective (fovDegrees: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovDegrees * Math.PI / 360);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

export function lookAt (eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Mat4 {
  const subtract = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]): number[] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const normalize = (v: number[]): number[] => {
    const length = Math.hypot(v[0], v[1], v[2]);
    return length === 0 ? [0, 0, 0] : [v[0] / length, v[1] / length, v[2] / length];
  };
  const zAxis = normalize(subtract(eye, center));
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  const m = identity();
  m[0] = xAxis[0]; m[4] = xAxis[1]; m[8] = xAxis[2];
  m[1] = yAxis[0]; m[5] = yAxis[1]; m[9] = yAxis[2];
  m[2] = zAxis[0]; m[6] = zAxis[1]; m[10] = zAxis[2];
  m[12] = -(xAxis[0] * eye[0] + xAxis[1] * eye[1] + xAxis[2] * eye[2]);
  m[13] = -(yAxis[0] * eye[0] + yAxis[1] * eye[1] + yAxis[2] * eye[2]);
  m[14] = -(zAxis[0] * eye[0] + zAxis[1] * eye[1] + zAxis[2] * eye[2]);
  return m;
}

// Transforms a world point into clip space; used for gizmo grip positions.
export function transformPoint (m: Mat4, p: [number, number, number]): [number, number, number, number] {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x, y, z, w];
}
