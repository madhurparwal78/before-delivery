export const BINS = 64;
export const ROWS = 240;
export const STRIP_HEIGHT = 48;

export type CrestMode = 'live' | 'closed' | 'halted';

const GROUND: readonly [number, number, number] = [0.031, 0.035, 0.043];
const ACCENT: readonly [number, number, number] = [0.239, 0.863, 0.592];
const PALE: readonly [number, number, number] = [0.788, 0.808, 0.839];
const DIM: readonly [number, number, number] = [0.357, 0.384, 0.427];

const crestColours: Record<CrestMode, readonly [number, number, number]> = {
  live: ACCENT,
  closed: PALE,
  halted: DIM,
};

const vertexSource = `
attribute float aBin;
attribute float aSlot;
attribute float aHeight;
uniform mat4 uProjectionView;
uniform float uFront;
varying float vHeight;
varying float vDepth;
void main() {
  float depth = mod(uFront - aSlot + 240.0, 240.0);
  float x = (aBin / 63.0) * 2.0 - 1.0;
  float z = -depth * 0.075;
  float y = aHeight * 0.42 - 0.02;
  vHeight = aHeight;
  vDepth = depth / 240.0;
  gl_Position = uProjectionView * vec4(x, y, z, 1.0);
}
`;

const fragmentSource = `
precision mediump float;
uniform vec3 uGround;
uniform vec3 uCrest;
varying float vHeight;
varying float vDepth;
void main() {
  float body = smoothstep(0.08, 0.62, vHeight) * 0.3;
  float crest = smoothstep(0.62, 0.98, vHeight);
  float fade = 1.0 - vDepth * 0.85;
  vec3 colour = mix(uGround, uCrest, clamp(body + crest, 0.0, 1.0));
  gl_FragColor = vec4(mix(uGround, colour, fade), 1.0);
}
`;

const compile = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error('shader not created');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true)
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader failed to compile');
  return shader;
};

const perspective = (fovDegrees: number, aspect: number, near: number, far: number): Float32Array => {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
};

const lookAt = (
  eye: readonly [number, number, number],
  centre: readonly [number, number, number],
): Float32Array => {
  const up: readonly [number, number, number] = [0, 1, 0];
  const zx = eye[0] - centre[0];
  const zy = eye[1] - centre[1];
  const zz = eye[2] - centre[2];
  const zl = Math.hypot(zx, zy, zz);
  const z: [number, number, number] = [zx / zl, zy / zl, zz / zl];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  const xl = Math.hypot(xx, xy, xz);
  const x: [number, number, number] = [xx / xl, xy / xl, xz / xl];
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
};

const multiply = (a: Float32Array, b: Float32Array): Float32Array => {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1)
    for (let col = 0; col < 4; col += 1) {
      let total = 0;
      for (let k = 0; k < 4; k += 1) total += (a[k * 4 + col] as number) * (b[row * 4 + k] as number);
      out[row * 4 + col] = total;
    }
  return out;
};

/**
 * Confidence Strata: a 64 x 240 history terrain seen from a fixed camera, with a
 * flat 48-pixel readback strip of 64 bars along the bottom of the same canvas.
 */
export class TerrainScene {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly heights = new Float32Array(BINS * ROWS);
  private readonly heightBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly indexCount: number;
  private readonly locations: {
    bin: number;
    slot: number;
    height: number;
    projectionView: WebGLUniformLocation | null;
    front: WebGLUniformLocation | null;
    ground: WebGLUniformLocation | null;
    crest: WebGLUniformLocation | null;
  };
  private front = ROWS - 1;
  private crest: [number, number, number] = [...ACCENT];
  private mode: CrestMode = 'live';
  private width = 0;
  private height = 0;

