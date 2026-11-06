/**
 * A small WebGL helper: builds the light cones and room from code shapes.
 * Falls back to canvas 2D drawings when WebGL is unavailable.
 */

export interface Shape3D {
  vertices: number[]
  colors: number[]
  indices: number[]
}

export function has_webgl(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl'))
  } catch {
    return false
  }
}

/** Compile a flat-shaded shape into buffers and a draw function. */
export function make_shape(gl: WebGLRenderingContext, shape: Shape3D): { draw: (mvp: number[], model: number[]) => void } {
  const vertex_buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer)
    const interleaved: number[] = []
  for (let i = 0; i < shape.vertices.length / 3; i++) {
    interleaved.push(shape.vertices[i * 3]!, shape.vertices[i * 3 + 1]!, shape.vertices[i * 3 + 2]!)
    interleaved.push(shape.colors[i * 3]!, shape.colors[i * 3 + 1]!, shape.colors[i * 3 + 2]!)
  }
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(interleaved), gl.STATIC_DRAW)

  const index_buffer = gl.createBuffer()!
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(shape.indices), gl.STATIC_DRAW)

  const vertex_source = `
    attribute vec3 a_pos;
    attribute vec3 a_color;
    uniform mat4 u_mvp;
    uniform mat4 u_model;
    varying vec3 v_color;
    varying float v_depth;
    void main() {
      vec4 world = u_model * vec4(a_pos, 1.0);
      gl_Position = u_mvp * vec4(a_pos, 1.0);
      v_color = a_color;
      v_depth = clamp((world.z + 3.0) / 6.0, 0.0, 1.0);
    }
  `
  const fragment_source = `
    precision mediump float;
    varying vec3 v_color;
    varying float v_depth;
    void main() {
      vec3 lightened = mix(v_color * 0.45, v_color, v_depth + 0.4);
      gl_FragColor = vec4(lightened, 1.0);
    }
  `
  const program = build_program(gl, vertex_source, fragment_source)
  const pos = gl.getAttribLocation(program, 'a_pos')
  const color = gl.getAttribLocation(program, 'a_color')
  const u_mvp = gl.getUniformLocation(program, 'u_mvp')
  const u_model = gl.getUniformLocation(program, 'u_model')
  const stride = 6 * 4

  return {
    draw(mvp: number[], model: number[]) {
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex_buffer)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index_buffer)
      gl.enableVertexAttribArray(pos)
      gl.enableVertexAttribArray(color)
      gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, stride, 0)
      gl.vertexAttribPointer(color, 3, gl.FLOAT, false, stride, 3 * 4)
      gl.uniformMatrix4fv(u_mvp, false, new Float32Array(mvp))
      gl.uniformMatrix4fv(u_model, false, new Float32Array(model))
      gl.drawElements(gl.TRIANGLES, shape.indices.length, gl.UNSIGNED_SHORT, 0)
    },
  }
}

function build_program(gl: WebGLRenderingContext, vs_source: string, fs_source: string): WebGLProgram {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    return shader
  }
  const program = gl.createProgram()!
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs_source))
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs_source))
  gl.linkProgram(program)
  return program
}

/** Perspective matrix (column-major). */
export function perspective(fov_deg: number, aspect: number, near: number, far: number): number[] {
  const f = 1 / Math.tan((fov_deg * Math.PI) / 360)
  const nf = 1 / (near - far)
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]
}

/** Rotation around Y plus a translation (column-major model matrix). */
export function model_matrix(yaw: number, tx = 0, ty = 0, tz = 0): number[] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    tx, ty, tz, 1,
  ]
}

export function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16).fill(0)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + j]! * b[i * 4 + k]!
      }
      out[i * 4 + j] = sum
    }
  }
  return out
}

/** Cylinder side wall with flat normals baked into per-face vertices. */
export function cylinder_shape(radius: number, height: number, segments: number, color: number[]): Shape3D {
  const vertices: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const x0 = Math.cos(a0) * radius
    const z0 = Math.sin(a0) * radius
    const x1 = Math.cos(a1) * radius
    const z1 = Math.sin(a1) * radius
    const base = vertices.length / 3
    // two triangles for the side, plus a fan for the top cap
    vertices.push(x0, 0, z0, x1, 0, z1, x1, height, z1)
    vertices.push(x0, 0, z0, x1, height, z1, x0, height, z0)
    for (let k = 0; k < 6; k++) colors.push(...shade(color, 1))
    indices.push(base, base + 1, base + 2, base + 3, base + 4, base + 5)
    const cap_center = vertices.length / 3
    vertices.push(0, height, 0, x0, height, z0, x1, height, z1)
    for (let k = 0; k < 3; k++) colors.push(...shade(color, 0.85))
    indices.push(cap_center, cap_center + 1, cap_center + 2)
  }
  return { vertices, colors, indices }
}

/** A light cone from a fitting down to its pool. */
export function cone_shape(top_radius: number, bottom_radius: number, height: number, segments: number, color: number[]): Shape3D {
  const vertices: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const base = vertices.length / 3
    vertices.push(
      Math.cos(a0) * top_radius, 0, Math.sin(a0) * top_radius,
      Math.cos(a1) * top_radius, 0, Math.sin(a1) * top_radius,
      Math.cos(a1) * bottom_radius, height, Math.sin(a1) * bottom_radius,
      Math.cos(a0) * bottom_radius, height, Math.sin(a0) * bottom_radius,
    )
    for (let k = 0; k < 4; k++) colors.push(...shade(color, 0.55))
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { vertices, colors, indices }
}

/** A flat floor disc for the light pool. */
export function disc_shape(radius: number, segments: number, color: number[]): Shape3D {
  const vertices: number[] = [0, 0, 0]
  const colors: number[] = [...shade(color, 1)]
  const indices: number[] = []
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    vertices.push(Math.cos(a0) * radius, 0, Math.sin(a0) * radius)
    colors.push(...shade(color, 1))
  }
  for (let i = 0; i < segments; i++) {
    indices.push(0, i + 1, ((i + 1) % segments) + 1)
  }
  return { vertices, colors, indices }
}

/** A quad on the XZ plane. */
export function quad_shape(width: number, depth: number, color: number[]): Shape3D {
  return {
    vertices: [
      -width / 2, 0, -depth / 2,
      width / 2, 0, -depth / 2,
      width / 2, 0, depth / 2,
      -width / 2, 0, depth / 2,
    ],
    colors: [...shade(color, 1), ...shade(color, 1), ...shade(color, 1), ...shade(color, 1)],
    indices: [0, 1, 2, 0, 2, 3],
  }
}

function shade(color: number[], factor: number): number[] {
  return color.map((c) => c * factor)
}

/** Finish colours for the model bodies. */
export const FINISH_COLORS: Record<string, number[]> = {
  WH: [0.92, 0.9, 0.86],
  BK: [0.13, 0.13, 0.15],
  BR: [0.72, 0.55, 0.3],
  BZ: [0.5, 0.38, 0.24],
  CH: [0.24, 0.24, 0.26],
  SN: [0.75, 0.75, 0.72],
}

/** Light colours for 2700K / 3000K / 4000K. */
export const LIGHT_COLORS: Record<number, number[]> = {
  2700: [1.0, 0.72, 0.35],
  3000: [1.0, 0.86, 0.66],
  4000: [0.78, 0.85, 1.0],
}
