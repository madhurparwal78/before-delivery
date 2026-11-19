/** The Orderbook Orbit is drawn procedurally from the live book: no bundled images or video. */

export interface RingTarget {
  level: string;
  side: 'bid' | 'ask';
  radius: number;
  height: number;
}

export interface RingPoint {
  level: string;
  x: number;
  y: number;
}

const VERTEX_SHADER = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 viewProjection;
uniform mat4 model;
varying float shade;
void main() {
  vec4 world = model * vec4(position, 1.0);
  vec3 n = normalize(mat3(model[0].xyz, model[1].xyz, model[2].xyz) * normal);
  shade = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.35, 0.85, 0.4))), 0.0);
  gl_Position = viewProjection * world;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 colour;
uniform float brightness;
varying float shade;
void main() {
  gl_FragColor = vec4(colour * shade * brightness, 1.0);
}
`;

type Mat4 = Float32Array;

function identity(): Mat4 {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const out = new Float32Array(16);
  const f = 1 / Math.tan(fovy / 2);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye: readonly number[], centre: readonly number[], up: readonly number[]): Mat4 {
  const [ex, ey, ez] = eye as [number, number, number];
  const [cx, cy, cz] = centre as [number, number, number];
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
  const out = new Float32Array(16);
  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[12] = -(xx * ex + xy * ey + xz * ez);
  out[13] = -(yx * ex + yy * ey + yz * ez);
  out[14] = -(zx * ex + zy * ey + zz * ez);
  out[15] = 1;
  return out;
}

function multiply(left: Mat4, right: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let sum = 0;
      for (let index = 0; index < 4; index += 1) {
        sum += (left[index * 4 + column] as number) * (right[row * 4 + index] as number);
      }
      out[row * 4 + column] = sum;
    }
  }
  return out;
}

function scaleTranslate(sx: number, sy: number, sz: number, ty: number): Mat4 {
  const out = identity();
  out[0] = sx;
  out[5] = sy;
  out[10] = sz;
  out[13] = ty;
  return out;
}

function project(matrix: Mat4, point: readonly [number, number, number]): [number, number, number] {
  const [x, y, z] = point;
  const w =
    (matrix[3] as number) * x + (matrix[7] as number) * y + (matrix[11] as number) * z + (matrix[15] as number);
  const cx =
    (matrix[0] as number) * x + (matrix[4] as number) * y + (matrix[8] as number) * z + (matrix[12] as number);
  const cy =
    (matrix[1] as number) * x + (matrix[5] as number) * y + (matrix[9] as number) * z + (matrix[13] as number);
  const cz =
    (matrix[2] as number) * x + (matrix[6] as number) * y + (matrix[10] as number) * z + (matrix[14] as number);
  const safe = w === 0 ? 1e-6 : w;
  return [cx / safe, cy / safe, cz / safe];
}

interface Mesh {
  buffer: WebGLBuffer;
  count: number;
}

/** A unit torus: major radius 1, tube radius `tube`. */
function torusMesh(gl: WebGLRenderingContext, tube: number, major = 24, minor = 10): Mesh {
  const data: number[] = [];
  const point = (i: number, j: number): number[] => {
    const u = (i / major) * Math.PI * 2;
    const v = (j / minor) * Math.PI * 2;
    const nx = Math.cos(v) * Math.cos(u);
    const nz = Math.cos(v) * Math.sin(u);
    const ny = Math.sin(v);
    return [
      (1 + tube * Math.cos(v)) * Math.cos(u),
      tube * Math.sin(v),
      (1 + tube * Math.cos(v)) * Math.sin(u),
      nx,
      ny,
      nz,
    ];
  };
  for (let i = 0; i < major; i += 1) {
    for (let j = 0; j < minor; j += 1) {
      const a = point(i, j);
      const b = point(i + 1, j);
      const c = point(i + 1, j + 1);
      const d = point(i, j + 1);
      data.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  const buffer = gl.createBuffer() as WebGLBuffer;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buffer, count: data.length / 6 };
}

/** The central vertical spindle. */
function cylinderMesh(gl: WebGLRenderingContext, segments = 18): Mesh {
  const data: number[] = [];
  for (let i = 0; i < segments; i += 1) {
    const u0 = (i / segments) * Math.PI * 2;
    const u1 = ((i + 1) / segments) * Math.PI * 2;
    const ring = (u: number, y: number): number[] => [
      Math.cos(u),
      y,
      Math.sin(u),
      Math.cos(u),
      0,
      Math.sin(u),
    ];
    const a = ring(u0, -1);
    const b = ring(u1, -1);
    const c = ring(u1, 1);
    const d = ring(u0, 1);
    data.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  const buffer = gl.createBuffer() as WebGLBuffer;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  return { buffer, count: data.length / 6 };
}

const BID_COLOUR: readonly [number, number, number] = [0.42, 0.56, 0.42];
const ASK_COLOUR: readonly [number, number, number] = [0.74, 0.52, 0.44];
const SPINDLE_COLOUR: readonly [number, number, number] = [0.22, 0.27, 0.32];
const SETTLE_TAU_MS = 110;
const SETTLE_EPSILON = 0.5;
const RING_SAMPLES = 24;

interface RingState extends RingTarget {
  currentRadius: number;
  currentHeight: number;
}

export interface SceneOptions {
  fixedElevation: number | null;
  onPoints: (points: RingPoint[]) => void;
  onSettled: (settled: boolean) => void;
}

export class OrbitScene {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly torus: Mesh;
  private readonly spindle: Mesh;
  private readonly positionLocation: number;
  private readonly normalLocation: number;
  private readonly viewProjectionLocation: WebGLUniformLocation;
  private readonly modelLocation: WebGLUniformLocation;
  private readonly colourLocation: WebGLUniformLocation;
  private readonly brightnessLocation: WebGLUniformLocation;

  private rings: RingState[] = [];
  private elevation: number;
  private yaw = 0;
  private settled = true;
  private highlight = '';
  private frame = 0;
  private lastTime = 0;
  private running = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: SceneOptions,
  ) {
    const gl = (canvas.getContext('webgl', { antialias: true, alpha: false }) ??
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl === null) throw new Error('webgl unavailable');
    this.gl = gl;
    this.elevation = options.fixedElevation ?? 90;

    const compile = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error('shader link failed');
    this.program = program;
    gl.useProgram(program);

    this.positionLocation = gl.getAttribLocation(program, 'position');
    this.normalLocation = gl.getAttribLocation(program, 'normal');
    this.viewProjectionLocation = gl.getUniformLocation(program, 'viewProjection') as WebGLUniformLocation;
    this.modelLocation = gl.getUniformLocation(program, 'model') as WebGLUniformLocation;
    this.colourLocation = gl.getUniformLocation(program, 'colour') as WebGLUniformLocation;
    this.brightnessLocation = gl.getUniformLocation(program, 'brightness') as WebGLUniformLocation;

    this.torus = torusMesh(gl, 0.09);
    this.spindle = cylinderMesh(gl);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.863, 0.894, 0.929, 1);
    this.frame = requestAnimationFrame(this.tick);
  }

  setRings(targets: readonly RingTarget[]): void {
    const previous = new Map(this.rings.map((ring) => [ring.level, ring]));
    this.rings = targets.map((target) => {
      const existing = previous.get(target.level);
      return {
        ...target,
        currentRadius: existing?.currentRadius ?? target.radius * 0.6,
        currentHeight: existing?.currentHeight ?? target.height,
      };
    });
    this.markMoving();
  }

  setElevation(elevation: number): void {
    this.elevation = elevation;
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
  }

  setHighlight(level: string): void {
    this.highlight = level;
  }

  private markMoving(): void {
    if (this.settled) {
      this.settled = false;
      this.options.onSettled(false);
    }
  }

  private pixelSize(): { width: number; height: number; ratio: number } {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    return { width, height, ratio };
  }

  private viewProjection(width: number, height: number): Mat4 {
    const elevation = (this.elevation * Math.PI) / 180;
    const yaw = (this.yaw * Math.PI) / 180;
    const distance = 4.6;
    const eye = [
      distance * Math.cos(elevation) * Math.sin(yaw),
      distance * Math.sin(elevation) + 0.0001,
      distance * Math.cos(elevation) * Math.cos(yaw),
    ];
    const up = this.elevation > 86 ? [0, 0, -1] : [0, 1, 0];
    return multiply(perspective(Math.PI / 4, width / height, 0.1, 50), lookAt(eye, [0, 0, 0], up));
  }

  /** The point in CSS pixels at which a click or tap selects each ring. */
  private publishPoints(viewProjection: Mat4, width: number, height: number): void {
    const points: RingPoint[] = this.rings.map((ring) => {
      let best: [number, number] = [width / 2, height / 2];
      let bestScreenY = -Infinity;
      for (let index = 0; index < RING_SAMPLES; index += 1) {
        const angle = (index / RING_SAMPLES) * Math.PI * 2;
        const world: [number, number, number] = [
          Math.cos(angle) * ring.currentRadius,
          ring.currentHeight,
          Math.sin(angle) * ring.currentRadius,
        ];
        const [ndcX, ndcY] = project(viewProjection, world);
        const screenX = ((ndcX + 1) / 2) * width;
        const screenY = ((1 - ndcY) / 2) * height;
        if (screenY > bestScreenY) {
          bestScreenY = screenY;
          best = [screenX, screenY];
        }
      }
      return {
        level: ring.level,
        x: Math.round((best[0] as number) * 10) / 10,
        y: Math.round((best[1] as number) * 10) / 10,
      };
    });
    this.options.onPoints(points);
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    const delta = this.lastTime === 0 ? 16 : Math.min(time - this.lastTime, 64);
    this.lastTime = time;

    const step = 1 - Math.exp(-delta / SETTLE_TAU_MS);
    let moving = false;
    for (const ring of this.rings) {
      ring.currentRadius += (ring.radius - ring.currentRadius) * step;
      ring.currentHeight += (ring.height - ring.currentHeight) * step;
      if (
        Math.abs(ring.radius - ring.currentRadius) > SETTLE_EPSILON / 100 ||
        Math.abs(ring.height - ring.currentHeight) > SETTLE_EPSILON / 100
      ) {
        moving = true;
      } else {
        ring.currentRadius = ring.radius;
        ring.currentHeight = ring.height;
      }
    }
    if (!moving && !this.settled) {
      this.settled = true;
      this.options.onSettled(true);
    }

    const { width, height, ratio } = this.pixelSize();
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    const gl = this.gl;
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);

    const viewProjection = this.viewProjection(width, height);
    gl.uniformMatrix4fv(this.viewProjectionLocation, false, viewProjection);

    const bind = (mesh: Mesh): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
      gl.enableVertexAttribArray(this.positionLocation);
      gl.vertexAttribPointer(this.positionLocation, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.normalLocation);
      gl.vertexAttribPointer(this.normalLocation, 3, gl.FLOAT, false, 24, 12);
    };

    bind(this.spindle);
    gl.uniform3fv(this.colourLocation, new Float32Array(SPINDLE_COLOUR));
    gl.uniform1f(this.brightnessLocation, 1);
    gl.uniformMatrix4fv(this.modelLocation, false, scaleTranslate(0.045, 1.5, 0.045, 0));
    gl.drawArrays(gl.TRIANGLES, 0, this.spindle.count);

    bind(this.torus);
    for (const ring of this.rings) {
      const colour = ring.side === 'bid' ? BID_COLOUR : ASK_COLOUR;
      gl.uniform3fv(this.colourLocation, new Float32Array(colour));
      gl.uniform1f(this.brightnessLocation, this.highlight === ring.level ? 1.35 : 1);
      gl.uniformMatrix4fv(
        this.modelLocation,
        false,
        scaleTranslate(ring.currentRadius, 1, ring.currentRadius, ring.currentHeight),
      );
      gl.drawArrays(gl.TRIANGLES, 0, this.torus.count);
    }

    this.publishPoints(viewProjection, width, height);
    this.frame = requestAnimationFrame(this.tick);
  };

  destroy(): void {
    this.running = false;
    cancelAnimationFrame(this.frame);
  }
}
