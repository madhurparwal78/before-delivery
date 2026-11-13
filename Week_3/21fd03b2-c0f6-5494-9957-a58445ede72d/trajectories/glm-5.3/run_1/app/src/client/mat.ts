// Small matrix/vector helpers for the renderer.
import type { SceneObject } from '../bench/scene';

export type Mat4Like = Float32Array;

export const mat4 = {
  identity(): Mat4Like {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
  },
  multiply(a: Mat4Like, b: Mat4Like): Mat4Like {
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += a[k * 4 + j]! * b[i * 4 + k]!;
        out[i * 4 + j] = sum;
      }
    }
    return out;
  },
  translation(x: number, y: number, z: number): Mat4Like {
    const m = mat4.identity();
    m[12] = x;
    m[13] = y;
    m[14] = z;
    return m;
  },
  scale(x: number, y: number, z: number): Mat4Like {
    const m = mat4.identity();
    m[0] = x;
    m[5] = y;
    m[10] = z;
    return m;
  },
  fromObject(object: SceneObject): Mat4Like {
    // rotation quaternion [x,y,z,w] to matrix
    const [qx, qy, qz, qw] = object.rotation;
    const x2 = (qx ?? 0) * 2, y2 = (qy ?? 0) * 2, z2 = (qz ?? 0) * 2;
    const xx = (qx ?? 0) * x2, yy = (qy ?? 0) * y2, zz = (qz ?? 0) * z2;
    const xy = (qx ?? 0) * y2, xz = (qx ?? 0) * z2, yz = (qy ?? 0) * z2;
    const wx = (qw ?? 1) * x2, wy = (qw ?? 1) * y2, wz = (qw ?? 1) * z2;
    const m = mat4.identity();
    m[0] = 1 - (yy + zz);
    m[1] = xy + wz;
    m[2] = xz - wy;
    m[4] = xy - wz;
    m[5] = 1 - (xx + zz);
    m[6] = yz + wx;
    m[8] = xz + wy;
    m[9] = yz - wx;
    m[10] = 1 - (xx + yy);
    const s = mat4.scale(object.scale[0], object.scale[1], object.scale[2]);
    return mat4.multiply(m, s);
  },
  perspective(fovy: number, aspect: number, near: number, far: number): Mat4Like {
    const f = 1 / Math.tan(fovy / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect;
    m[5] = f;
    m[10] = (far + near) / (near - far);
    m[11] = -1;
    m[14] = (2 * far * near) / (near - far);
    return m;
  },
  orbit(camera: { yaw: number; pitch: number; distance: number; target: [number, number, number] }): { eye: [number, number, number] } {
    const cp = Math.cos(camera.pitch);
    const eye: [number, number, number] = [
      camera.target[0] + camera.distance * cp * Math.sin(camera.yaw),
      camera.target[1] + camera.distance * Math.sin(camera.pitch),
      camera.target[2] + camera.distance * cp * Math.cos(camera.yaw),
    ];
    return { eye };
  },
  lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4Like {
    let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    const m = new Float32Array(16);
    m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
    m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
    m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
    m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    m[15] = 1;
    return m;
  },
};

export const vec3 = {
  add(a: [number, number, number], b: [number, number, number]): [number, number, number] {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  },
};