  static create(canvas: HTMLCanvasElement): TerrainScene | null {
    const options: WebGLContextAttributes = {
      preserveDrawingBuffer: true,
      antialias: false,
      alpha: false,
      depth: true,
    };
    const gl =
      (canvas.getContext('webgl2', options) as WebGLRenderingContext | null) ??
      (canvas.getContext('webgl', options) as WebGLRenderingContext | null);
    if (gl === null) return null;
    try {
      return new TerrainScene(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const program = gl.createProgram();
    if (program === null) throw new Error('program not created');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true)
      throw new Error(gl.getProgramInfoLog(program) ?? 'program failed to link');
    this.program = program;
    gl.useProgram(program);

    const bins = new Float32Array(BINS * ROWS);
    const slots = new Float32Array(BINS * ROWS);
    for (let slot = 0; slot < ROWS; slot += 1)
      for (let bin = 0; bin < BINS; bin += 1) {
        bins[slot * BINS + bin] = bin;
        slots[slot * BINS + bin] = slot;
      }
    const indices: number[] = [];
    for (let slot = 0; slot < ROWS - 1; slot += 1)
      for (let bin = 0; bin < BINS - 1; bin += 1) {
        const a = slot * BINS + bin;
        indices.push(a, a + 1, a + BINS, a + 1, a + BINS + 1, a + BINS);
      }
    this.indexCount = indices.length;

    const staticBuffer = (data: Float32Array): WebGLBuffer => {
      const buffer = gl.createBuffer();
      if (buffer === null) throw new Error('buffer not created');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buffer;
    };
    const binBuffer = staticBuffer(bins);
    const slotBuffer = staticBuffer(slots);
    const heightBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (heightBuffer === null || indexBuffer === null) throw new Error('buffer not created');
    this.heightBuffer = heightBuffer;
    this.indexBuffer = indexBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, heightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.heights, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    this.locations = {
      bin: gl.getAttribLocation(program, 'aBin'),
      slot: gl.getAttribLocation(program, 'aSlot'),
      height: gl.getAttribLocation(program, 'aHeight'),
      projectionView: gl.getUniformLocation(program, 'uProjectionView'),
      front: gl.getUniformLocation(program, 'uFront'),
      ground: gl.getUniformLocation(program, 'uGround'),
      crest: gl.getUniformLocation(program, 'uCrest'),
    };
    const bindFloat = (buffer: WebGLBuffer, location: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 1, gl.FLOAT, false, 0, 0);
    };
    bindFloat(binBuffer, this.locations.bin);
    bindFloat(slotBuffer, this.locations.slot);
    bindFloat(heightBuffer, this.locations.height);
    gl.enable(gl.DEPTH_TEST);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  setMode(mode: CrestMode, instant: boolean): void {
    this.mode = mode;
    if (instant) this.crest = [...crestColours[mode]];
  }

  /** On a halt the field fades to grey in about a quarter of a second. */
  private advanceCrest(dt: number): void {
    const target = crestColours[this.mode];
    const step = dt / 0.25;
    for (let i = 0; i < 3; i += 1) {
      const current = this.crest[i] as number;
      const want = target[i] as number;
      const delta = want - current;
      this.crest[i] = Math.abs(delta) <= step ? want : current + Math.sign(delta) * step;
    }
  }

  pushRow(bins: readonly number[]): void {
    this.front = (this.front + 1) % ROWS;
    const offset = this.front * BINS;
    for (let i = 0; i < BINS; i += 1) this.heights[offset + i] = bins[i] ?? 0;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, offset * 4, this.heights.subarray(offset, offset + BINS));
  }

  /** A closed session shows its last 240 stored rows, without motion. */
  setRows(rows: readonly (readonly number[])[]): void {
    this.heights.fill(0);
    const take = rows.slice(-ROWS);
    const start = ROWS - take.length;
    take.forEach((row, index) => {
      const offset = (start + index) * BINS;
      for (let i = 0; i < BINS; i += 1) this.heights[offset + i] = row[i] ?? 0;
    });
    this.front = ROWS - 1;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.heights, gl.DYNAMIC_DRAW);
  }

  render(dt: number, strip: readonly number[]): void {
    const gl = this.gl;
    const { width, height } = this;
    if (width === 0 || height === 0) return;
    this.advanceCrest(dt);

    gl.useProgram(this.program);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const terrainHeight = Math.max(1, height - STRIP_HEIGHT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, STRIP_HEIGHT, width, terrainHeight);
    gl.viewport(0, STRIP_HEIGHT, width, terrainHeight);
    const projectionView = multiply(
      perspective(26, width / terrainHeight, 0.1, 60),
      lookAt([0, 0.62, 1.45], [0, -0.04, -5.2]),
    );
    gl.uniformMatrix4fv(this.locations.projectionView, false, projectionView);
    gl.uniform1f(this.locations.front, this.front);
    gl.uniform3fv(this.locations.ground, new Float32Array(GROUND));
    gl.uniform3fv(this.locations.crest, new Float32Array(this.crest));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    this.drawStrip(strip);
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Bar i owns columns floor(i*W/64) to floor((i+1)*W/64)-1 and rises from the bottom row. */
  private drawStrip(values: readonly number[]): void {
    const gl = this.gl;
    const width = this.width;
    gl.viewport(0, 0, width, STRIP_HEIGHT);
    gl.scissor(0, 0, width, STRIP_HEIGHT);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.clearColor(this.crest[0], this.crest[1], this.crest[2], 1);
    for (let i = 0; i < BINS; i += 1) {
      const from = Math.floor((i * width) / BINS);
      const to = Math.floor(((i + 1) * width) / BINS) - 1;
      if (to < from) continue;
      const lit = Math.round((values[i] ?? 0) * STRIP_HEIGHT);
      if (lit <= 0) continue;
      gl.scissor(from, 0, to - from + 1, Math.min(STRIP_HEIGHT, lit));
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }
}
