import type { Locale } from '../../shared/types.js';
import { hexToRgb, PALETTE, tintColour } from '../palette.js';
import {
  barEdgeX,
  buildBarMesh,
  buildBoxMesh,
  cameraFor,
  identity,
  LOAF,
  multiply,
  project,
  rotationX,
  rotationY,
  scaling,
  translation,
  viewProjection,
  type Camera,
  type Mesh,
} from './geometry.js';
import { labelTexture, type LabelKind } from './labels.js';

export type BarMark = 'A' | 'H' | 'S';

export type SceneInput = {
  batch: string;
  tint: string;
  bars: BarMark[];
  cutStep: number;
  wire: number;
  yaw: number;
  reduced: boolean;
  locale: Locale;
};

export type SceneReading = {
  band: [number, number];
  spans: [number, number][];
  animating: boolean;
};

const VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_face;
attribute vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_viewProjection;
varying vec3 v_normal;
varying float v_face;
varying vec2 v_uv;
varying vec3 v_local;
void main() {
  vec4 world = u_model * vec4(a_position, 1.0);
  gl_Position = u_viewProjection * world;
  v_normal = mat3(u_model) * a_normal;
  v_face = a_face;
  v_uv = a_uv;
  v_local = a_position;
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec3 v_normal;
varying float v_face;
varying vec2 v_uv;
varying vec3 v_local;
uniform vec3 u_tint;
uniform vec3 u_kraft;
uniform float u_seed;
uniform float u_wrapped;
uniform float u_mode;
uniform sampler2D u_label;
uniform vec2 u_labelOrigin;
uniform vec2 u_labelSize;
uniform float u_hasLabel;
uniform float u_labelRow;
uniform float u_seam;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453);
}

float valueNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 frac = fract(p);
  vec2 smoothed = frac * frac * (3.0 - 2.0 * frac);
  float a = hash(cell);
  float b = hash(cell + vec2(1.0, 0.0));
  float c = hash(cell + vec2(0.0, 1.0));
  float d = hash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, smoothed.x), mix(c, d, smoothed.x), smoothed.y);
}

float marble(vec2 p) {
  float base = valueNoise(p * 3.0) * 0.6 + valueNoise(p * 7.0) * 0.3 + valueNoise(p * 15.0) * 0.1;
  return clamp(0.5 + 0.5 * sin((p.y * 7.0 + base * 5.0) * 1.7), 0.0, 1.0);
}

