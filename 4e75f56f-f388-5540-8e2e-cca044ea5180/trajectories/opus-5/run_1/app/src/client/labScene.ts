import type { BenchState } from '../shared/api.js';
import { BENCH_LABELS, benchNumber, benchRow } from '../shared/benches.js';

export interface SceneBench {
  readonly label: string;
  readonly state: BenchState;
  readonly selected: boolean;
}

export interface SceneState {
  readonly benches: readonly SceneBench[];
  readonly lift: number;
  readonly ring: 'none' | 'depleting' | 'band';
  readonly ringRemaining: number;
}

export interface SceneCamera {
  readonly azimuth: number;
  readonly elevation: number;
}

type Vec3 = readonly [number, number, number];

const GROUND: Vec3 = [0.078, 0.059, 0.047];
const BONE: Vec3 = [0.937, 0.902, 0.855];
const UMBER_INK: Vec3 = [0.141, 0.102, 0.078];
const CURING_BLUE: Vec3 = [0.302, 0.722, 1];
const GOLD: Vec3 = [0.851, 0.663, 0.29];
const DIM_RIM: Vec3 = [0.227, 0.173, 0.133];

interface Look {
  readonly fill: Vec3;
  readonly rim: Vec3;
  readonly marker: Vec3 | null;
  readonly lampTint: Vec3;
}

function lookFor(state: BenchState, atelier: boolean): Look {
  switch (state) {
    case 'open':
      return atelier
        ? { fill: UMBER_INK, rim: GOLD, marker: GOLD, lampTint: BONE }
        : { fill: UMBER_INK, rim: BONE, marker: null, lampTint: BONE };
    case 'held':
      return { fill: [0.106, 0.078, 0.059], rim: DIM_RIM, marker: DIM_RIM, lampTint: DIM_RIM };
    case 'held_by_you':
    case 'offered_to_you':
      return { fill: [0.059, 0.165, 0.239], rim: CURING_BLUE, marker: CURING_BLUE, lampTint: CURING_BLUE };
    case 'sold':
      return { fill: UMBER_INK, rim: DIM_RIM, marker: DIM_RIM, lampTint: DIM_RIM };
    case 'yours':
      return { fill: [0.122, 0.353, 0.49], rim: CURING_BLUE, marker: CURING_BLUE, lampTint: CURING_BLUE };
  }
}

const VERTEX_SHADER = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute float aAngle;
uniform mat4 uModel;
uniform mat4 uViewProj;
varying vec3 vNormal;
varying float vAngle;
void main() {
  vNormal = mat3(uModel) * aNormal;
  vAngle = aAngle;
  gl_Position = uViewProj * uModel * vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColour;
uniform float uAlpha;
uniform float uShade;
uniform float uRingFraction;
varying vec3 vNormal;
varying float vAngle;
void main() {
  if (uRingFraction < 1.5 && vAngle > uRingFraction) discard;
  vec3 light = normalize(vec3(0.3, 1.0, 0.45));
  float lambert = max(dot(normalize(vNormal), light), 0.0);
  vec3 shaded = uColour * (1.0 - uShade + uShade * (0.45 + 0.55 * lambert));
  gl_FragColor = vec4(shaded, uAlpha);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('shader allocation failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (a[k * 4 + column] as number) * (b[row * 4 + k] as number);
      }
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

function translationScale(position: Vec3, scale: Vec3): Float32Array {
  const out = identity();
  out[0] = scale[0];
  out[5] = scale[1];
  out[10] = scale[2];
  out[12] = position[0];
  out[13] = position[1];
  out[14] = position[2];
  return out;
}

function perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovY / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye: Vec3, target: Vec3, up: Vec3): Float32Array {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z: Vec3 = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz) || 1;
  const x: Vec3 = [xx / xl, xy / xl, xz / xl];
  const y: Vec3 = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ]);
}

interface Mesh {
  readonly buffer: WebGLBuffer;
  readonly count: number;
  readonly mode: number;
}

function boxVertices(): number[] {
  const faces: { normal: Vec3; corners: Vec3[] }[] = [
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [-1, 1, 1], [1, 1, 1], [1, -1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, -1]] },
    { normal: [1, 0, 0], corners: [[1, -1, 1], [1, 1, 1], [1, 1, -1], [1, -1, -1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, 1, -1], [-1, 1, 1], [-1, -1, 1]] },
  ];
  const data: number[] = [];
  for (const face of faces) {
    const [a, b, c, d] = face.corners as [Vec3, Vec3, Vec3, Vec3];
    for (const corner of [a, b, c, a, c, d]) {
      data.push(corner[0], corner[1], corner[2], face.normal[0], face.normal[1], face.normal[2], 2);
    }
  }
  return data;
}

