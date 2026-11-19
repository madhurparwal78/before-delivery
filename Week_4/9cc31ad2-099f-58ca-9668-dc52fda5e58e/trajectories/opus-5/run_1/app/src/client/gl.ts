export type Mat4 = Float32Array;

export function identity(): Mat4 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + column]! * b[row * 4 + k]!;
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

export function perspective(fovyRadians: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRadians / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function lookAt(eye: number[], center: number[], up: number[]): Mat4 {
  const [ex, ey, ez] = eye as [number, number, number];
  const [cx, cy, cz] = center as [number, number, number];
  let zx = ex - cx;
  let zy = ey - cy;
  let zz = ez - cz;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  const [ux, uy, uz] = up as [number, number, number];
  let xx = uy * zz - uz * zy;
  let xy = uz * zx - ux * zz;
  let xz = ux * zy - uy * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * ex + xy * ey + xz * ez),
    -(yx * ex + yy * ey + yz * ez),
    -(zx * ex + zy * ey + zz * ez),
    1,
  ]);
}

export function translation(x: number, y: number, z: number): Mat4 {
  const out = identity();
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scaling(x: number, y: number, z: number): Mat4 {
  const out = identity();
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotationY(radians: number): Mat4 {
  const out = identity();
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  out[0] = c;
  out[2] = -s;
  out[8] = s;
  out[10] = c;
  return out;
}

const VERTEX_SHADER = `#version 300 es
in vec3 position;
in vec3 normal;
uniform mat4 model;
uniform mat4 view;
uniform mat4 projection;
out vec3 vNormal;
void main() {
  vNormal = mat3(model) * normal;
  gl_Position = projection * view * model * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec3 vNormal;
uniform vec4 colour;
out vec4 fragColour;
void main() {
  vec3 light = normalize(vec3(0.4, 0.9, 0.3));
  float shade = 0.55 + 0.45 * max(dot(normalize(vNormal), light), 0.0);
  fragColour = vec4(colour.rgb * shade, colour.a);
}`;

export interface SolidProgram {
  program: WebGLProgram;
  model: WebGLUniformLocation;
  view: WebGLUniformLocation;
  projection: WebGLUniformLocation;
  colour: WebGLUniformLocation;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

export function createSolidProgram(gl: WebGL2RenderingContext): SolidProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  return {
    program,
    model: gl.getUniformLocation(program, 'model')!,
    view: gl.getUniformLocation(program, 'view')!,
    projection: gl.getUniformLocation(program, 'projection')!,
    colour: gl.getUniformLocation(program, 'colour')!,
  };
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
  mode: number;
}

export function createMesh(
  gl: WebGL2RenderingContext,
  program: SolidProgram,
  vertices: number[],
  mode: number,
): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program.program, 'position');
  const normal = gl.getAttribLocation(program.program, 'normal');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 24, 0);
  if (normal >= 0) {
    gl.enableVertexAttribArray(normal);
    gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, 24, 12);
  }
  gl.bindVertexArray(null);
  return { vao, count: vertices.length / 6, mode };
}

/** A unit cube centred on the origin, with normals. */
export function cubeVertices(): number[] {
  const faces: { normal: number[]; corners: number[][] }[] = [
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const vertices: number[] = [];
  for (const face of faces) {
    const [a, b, c, d] = face.corners as [number[], number[], number[], number[]];
    for (const corner of [a, b, c, a, c, d]) {
      vertices.push(corner[0]! / 2, corner[1]! / 2, corner[2]! / 2, ...face.normal);
    }
  }
  return vertices;
}

export const PALETTE = {
  paper: [0.96, 0.94, 0.88, 1],
  ink: [0.09, 0.08, 0.06, 1],
  accent: [0.82, 0.31, 0.04, 1],
  ghost: [0.09, 0.08, 0.06, 0.4],
} as const;

export interface CarPart {
  model: Mat4;
  colour: readonly number[];
}

/** A car built in code from solid shapes: body, cabin and four wheels. */
export function carParts(bodyColour: readonly number[]): CarPart[] {
  const wheel = (x: number, z: number): CarPart => ({
    model: multiply(translation(x, 0.33, z), scaling(0.35, 0.66, 0.66)),
    colour: PALETTE.ink,
  });
  return [
    { model: multiply(translation(0, 0.6, 0), scaling(1.9, 0.6, 4.2)), colour: bodyColour },
    { model: multiply(translation(0, 1.05, -0.2), scaling(1.5, 0.55, 1.9)), colour: PALETTE.paper },
    wheel(-0.95, 1.4),
    wheel(0.95, 1.4),
    wheel(-0.95, -1.4),
    wheel(0.95, -1.4),
  ];
}
