// Column-major 4x4 matrices as WebGL expects them, plus the few constructors the Helix scene needs.

export type Mat4 = Float32Array
export type Vec3 = readonly [number, number, number]

function identity(): Mat4 {
  const m = new Float32Array(16)
  m[0] = 1
  m[5] = 1
  m[10] = 1
  m[15] = 1
  return m
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] ?? 0) * (b[col * 4 + k] ?? 0)
      out[col * 4 + row] = sum
    }
  }
  return out
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  const m = new Float32Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity()
  m[12] = x
  m[13] = y
  m[14] = z
  return m
}

function rotationX(angle: number): Mat4 {
  const m = identity()
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  m[5] = c
  m[6] = s
  m[9] = -s
  m[10] = c
  return m
}

export function rotationY(angle: number): Mat4 {
  const m = identity()
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  m[0] = c
  m[2] = -s
  m[8] = s
  m[10] = c
  return m
}

/** A view matrix for an eye at `eye` looking at `target` with +Y up. */
export function lookAt(eye: Vec3, target: Vec3): Mat4 {
  let fx = target[0] - eye[0]
  let fy = target[1] - eye[1]
  let fz = target[2] - eye[2]
  const fl = Math.hypot(fx, fy, fz)
  fx /= fl
  fy /= fl
  fz /= fl
  const sl = Math.hypot(fx, fz)
  const sx = -fz / sl
  const sy = 0
  const sz = fx / sl
  const ux = sy * fz - sz * fy
  const uy = sz * fx - sx * fz
  const uz = sx * fy - sy * fx
  const m = new Float32Array(16)
  m[0] = sx
  m[4] = sy
  m[8] = sz
  m[1] = ux
  m[5] = uy
  m[9] = uz
  m[2] = -fx
  m[6] = -fy
  m[10] = -fz
  m[12] = -(sx * eye[0] + sy * eye[1] + sz * eye[2])
  m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2])
  m[14] = fx * eye[0] + fy * eye[1] + fz * eye[2]
  m[15] = 1
  return m
}

/** Translation, then rotation about X, then rotation about Y (applied to a point in the opposite order). */
export function pose(position: Vec3, pitch: number, yaw: number): Mat4 {
  return multiply(translation(position[0], position[1], position[2]), multiply(rotationX(pitch), rotationY(yaw)))
}