function boxEdgeVertices(): number[] {
  const corners: Vec3[] = [
    [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],
    [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],
  ];
  const edges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const data: number[] = [];
  for (const [from, to] of edges) {
    for (const index of [from as number, to as number]) {
      const corner = corners[index] as Vec3;
      data.push(corner[0], corner[1], corner[2], 0, 1, 0, 2);
    }
  }
  return data;
}

function coneVertices(segments: number): number[] {
  const data: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const a = (index / segments) * Math.PI * 2;
    const b = ((index + 1) / segments) * Math.PI * 2;
    data.push(0, 1, 0, 0, 1, 0, 2);
    data.push(Math.cos(a), -1, Math.sin(a), Math.cos(a), 0.4, Math.sin(a), 2);
    data.push(Math.cos(b), -1, Math.sin(b), Math.cos(b), 0.4, Math.sin(b), 2);
  }
  return data;
}

function ringVertices(segments: number, inner: number): number[] {
  const data: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const share0 = index / segments;
    const share1 = (index + 1) / segments;
    const a = share0 * Math.PI * 2 - Math.PI / 2;
    const b = share1 * Math.PI * 2 - Math.PI / 2;
    const points: [number, number, number][] = [
      [Math.cos(a) * inner, 0, Math.sin(a) * inner],
      [Math.cos(a), 0, Math.sin(a)],
      [Math.cos(b), 0, Math.sin(b)],
      [Math.cos(a) * inner, 0, Math.sin(a) * inner],
      [Math.cos(b), 0, Math.sin(b)],
      [Math.cos(b) * inner, 0, Math.sin(b) * inner],
    ];
    const shares = [share0, share0, share1, share0, share1, share1];
    points.forEach((point, order) => {
      data.push(point[0], point[1], point[2], 0, 1, 0, shares[order] as number);
    });
  }
  return data;
}

const ROW_Z: Record<string, number> = { A: -2.4, B: -0.4, C: 1.6, D: 3.6 };

function benchPosition(label: string): Vec3 {
  const column = benchNumber(label) - 1;
  return [(column - 2.5) * 2.1, 0, ROW_Z[benchRow(label)] as number];
}