void main() {
  if (u_mode > 0.5) {
    gl_FragColor = vec4(u_tint, 1.0);
    return;
  }
  vec3 base = u_tint;
  if (v_face > 0.5 && v_face < 1.5) {
    float swirl = marble(v_uv + vec2(u_seed * 0.013, 0.0));
    vec3 pale = mix(u_tint, vec3(0.95, 0.92, 0.85), 0.62);
    vec3 deep = u_tint * 0.66;
    base = swirl < 0.42 ? deep : (swirl < 0.72 ? u_tint : pale);
  } else if (v_face > 1.5 && v_face < 2.5) {
    base = u_tint * 1.06;
  }
  if (u_wrapped > 0.5) {
    base = u_kraft;
    float fold = v_uv.x + v_uv.y;
    if (v_face < 0.5 && fold > 1.72) base = u_kraft * 0.74;
    if (v_face < 0.5 && abs(v_uv.y - 0.45) < 0.035) base = u_kraft * 0.84;
  }
  // A cut bar shows the shadow of its own cut line, so the loaf reads as slices, not one slab.
  if (u_seam > 0.5 && v_face < 0.5 && min(v_uv.x, 1.0 - v_uv.x) < 0.045) {
    base *= 0.62;
  }
  vec3 normal = normalize(v_normal);
  float lambert = max(0.0, dot(normal, normalize(vec3(-0.35, 0.82, 0.45))));
  vec3 lit = base * (0.58 + 0.42 * lambert);
  if (u_hasLabel > 0.5 && v_face < 0.5) {
    vec2 within = (v_uv - u_labelOrigin) / u_labelSize;
    if (within.x >= 0.0 && within.x <= 1.0 && within.y >= 0.0 && within.y <= 1.0) {
      // The word runs up the narrow bar face, so the atlas is read across the slot.
      vec4 ink = texture2D(u_label, vec2(within.y, u_labelRow * 0.5 + (1.0 - within.x) * 0.5));
      lit = mix(lit, ink.rgb, ink.a);
    }
  }
  gl_FragColor = vec4(lit, 1.0);
}
`;

type Buffers = { position: WebGLBuffer; normal: WebGLBuffer; face: WebGLBuffer; uv: WebGLBuffer; count: number };

type Attributes = { position: number; normal: number; face: number; uv: number };

type Uniforms = {
  model: WebGLUniformLocation;
  viewProjection: WebGLUniformLocation;
  tint: WebGLUniformLocation;
  kraft: WebGLUniformLocation;
  seed: WebGLUniformLocation;
  wrapped: WebGLUniformLocation;
  mode: WebGLUniformLocation;
  label: WebGLUniformLocation;
  labelOrigin: WebGLUniformLocation;
  labelSize: WebGLUniformLocation;
  hasLabel: WebGLUniformLocation;
  labelRow: WebGLUniformLocation;
  seam: WebGLUniformLocation;
};

const TIP_MS = 600;
const WIRE_MS = 320;

function seedOf(code: string): number {
  let seed = 0;
  for (const character of code) seed = (seed * 31 + character.charCodeAt(0)) % 100_000;
  return seed;
}

function easeOut(progress: number): number {
  return 1 - (1 - progress) * (1 - progress) * (1 - progress);
}

export class LoafScene {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private attributes: Attributes | null = null;
  private uniforms: Uniforms | null = null;
  private barBuffers = new Map<string, Buffers>();
  private box: Buffers | null = null;
  private texture: WebGLTexture | null = null;
  private textureLocale: Locale | null = null;
  private input: SceneInput = {
    batch: '',
    tint: 'lilac',
    bars: [],
    cutStep: 0,
    wire: 0,
    yaw: 0,
    reduced: false,
    locale: 'en-CA',
  };
  private tips: number[] = [];
  private wraps: number[] = [];
  private wireShown = 0;
  private wireTarget = 0;
  private lastFrame = 0;
  private frameHandle: number | null = null;
  private lost = false;
  private available = true;
  private readonly onReading: (reading: SceneReading) => void;

  constructor(onReading: (reading: SceneReading) => void) {
    this.onReading = onReading;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.className = 'loaf-canvas';
    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.lost = true;
      this.publish();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.setUp();
      this.publish();
      this.draw();
    });
  }

  get state(): 'ready' | 'lost' | 'fallback' {
    if (!this.available) return 'fallback';
    return this.lost ? 'lost' : 'ready';
  }

  start(): void {
    this.setUp();
    this.publish();
    this.draw();
  }

  private setUp(): void {
    const options: WebGLContextAttributes = { antialias: true, alpha: false, depth: true };
    const context =
      this.canvas.getContext('webgl', options) ?? this.canvas.getContext('experimental-webgl', options);
    if (!(context instanceof WebGLRenderingContext)) {
      this.available = false;
      return;
    }
    this.available = true;
    this.gl = context;
    this.barBuffers.clear();
    const program = this.compile(context);
    if (!program) {
      this.available = false;
      return;
    }
    this.program = program;
    this.attributes = {
      position: context.getAttribLocation(program, 'a_position'),
      normal: context.getAttribLocation(program, 'a_normal'),
      face: context.getAttribLocation(program, 'a_face'),
      uv: context.getAttribLocation(program, 'a_uv'),
    };
    const uniform = (name: string): WebGLUniformLocation =>
      context.getUniformLocation(program, name) as WebGLUniformLocation;
    this.uniforms = {
      model: uniform('u_model'),
      viewProjection: uniform('u_viewProjection'),
      tint: uniform('u_tint'),
      kraft: uniform('u_kraft'),
      seed: uniform('u_seed'),
      wrapped: uniform('u_wrapped'),
      mode: uniform('u_mode'),
      label: uniform('u_label'),
      labelOrigin: uniform('u_labelOrigin'),
      labelSize: uniform('u_labelSize'),
      hasLabel: uniform('u_hasLabel'),
      labelRow: uniform('u_labelRow'),
      seam: uniform('u_seam'),
    };
    this.box = this.upload(context, buildBoxMesh());
    this.texture = context.createTexture();
    this.textureLocale = null;
    context.enable(context.DEPTH_TEST);
    context.depthFunc(context.LESS);
  }

  private compile(gl: WebGLRenderingContext): WebGLProgram | null {
    const vertex = gl.createShader(gl.VERTEX_SHADER);
    const fragment = gl.createShader(gl.FRAGMENT_SHADER);
    if (!vertex || !fragment) return null;
    gl.shaderSource(vertex, VERTEX_SHADER);
    gl.compileShader(vertex);
    gl.shaderSource(fragment, FRAGMENT_SHADER);
    gl.compileShader(fragment);
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return program;
  }

  private upload(gl: WebGLRenderingContext, mesh: Mesh): Buffers {
    const make = (data: Float32Array): WebGLBuffer => {
      const buffer = gl.createBuffer() as WebGLBuffer;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      return buffer;
    };
    return {
      position: make(mesh.positions),
      normal: make(mesh.normals),
      face: make(mesh.faces),
      uv: make(mesh.uvs),
      count: mesh.count,
    };
  }

  private barMesh(index: number, total: number): Buffers | null {
    const gl = this.gl;
    if (!gl) return null;
    const key = `${total}:${index}`;
    const cached = this.barBuffers.get(key);
    if (cached) return cached;
    const slot = LOAF.length / total;
    const centre = barEdgeX(total, index) + slot / 2;
    const buffers = this.upload(gl, buildBarMesh(centre, slot));
    this.barBuffers.set(key, buffers);
    return buffers;
  }

  setInput(next: SceneInput): void {
    const batchChanged = next.batch !== this.input.batch || next.bars.length !== this.input.bars.length;
    this.input = next;
    if (this.tips.length !== next.bars.length) {
      this.tips = next.bars.map(() => 0);
      this.wraps = next.bars.map((mark) => (mark === 'H' ? 1 : 0));
    }
    this.wireTarget = next.wire;
    if (batchChanged || next.reduced) this.wireShown = next.wire;
    if (next.reduced) {
      this.tips = next.bars.map((_, index) => (this.tipTarget(index) ? 1 : 0));
      this.wraps = next.bars.map((mark) => (mark === 'H' ? 1 : 0));
    }
    this.draw();
  }

  private tipTarget(index: number): boolean {
    const bar = index + 1;
    const total = this.input.bars.length;
    return this.input.cutStep < total && bar <= this.input.cutStep;
  }

  resize(): void {
    this.draw();
  }

  private publish(): void {
    const camera = this.camera();
    this.onReading({ band: this.band(camera), spans: this.spans(camera), animating: this.animating() });
  }

  private camera(): Camera {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    return cameraFor(width, height, this.input.reduced ? 0 : this.input.yaw);
  }

  private band(camera: Camera): [number, number] {
    const height = this.canvas.clientHeight || 1;
    const top = LOAF.height + LOAF.dome;
    const corners = [
      project(camera, -LOAF.length / 2, top, -LOAF.depth / 2).y,
      project(camera, LOAF.length / 2, top, -LOAF.depth / 2).y,
      project(camera, -LOAF.length / 2, 0, LOAF.depth / 2).y,
      project(camera, LOAF.length / 2, 0, LOAF.depth / 2).y,
    ];
    const clamp = (value: number): number => Math.min(height, Math.max(0, value));
    return [Math.round(clamp(Math.min(...corners))), Math.round(clamp(Math.max(...corners)))];
  }

  private spans(camera: Camera): [number, number][] {
    const width = this.canvas.clientWidth || 1;
    const total = this.input.bars.length;
    const clamp = (value: number): number => Math.min(width, Math.max(0, value));
    const out: [number, number][] = [];
    for (let index = 0; index < total; index += 1) {
      const left = project(camera, barEdgeX(total, index), 0, LOAF.depth / 2).x;
      const right = project(camera, barEdgeX(total, index + 1), 0, LOAF.depth / 2).x;
      out.push([Math.round(clamp(left)), Math.round(clamp(right))]);
    }
    return out;
  }

  isAnimating(): boolean {
    return this.animating();
  }

  private animating(): boolean {
    if (this.input.reduced) return false;
    if (Math.abs(this.wireShown - this.wireTarget) > 0.0005) return true;
    return this.input.bars.some((mark, index) => {
      const tip = this.tips[index] ?? 0;
      const wrap = this.wraps[index] ?? 0;
      const tipGoal = this.tipTarget(index) ? 1 : 0;
      const wrapGoal = mark === 'H' ? 1 : 0;
      return Math.abs(tip - tipGoal) > 0.001 || Math.abs(wrap - wrapGoal) > 0.001;
    });
  }

  private step(elapsed: number): void {
    const tipStep = elapsed / TIP_MS;
    const wireStep = elapsed / WIRE_MS;
    this.input.bars.forEach((mark, index) => {
      const tipGoal = this.tipTarget(index) ? 1 : 0;
      const current = this.tips[index] ?? 0;
      this.tips[index] = tipGoal > current ? Math.min(tipGoal, current + tipStep) : Math.max(tipGoal, current - tipStep);
      const wrapGoal = mark === 'H' ? 1 : 0;
      const wrap = this.wraps[index] ?? 0;
      this.wraps[index] = wrapGoal > wrap ? Math.min(wrapGoal, wrap + tipStep) : Math.max(wrapGoal, wrap - tipStep);
    });
    const difference = this.wireTarget - this.wireShown;
    const maximum = wireStep * Math.max(1, this.input.bars.length);
    this.wireShown += Math.abs(difference) <= maximum ? difference : Math.sign(difference) * maximum;
  }

  draw(): void {
    if (this.frameHandle !== null) return;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    this.frameHandle = null;
    const elapsed = Math.min(64, time - this.lastFrame);
    this.lastFrame = time;
    if (this.input.reduced) {
      this.tips = this.input.bars.map((_, index) => (this.tipTarget(index) ? 1 : 0));
      this.wraps = this.input.bars.map((mark) => (mark === 'H' ? 1 : 0));
      this.wireShown = this.wireTarget;
    } else {
      this.step(elapsed);
    }
    this.render();
    this.publish();
    if (this.animating()) {
      this.frameHandle = requestAnimationFrame((next) => this.frame(next));
    }
  }

  private ensureTexture(gl: WebGLRenderingContext): void {
    if (!this.texture || this.textureLocale === this.input.locale) return;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, labelTexture(this.input.locale));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textureLocale = this.input.locale;
  }

  private bindMesh(gl: WebGLRenderingContext, buffers: Buffers): void {
    const attributes = this.attributes;
    if (!attributes) return;
    const bind = (buffer: WebGLBuffer, location: number, size: number): void => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    };
    bind(buffers.position, attributes.position, 3);
    bind(buffers.normal, attributes.normal, 3);
    bind(buffers.face, attributes.face, 1);
    bind(buffers.uv, attributes.uv, 2);
  }

  private render(): void {
    const gl = this.gl;
    const program = this.program;
    const uniforms = this.uniforms;
    if (!gl || !program || !uniforms || this.lost) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    const ground = hexToRgb(PALETTE.ground);
    gl.clearColor(ground[0], ground[1], ground[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    this.ensureTexture(gl);
    if (this.texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(uniforms.label, 0);
    }

    const camera = this.camera();
    gl.uniformMatrix4fv(uniforms.viewProjection, false, viewProjection(camera, width, height));
    const tint = hexToRgb(tintColour(this.input.tint));
    gl.uniform3f(uniforms.tint, tint[0], tint[1], tint[2]);
    const kraft = hexToRgb(PALETTE.kraft);
    gl.uniform3f(uniforms.kraft, kraft[0], kraft[1], kraft[2]);
    gl.uniform1f(uniforms.seed, seedOf(this.input.batch));
    gl.uniform1f(uniforms.mode, 0);

    const total = this.input.bars.length;
    const slot = total > 0 ? LOAF.length / total : LOAF.length;
    for (let index = 0; index < total; index += 1) {
      if (this.input.bars[index] === 'S') continue;
      const buffers = this.barMesh(index, total);
      if (!buffers) continue;
      const tip = easeOut(Math.min(1, Math.max(0, this.tips[index] ?? 0)));
      const centre = barEdgeX(total, index) + slot / 2;
      const model = multiply(
        translation(centre, -tip * LOAF.height * 1.55, tip * LOAF.depth * 0.5),
        multiply(
          rotationY(tip * 1.1),
          multiply(rotationX(tip * 0.25), scaling(slot, LOAF.height, LOAF.depth)),
        ),
      );
      const wrapped = (this.wraps[index] ?? 0) > 0.5;
      const label: LabelKind = wrapped ? 'held' : 'available';
      gl.uniformMatrix4fv(uniforms.model, false, model);
      gl.uniform1f(uniforms.mode, 0);
      gl.uniform1f(uniforms.wrapped, wrapped ? 1 : 0);
      gl.uniform1f(uniforms.hasLabel, 1);
      gl.uniform1f(uniforms.labelRow, label === 'available' ? 1 : 0);
      gl.uniform1f(uniforms.seam, this.input.cutStep > index ? 1 : 0);
      gl.uniform2f(uniforms.labelOrigin, wrapped ? 0.52 : 0.14, 0.1);
      gl.uniform2f(uniforms.labelSize, 0.34, 0.8);
      this.bindMesh(gl, buffers);
      gl.drawArrays(gl.TRIANGLES, 0, buffers.count);
    }

    this.drawWire(gl, uniforms);
  }

  private drawWire(gl: WebGLRenderingContext, uniforms: Uniforms): void {
    const box = this.box;
    if (!box) return;
    const total = this.input.bars.length || 1;
    const x = barEdgeX(total, this.wireShown);
    const accent = hexToRgb(PALETTE.accent);
    gl.uniform3f(uniforms.tint, accent[0], accent[1], accent[2]);
    gl.uniform1f(uniforms.mode, 1);
    gl.uniform1f(uniforms.hasLabel, 0);
    gl.uniform1f(uniforms.wrapped, 0);
    gl.uniform1f(uniforms.seam, 0);

    const thickness = 0.004;
    const wireModel = multiply(
      multiply(translation(x, LOAF.height * 0.62, 0), rotationY(Math.PI / 2)),
      scaling(LOAF.depth * 1.32, thickness, thickness),
    );
    this.bindMesh(gl, box);
    gl.uniformMatrix4fv(uniforms.model, false, wireModel);
    gl.drawArrays(gl.TRIANGLES, 0, box.count);

    for (const side of [-1, 1]) {
      const handle = multiply(
        translation(x, LOAF.height * 0.62, side * LOAF.depth * 0.68),
        scaling(0.012, 0.03, 0.012),
      );
      gl.uniformMatrix4fv(uniforms.model, false, handle);
      gl.drawArrays(gl.TRIANGLES, 0, box.count);
    }
    gl.uniformMatrix4fv(uniforms.model, false, identity());
  }
}
