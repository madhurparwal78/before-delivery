import { MeshData } from './mesh';
import { Pose } from './api';

export type Matrix = Float32Array;

function identity(): Matrix {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let index = 0; index < 4; index += 1) sum += a[index * 4 + row] * b[column * 4 + index];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

function perspective(fovDegrees: number, aspect: number, near: number, far: number): Matrix {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function orthographic(height: number, aspect: number, near: number, far: number): Matrix {
  const out = identity();
  out[0] = 2 / (height * aspect);
  out[5] = 2 / height;
  out[10] = -2 / (far - near);
  out[14] = -(far + near) / (far - near);
  return out;
}

function lookAt(eye: number[], target: number[], up: number[]): Matrix {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / xl, xy / xl, xz / xl];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 viewProjection;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normal;
  vWorld = position;
  gl_Position = viewProjection * vec4(position, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 colour;
uniform float alpha;
uniform float hatch;
uniform float greyed;
void main() {
  vec3 light = normalize(vec3(-0.45, 0.8, 0.55));
  float lambert = max(dot(normalize(vNormal), light), 0.0);
  vec3 rim = vec3(0.08, 0.42, 0.52) * pow(1.0 - lambert, 2.0);
  vec3 base = mix(colour, vec3(0.42, 0.47, 0.54), greyed);
  vec3 shade = base * (0.34 + 0.66 * lambert) + rim;
  float cover = 1.0;
  if (hatch > 0.5) {
    float stripe = sin((gl_FragCoord.x + gl_FragCoord.y) * 0.5);
    cover = stripe > 0.15 ? 1.0 : 0.0;
    if (cover < 0.5) discard;
  }
  gl_FragColor = vec4(shade, alpha);
}`;

const GLOW_VERTEX = `
attribute vec2 corner;
varying vec2 vCorner;
void main() {
  vCorner = corner;
  gl_Position = vec4(corner, 0.999, 1.0);
}`;

const GLOW_FRAGMENT = `
precision mediump float;
varying vec2 vCorner;
uniform float aspect;
void main() {
  vec2 point = vec2(vCorner.x * aspect, vCorner.y);
  float distance = length(point - vec2(0.0, 0.05));
  float glow = exp(-distance * distance * 2.2);
  vec3 ground = vec3(0.016, 0.027, 0.047);
  vec3 lamp = vec3(0.027, 0.447, 0.561);
  gl_FragColor = vec4(ground + lamp * glow * 0.85, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function link(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  return program;
}

export type Layer = {
  mesh: MeshData;
  colour: [number, number, number];
  alpha: number;
  hatch?: boolean;
  greyed?: boolean;
};

export const MATERIAL: [number, number, number] = [0.62, 0.69, 0.78];
export const ACCENT: [number, number, number] = [0.22, 0.85, 1];
export const GHOST: [number, number, number] = [0.42, 0.47, 0.54];

type Buffers = { position: WebGLBuffer; normal: WebGLBuffer; count: number };

/** A real WebGL scene: the evaluated solid in front of one cyan light. */
export class Scene {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly glowProgram: WebGLProgram;
  private readonly glowBuffer: WebGLBuffer;
  private readonly cache = new WeakMap<MeshData, Buffers>();
  private layers: Layer[] = [];
  private pose: Pose = {
    position: [60, -60, 60],
    target: [0, 0, 0],
    up: [0, 0, 1],
    fov: 35,
  };
  private projection: 'perspective' | 'orthographic' = 'perspective';

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = (canvas.getContext('webgl', { antialias: true, alpha: false }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) throw new Error('no webgl');
    this.gl = gl;
    this.program = link(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.glowProgram = link(gl, GLOW_VERTEX, GLOW_FRAGMENT);
    this.glowBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  setLayers(layers: Layer[]): void {
    this.layers = layers;
  }

  setPose(pose: Pose): void {
    this.pose = pose;
  }

  getPose(): Pose {
    return this.pose;
  }

  setProjection(projection: 'perspective' | 'orthographic'): void {
    this.projection = projection;
  }

  getProjection(): 'perspective' | 'orthographic' {
    return this.projection;
  }

  private buffersFor(mesh: MeshData): Buffers {
    const existing = this.cache.get(mesh);
    if (existing) return existing;
    const gl = this.gl;
    const position = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    const normal = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    const buffers = { position, normal, count: mesh.positions.length / 3 };
    this.cache.set(mesh, buffers);
    return buffers;
  }

  /** A world point in CSS pixels inside the canvas, for comment and finding pins. */
  project(point: [number, number, number]): { x: number; y: number } | null {
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const aspect = width / height;
    const distance = Math.hypot(
      this.pose.position[0] - this.pose.target[0],
      this.pose.position[1] - this.pose.target[1],
      this.pose.position[2] - this.pose.target[2],
    );
    const projection =
      this.projection === 'perspective'
        ? perspective(this.pose.fov, aspect, Math.max(0.1, distance / 100), distance * 10 + 1000)
        : orthographic(
            2 * distance * Math.tan((this.pose.fov * Math.PI) / 360),
            aspect,
            -distance * 10 - 1000,
            distance * 10 + 1000,
          );
    const matrix = multiply(projection, lookAt(this.pose.position, this.pose.target, this.pose.up));
    const clip = [0, 1, 2, 3].map(
      (row) =>
        matrix[row] * point[0] + matrix[4 + row] * point[1] + matrix[8 + row] * point[2] + matrix[12 + row],
    );
    if (clip[3] <= 0) return null;
    return {
      x: ((clip[0] / clip[3]) * 0.5 + 0.5) * width,
      y: (0.5 - (clip[1] / clip[3]) * 0.5) * height,
    };
  }

  render(): void {
    const gl = this.gl;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    const aspect = width / height;

    gl.depthMask(false);
    gl.useProgram(this.glowProgram);
    const corner = gl.getAttribLocation(this.glowProgram, 'corner');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer);
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(this.glowProgram, 'aspect'), aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const distance = Math.hypot(
      this.pose.position[0] - this.pose.target[0],
      this.pose.position[1] - this.pose.target[1],
      this.pose.position[2] - this.pose.target[2],
    );
    const projection =
      this.projection === 'perspective'
        ? perspective(this.pose.fov, aspect, Math.max(0.1, distance / 100), distance * 10 + 1000)
        : orthographic(
            2 * distance * Math.tan((this.pose.fov * Math.PI) / 360),
            aspect,
            -distance * 10 - 1000,
            distance * 10 + 1000,
          );
    const view = lookAt(this.pose.position, this.pose.target, this.pose.up);
    const viewProjection = multiply(projection, view);

    gl.useProgram(this.program);
    const positionLocation = gl.getAttribLocation(this.program, 'position');
    const normalLocation = gl.getAttribLocation(this.program, 'normal');
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, 'viewProjection'), false, viewProjection);

    for (const layer of this.layers) {
      if (layer.mesh.positions.length === 0) continue;
      const buffers = this.buffersFor(layer.mesh);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.enableVertexAttribArray(normalLocation);
      gl.vertexAttribPointer(normalLocation, 3, gl.FLOAT, false, 0, 0);
      gl.uniform3fv(gl.getUniformLocation(this.program, 'colour'), layer.colour);
      gl.uniform1f(gl.getUniformLocation(this.program, 'alpha'), layer.alpha);
      gl.uniform1f(gl.getUniformLocation(this.program, 'hatch'), layer.hatch ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(this.program, 'greyed'), layer.greyed ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    }
  }
}