export class LabScene {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly box: Mesh;
  private readonly edges: Mesh;
  private readonly cone: Mesh;
  private readonly ring: Mesh;
  private readonly uniforms: Record<string, WebGLUniformLocation | null>;
  private viewProj = identity();
  private state: SceneState = { benches: [], lift: 0, ring: 'none', ringRemaining: 0 };
  private camera: SceneCamera = { azimuth: 0, elevation: 62 };
  private frame = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
    if (gl === null) throw new Error('WebGL is unavailable');
    this.gl = gl;
    const program = gl.createProgram();
    if (program === null) throw new Error('program allocation failed');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    gl.useProgram(program);
    this.program = program;
    this.uniforms = {
      model: gl.getUniformLocation(program, 'uModel'),
      viewProj: gl.getUniformLocation(program, 'uViewProj'),
      colour: gl.getUniformLocation(program, 'uColour'),
      alpha: gl.getUniformLocation(program, 'uAlpha'),
      shade: gl.getUniformLocation(program, 'uShade'),
      ringFraction: gl.getUniformLocation(program, 'uRingFraction'),
    };
    this.box = this.mesh(boxVertices(), gl.TRIANGLES);
    this.edges = this.mesh(boxEdgeVertices(), gl.LINES);
    this.cone = this.mesh(coneVertices(24), gl.TRIANGLES);
    this.ring = this.mesh(ringVertices(72, 0.82), gl.TRIANGLES);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.loop();
  }

  private mesh(data: readonly number[], mode: number): Mesh {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (buffer === null) throw new Error('buffer allocation failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return { buffer, count: data.length / 7, mode };
  }

  setState(state: SceneState): void {
    this.state = state;
  }

  setCamera(camera: SceneCamera): void {
    this.camera = camera;
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.gl.deleteProgram(this.program);
  }

  /** The bench nearest a canvas point, for clicks and taps on the scene. */
  benchAtPoint(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { label: string; distance: number } | null = null;
    for (const label of BENCH_LABELS) {
      const position = benchPosition(label);
      const clip = this.project(position);
      if (clip === null) continue;
      const screenX = ((clip[0] + 1) / 2) * rect.width;
      const screenY = ((1 - clip[1]) / 2) * rect.height;
      const distance = Math.hypot(screenX - x, screenY - y);
      if (best === null || distance < best.distance) best = { label, distance };
    }
    if (best === null || best.distance > Math.max(rect.width, rect.height) * 0.08) return null;
    return best.label;
  }

  private project(point: Vec3): [number, number] | null {
    const m = this.viewProj;
    const w =
      (m[3] as number) * point[0] +
      (m[7] as number) * point[1] +
      (m[11] as number) * point[2] +
      (m[15] as number);
    if (w <= 0) return null;
    const x =
      (m[0] as number) * point[0] +
      (m[4] as number) * point[1] +
      (m[8] as number) * point[2] +
      (m[12] as number);
    const y =
      (m[1] as number) * point[0] +
      (m[5] as number) * point[1] +
      (m[9] as number) * point[2] +
      (m[13] as number);
    return [x / w, y / w];
  }

  private bindMesh(mesh: Mesh): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    const stride = 7 * 4;
    const position = gl.getAttribLocation(this.program, 'aPosition');
    const normal = gl.getAttribLocation(this.program, 'aNormal');
    const angle = gl.getAttribLocation(this.program, 'aAngle');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(normal);
    gl.vertexAttribPointer(normal, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(angle);
    gl.vertexAttribPointer(angle, 1, gl.FLOAT, false, stride, 24);
  }

  private draw(mesh: Mesh, model: Float32Array, colour: Vec3, alpha: number, shade: number): void {
    const gl = this.gl;
    this.bindMesh(mesh);
    gl.uniformMatrix4fv(this.uniforms['model'] as WebGLUniformLocation, false, model);
    gl.uniform3f(this.uniforms['colour'] as WebGLUniformLocation, colour[0], colour[1], colour[2]);
    gl.uniform1f(this.uniforms['alpha'] as WebGLUniformLocation, alpha);
    gl.uniform1f(this.uniforms['shade'] as WebGLUniformLocation, shade);
    gl.drawArrays(mesh.mode, 0, mesh.count);
  }

  private loop = (): void => {
    this.frame = requestAnimationFrame(this.loop);
    this.render();
  };

  private render(): void {
    const gl = this.gl;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(width * ratio);
    this.canvas.height = Math.floor(height * ratio);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const azimuth = (this.camera.azimuth * Math.PI) / 180;
    const elevation = (this.camera.elevation * Math.PI) / 180;
    const radius = 15;
    const eye: Vec3 = [
      radius * Math.cos(elevation) * Math.sin(azimuth),
      radius * Math.sin(elevation) + 0.6,
      radius * Math.cos(elevation) * Math.cos(azimuth) + 2.2,
    ];
    this.viewProj = multiply(
      perspective(Math.PI / 4.2, width / height, 0.1, 80),
      lookAt(eye, [0, 0, 0.6], [0, 1, 0]),
    );
    gl.uniformMatrix4fv(this.uniforms['viewProj'] as WebGLUniformLocation, false, this.viewProj);
    gl.uniform1f(this.uniforms['ringFraction'] as WebGLUniformLocation, 2);

    this.draw(this.box, translationScale([0, -0.4, 0.6], [9, 0.08, 7]), [0.094, 0.071, 0.055], 1, 0.4);
    this.draw(this.box, translationScale([0, 0.1, -4.6], [2.6, 0.5, 0.7]), UMBER_INK, 1, 1);
    this.draw(this.edges, translationScale([0, 0.1, -4.6], [2.6, 0.5, 0.7]), BONE, 0.7, 0);

    for (const bench of this.state.benches) {
      const base = benchPosition(bench.label);
      const atelier = benchRow(bench.label) === 'A' || benchRow(bench.label) === 'B';
      const look = lookFor(bench.state, atelier);
      const lift = bench.selected ? this.state.lift * 0.75 : 0;
      const position: Vec3 = [base[0], base[1] + lift, base[2]];
      const scale: Vec3 = [0.88, 0.24, 0.52];
      this.draw(this.box, translationScale(position, scale), look.fill, 1, 1);
      this.draw(this.edges, translationScale(position, scale), look.rim, 0.95, 0);
      if (look.marker !== null) {
        this.draw(
          this.box,
          translationScale([position[0], position[1] + 0.3, position[2]], [0.1, 0.08, 0.1]),
          look.marker,
          1,
          0.6,
        );
      }
      this.draw(
        this.cone,
        translationScale([position[0], position[1] + 0.95, position[2]], [0.38, 0.62, 0.38]),
        look.lampTint,
        0.07,
        0,
      );
      if (bench.selected && this.state.ring !== 'none') {
        const fraction = this.state.ring === 'band' ? 1 : this.state.ringRemaining;
        gl.uniform1f(this.uniforms['ringFraction'] as WebGLUniformLocation, fraction);
        this.draw(
          this.ring,
          translationScale([position[0], position[1] + 0.24, position[2]], [0.95, 1, 0.95]),
          CURING_BLUE,
          0.95,
          0,
        );
        gl.uniform1f(this.uniforms['ringFraction'] as WebGLUniformLocation, 2);
      }
    }
  }
}
