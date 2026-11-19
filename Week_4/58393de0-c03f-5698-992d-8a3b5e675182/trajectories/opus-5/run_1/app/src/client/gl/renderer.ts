import type { Vec3 } from '../geom/mesh.js';

export interface ViewerObject {
  id: string;
  mode: 'solid' | 'hole';
  color: string;
  positions: Float32Array;
}

export interface CameraState {
  azimuth: number;
  elevation: number;
  distance: number;
  target: Vec3;
}

export interface PickResult {
  id: string;
  normal: Vec3;
  distance: number;
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uProjection;
uniform mat4 uView;
varying vec3 vNormal;
void main() {
  vNormal = aNormal;
  gl_Position = uProjection * uView * vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 vNormal;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uStripes;
uniform float uHighlight;
void main() {
  vec3 light = normalize(vec3(0.4, -0.7, 0.9));
  float shade = 0.45 + 0.55 * max(dot(normalize(vNormal), light), 0.0);
  vec3 colour = uColor * shade;
  if (uStripes > 0.5) {
    float band = mod(gl_FragCoord.x + gl_FragCoord.y, 12.0);
    if (band < 6.0) colour = colour * 0.72;
  }
  colour = mix(colour, vec3(1.0, 1.0, 1.0), uHighlight * 0.25);
  gl_FragColor = vec4(colour, uAlpha);
}
`;

const perspective = (fovYRadians: number, aspect: number, near: number, far: number): Float32Array => {
  const f = 1 / Math.tan(fovYRadians / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
};

const lookAt = (eye: Vec3, centre: Vec3, up: Vec3): Float32Array => {
  const zx = eye[0] - centre[0];
  const zy = eye[1] - centre[1];
  const zz = eye[2] - centre[2];
  const zLength = Math.hypot(zx, zy, zz) || 1;
  const z: Vec3 = [zx / zLength, zy / zLength, zz / zLength];
  const xRaw: Vec3 = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xLength = Math.hypot(...xRaw) || 1;
  const x: Vec3 = [xRaw[0] / xLength, xRaw[1] / xLength, xRaw[2] / xLength];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
};

export const eyeOf = (camera: CameraState): Vec3 => {
  const azimuth = (camera.azimuth * Math.PI) / 180;
  const elevation = (camera.elevation * Math.PI) / 180;
  const cosE = Math.cos(elevation);
  return [
    camera.target[0] + camera.distance * Math.sin(azimuth) * cosE,
    camera.target[1] - camera.distance * Math.cos(azimuth) * cosE,
    camera.target[2] + camera.distance * Math.sin(elevation),
  ];
};

const hexToRgb = (hex: string): [number, number, number] => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [0.5, 0.56, 0.62];
  const value = Number.parseInt(match[1], 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
};

const normalsFor = (positions: Float32Array): Float32Array => {
  const normals = new Float32Array(positions.length);
  for (let at = 0; at < positions.length; at += 9) {
    const ax = positions[at];
    const ay = positions[at + 1];
    const az = positions[at + 2];
    const bx = positions[at + 3] - ax;
    const by = positions[at + 4] - ay;
    const bz = positions[at + 5] - az;
    const cx = positions[at + 6] - ax;
    const cy = positions[at + 7] - ay;
    const cz = positions[at + 8] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    const length = Math.hypot(nx, ny, nz) || 1;
    for (let corner = 0; corner < 3; corner += 1) {
      normals[at + corner * 3] = nx / length;
      normals[at + corner * 3 + 1] = ny / length;
      normals[at + corner * 3 + 2] = nz / length;
    }
  }
  return normals;
};

interface Buffers {
  position: WebGLBuffer;
  normal: WebGLBuffer;
  count: number;
}

/** The product's own WebGL view of a design. */
export class Viewer {
  private readonly gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private buffers = new Map<string, Buffers>();
  private objects: ViewerObject[] = [];
  private selection = new Set<string>();
  camera: CameraState = { azimuth: 45, elevation: 35, distance: 200, target: [0, 0, 10] };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = (canvas.getContext('webgl', { antialias: true, alpha: true }) ??
      canvas.getContext('experimental-webgl', { antialias: true })) as WebGLRenderingContext | null;
    if (this.gl) this.setUpProgram(this.gl);
  }

  get hasWebgl(): boolean {
    return this.gl !== null && this.program !== null;
  }

  private setUpProgram(gl: WebGLRenderingContext): void {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) return;
    const program = gl.createProgram();
    if (!program) return;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    this.program = program;
    gl.enable(gl.DEPTH_TEST);
  }

  setObjects(objects: ViewerObject[]): void {
    this.objects = objects;
    const gl = this.gl;
    if (!gl) return;
    for (const [id, buffers] of this.buffers) {
      if (!objects.some((object) => object.id === id)) {
        gl.deleteBuffer(buffers.position);
        gl.deleteBuffer(buffers.normal);
        this.buffers.delete(id);
      }
    }
    for (const object of objects) {
      const position = gl.createBuffer();
      const normal = gl.createBuffer();
      if (!position || !normal) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, position);
      gl.bufferData(gl.ARRAY_BUFFER, object.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal);
      gl.bufferData(gl.ARRAY_BUFFER, normalsFor(object.positions), gl.STATIC_DRAW);
      const existing = this.buffers.get(object.id);
      if (existing) {
        gl.deleteBuffer(existing.position);
        gl.deleteBuffer(existing.normal);
      }
      this.buffers.set(object.id, { position, normal, count: object.positions.length / 3 });
    }
  }

  setSelection(ids: string[]): void {
    this.selection = new Set(ids);
  }

  private viewMatrices(): { projection: Float32Array; view: Float32Array } {
    const width = this.canvas.width || 1;
    const height = this.canvas.height || 1;
    const aspect = width / height;
    const fov = (40 * Math.PI) / 180;
    const fovY = aspect >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
    return {
      projection: perspective(fovY, aspect, 1, 20000),
      view: lookAt(eyeOf(this.camera), this.camera.target, [0, 0, 1]),
    };
  }

  render(): void {
    const gl = this.gl;
    const program = this.program;
    if (!gl || !program) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.886, 0.945, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    const { projection, view } = this.viewMatrices();
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uProjection'), false, projection);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'uView'), false, view);
    const positionAttribute = gl.getAttribLocation(program, 'aPosition');
    const normalAttribute = gl.getAttribLocation(program, 'aNormal');
    gl.enableVertexAttribArray(positionAttribute);
    gl.enableVertexAttribArray(normalAttribute);
    const draw = (object: ViewerObject): void => {
      const buffers = this.buffers.get(object.id);
      if (!buffers) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
      gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
      gl.vertexAttribPointer(normalAttribute, 3, gl.FLOAT, false, 0, 0);
      const colour = object.mode === 'hole' ? [0.6, 0.64, 0.69] : hexToRgb(object.color);
      gl.uniform3f(gl.getUniformLocation(program, 'uColor'), colour[0], colour[1], colour[2]);
      gl.uniform1f(gl.getUniformLocation(program, 'uAlpha'), object.mode === 'hole' ? 0.55 : 1);
      gl.uniform1f(gl.getUniformLocation(program, 'uStripes'), object.mode === 'hole' ? 1 : 0);
      gl.uniform1f(gl.getUniformLocation(program, 'uHighlight'), this.selection.has(object.id) ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    };
    gl.disable(gl.BLEND);
    for (const object of this.objects.filter((candidate) => candidate.mode === 'solid')) draw(object);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const object of this.objects.filter((candidate) => candidate.mode === 'hole')) draw(object);
    gl.disable(gl.BLEND);
  }

  /** Screen point to a ray in world millimetres. */
  rayAt(clientX: number, clientY: number): { origin: Vec3; direction: Vec3 } {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
    const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
    const fov = (40 * Math.PI) / 180;
    const fovY = aspect >= 1 ? fov : 2 * Math.atan(Math.tan(fov / 2) / aspect);
    const tanY = Math.tan(fovY / 2);
    const eye = eyeOf(this.camera);
    const forward: Vec3 = [
      this.camera.target[0] - eye[0],
      this.camera.target[1] - eye[1],
      this.camera.target[2] - eye[2],
    ];
    const forwardLength = Math.hypot(...forward) || 1;
    const f: Vec3 = [forward[0] / forwardLength, forward[1] / forwardLength, forward[2] / forwardLength];
    const upWorld: Vec3 = [0, 0, 1];
    const rightRaw: Vec3 = [
      f[1] * upWorld[2] - f[2] * upWorld[1],
      f[2] * upWorld[0] - f[0] * upWorld[2],
      f[0] * upWorld[1] - f[1] * upWorld[0],
    ];
    const rightLength = Math.hypot(...rightRaw) || 1;
    const right: Vec3 = [rightRaw[0] / rightLength, rightRaw[1] / rightLength, rightRaw[2] / rightLength];
    const up: Vec3 = [
      right[1] * f[2] - right[2] * f[1],
      right[2] * f[0] - right[0] * f[2],
      right[0] * f[1] - right[1] * f[0],
    ];
    const direction: Vec3 = [
      f[0] + right[0] * ndcX * tanY * aspect + up[0] * ndcY * tanY,
      f[1] + right[1] * ndcX * tanY * aspect + up[1] * ndcY * tanY,
      f[2] + right[2] * ndcX * tanY * aspect + up[2] * ndcY * tanY,
    ];
    const length = Math.hypot(...direction) || 1;
    return { origin: eye, direction: [direction[0] / length, direction[1] / length, direction[2] / length] };
  }

  /** Nearest object under a screen point, with the hit face's normal. */
  pick(clientX: number, clientY: number): PickResult | null {
    const ray = this.rayAt(clientX, clientY);
    let best: PickResult | null = null;
    for (const object of this.objects) {
      const positions = object.positions;
      for (let at = 0; at < positions.length; at += 9) {
        const a: Vec3 = [positions[at], positions[at + 1], positions[at + 2]];
        const b: Vec3 = [positions[at + 3], positions[at + 4], positions[at + 5]];
        const c: Vec3 = [positions[at + 6], positions[at + 7], positions[at + 8]];
        const hit = rayTriangle(ray.origin, ray.direction, a, b, c);
        if (hit === null) continue;
        if (best === null || hit < best.distance) {
          const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
          const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          const normal: Vec3 = [
            e1[1] * e2[2] - e1[2] * e2[1],
            e1[2] * e2[0] - e1[0] * e2[2],
            e1[0] * e2[1] - e1[1] * e2[0],
          ];
          const length = Math.hypot(...normal) || 1;
          best = {
            id: object.id,
            normal: [normal[0] / length, normal[1] / length, normal[2] / length],
            distance: hit,
          };
        }
      }
    }
    return best;
  }

  projectToScreen(point: Vec3): { x: number; y: number } {
    const { projection, view } = this.viewMatrices();
    const multiply = (matrix: Float32Array, vector: [number, number, number, number]): [number, number, number, number] => [
      matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2] + matrix[12] * vector[3],
      matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2] + matrix[13] * vector[3],
      matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2] + matrix[14] * vector[3],
      matrix[3] * vector[0] + matrix[7] * vector[1] + matrix[11] * vector[2] + matrix[15] * vector[3],
    ];
    const viewPoint = multiply(view, [point[0], point[1], point[2], 1]);
    const clip = multiply(projection, viewPoint);
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((clip[0] / clip[3] + 1) / 2) * rect.width,
      y: rect.top + ((1 - clip[1] / clip[3]) / 2) * rect.height,
    };
  }
}

export const rayTriangle = (origin: Vec3, direction: Vec3, a: Vec3, b: Vec3, c: Vec3): number | null => {
  const e1: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p: Vec3 = [
    direction[1] * e2[2] - direction[2] * e2[1],
    direction[2] * e2[0] - direction[0] * e2[2],
    direction[0] * e2[1] - direction[1] * e2[0],
  ];
  const determinant = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(determinant) < 1e-9) return null;
  const inverse = 1 / determinant;
  const t: Vec3 = [origin[0] - a[0], origin[1] - a[1], origin[2] - a[2]];
  const u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inverse;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const q: Vec3 = [
    t[1] * e1[2] - t[2] * e1[1],
    t[2] * e1[0] - t[0] * e1[2],
    t[0] * e1[1] - t[1] * e1[0],
  ];
  const v = (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]) * inverse;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const distance = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inverse;
  return distance > 1e-6 ? distance : null;
};
