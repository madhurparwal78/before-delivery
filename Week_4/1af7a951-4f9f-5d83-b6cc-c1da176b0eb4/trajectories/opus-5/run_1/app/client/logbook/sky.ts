import type { SignCategory } from '../api.js';

export const SKY_CATEGORIES: readonly SignCategory[] = [
  'inner_awareness',
  'action',
  'form',
  'context',
];

const ANCHORS: Record<SignCategory, { x: number; y: number }> = {
  inner_awareness: { x: 0.26, y: 0.27 },
  action: { x: 0.74, y: 0.27 },
  form: { x: 0.26, y: 0.73 },
  context: { x: 0.74, y: 0.73 },
};

const SEEDS: Record<SignCategory, number> = {
  inner_awareness: 0.4,
  action: 1.7,
  form: 3.1,
  context: 5.2,
};

const GOLDEN_ANGLE = 2.399_963_23;
const FOG_CYCLE_MS = 60_000;
const STAR_FADE_MS = 100;

export interface SkyCounts {
  readonly stars: Record<SignCategory, number>;
  readonly halos: Record<SignCategory, number>;
}

export function emptySkyCounts(): SkyCounts {
  return {
    stars: { inner_awareness: 0, action: 0, form: 0, context: 0 },
    halos: { inner_awareness: 12, action: 12, form: 12, context: 12 },
  };
}

export function anchorPoint(
  category: SignCategory,
  width: number,
  height: number,
): { x: number; y: number } {
  const anchor = ANCHORS[category];
  return { x: anchor.x * width, y: anchor.y * height };
}

export function starPoint(
  category: SignCategory,
  index: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const anchor = anchorPoint(category, width, height);
  const scale = Math.min(width, height) / 800;
  const radius = (16 + 13 * Math.sqrt(index)) * Math.max(0.5, scale);
  const angle = index * GOLDEN_ANGLE + SEEDS[category];
  return { x: anchor.x + radius * Math.cos(angle), y: anchor.y + radius * Math.sin(angle) };
}

const VERTEX_SOURCE = `
attribute vec2 a_quad;
attribute vec2 a_center;
attribute float a_radius;
attribute float a_alpha;
uniform vec2 u_resolution;
uniform vec2 u_pan;
varying vec2 v_quad;
varying float v_alpha;
void main() {
  vec2 pixel = a_center + u_pan + a_quad * a_radius;
  vec2 clip = (pixel / u_resolution) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_quad = a_quad;
  v_alpha = a_alpha;
}`;

const FRAGMENT_SOURCE = `
precision mediump float;
uniform vec3 u_color;
uniform float u_softness;
varying vec2 v_quad;
varying float v_alpha;
void main() {
  float d = length(v_quad);
  if (d > 1.0) discard;
  float fall = pow(max(0.0, 1.0 - d), u_softness);
  gl_FragColor = vec4(u_color * fall, fall * v_alpha);
}`;

const FOG_VERTEX_SOURCE = `
attribute vec2 a_quad;
varying vec2 v_uv;
void main() {
  v_uv = a_quad * 0.5 + 0.5;
  gl_Position = vec4(a_quad, 0.0, 1.0);
}`;

const FOG_FRAGMENT_SOURCE = `
precision mediump float;
uniform float u_time;
varying vec2 v_uv;
float wave(vec2 p, float t) {
  return sin(p.x * 3.0 + t) * 0.5 + sin(p.y * 4.0 - t * 0.7) * 0.5;
}
void main() {
  vec2 p = v_uv * 3.0;
  float t = u_time * 6.2831853;
  float value = wave(p + vec2(t * 0.08, 0.0), t) * 0.5 + 0.5;
  float alpha = 0.07 * smoothstep(0.25, 1.0, value);
  gl_FragColor = vec4(vec3(0.42, 0.33, 0.72) * alpha, alpha);
}`;

interface Program {
  readonly program: WebGLProgram;
  readonly attributes: Record<string, number>;
  readonly uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) return null;
  return shader;
}

function link(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  attributes: readonly string[],
  uniforms: readonly string[],
): Program | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (vertex === null || fragment === null || program === null) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  return {
    program,
    attributes: Object.fromEntries(
      attributes.map((name) => [name, gl.getAttribLocation(program, name)]),
    ),
    uniforms: Object.fromEntries(
      uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
    ),
  };
}

const QUAD = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];

export class Sky {
  private readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGLRenderingContext | null;
  private readonly context2d: CanvasRenderingContext2D | null;
  private shapes: Program | null = null;
  private fog: Program | null = null;
  private shapeBuffer: WebGLBuffer | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private counts: SkyCounts = emptySkyCounts();
  private pan = { x: 0, y: 0 };
  private newStarAt: number | null = null;
  private frame = 0;
  private reducedMotion: boolean;

  constructor(canvas: HTMLCanvasElement, reducedMotion: boolean, force2d = false) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    const gl = force2d
      ? null
      : canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: true });
    this.gl = gl instanceof WebGLRenderingContext ? gl : null;
    this.context2d = this.gl === null ? canvas.getContext('2d') : null;
    if (this.gl !== null) this.setUpGl(this.gl);
  }

  private setUpGl(gl: WebGLRenderingContext): void {
    this.shapes = link(
      gl,
      VERTEX_SOURCE,
      FRAGMENT_SOURCE,
      ['a_quad', 'a_center', 'a_radius', 'a_alpha'],
      ['u_resolution', 'u_pan', 'u_color', 'u_softness'],
    );
    this.fog = link(gl, FOG_VERTEX_SOURCE, FOG_FRAGMENT_SOURCE, ['a_quad'], ['u_time']);
    this.shapeBuffer = gl.createBuffer();
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(QUAD), gl.STATIC_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    this.draw();
  }

  setCounts(counts: SkyCounts, fadeIn: boolean): void {
    this.counts = counts;
    this.newStarAt = fadeIn ? performance.now() : null;
    this.draw();
    if (fadeIn) this.scheduleFade();
  }

  panBy(dx: number, dy: number): void {
    const limitX = this.canvas.clientWidth / 2;
    const limitY = this.canvas.clientHeight / 2;
    this.pan = {
      x: Math.max(-limitX, Math.min(limitX, this.pan.x + dx)),
      y: Math.max(-limitY, Math.min(limitY, this.pan.y + dy)),
    };
    this.draw();
  }

  recentre(): void {
    this.pan = { x: 0, y: 0 };
    this.draw();
  }

  resize(): void {
    const ratio = window.devicePixelRatio;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.draw();
  }

  startFog(): void {
    if (this.frame !== 0 || this.reducedMotion) return;
    const tick = (): void => {
      this.draw();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  stopFog(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private scheduleFade(): void {
    const start = performance.now();
    const step = (): void => {
      this.draw();
      if (performance.now() - start < STAR_FADE_MS) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private starAlpha(): number {
    if (this.newStarAt === null) return 1;
    const elapsed = performance.now() - this.newStarAt;
    return elapsed >= STAR_FADE_MS ? 1 : Math.max(0.05, elapsed / STAR_FADE_MS);
  }

  draw(): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (width === 0 || height === 0) return;
    const ratio = width / Math.max(1, this.canvas.clientWidth);
    if (this.gl !== null) this.drawGl(this.gl, width, height, ratio);
    else if (this.context2d !== null) this.draw2d(this.context2d, width, height, ratio);
  }

  private shapeData(
    width: number,
    height: number,
    ratio: number,
    kind: 'halo' | 'star',
  ): Float32Array {
    const rows: number[] = [];
    const newest = this.starAlpha();
    for (const category of SKY_CATEGORIES) {
      if (kind === 'halo') {
        const anchor = anchorPoint(category, width, height);
        rows.push(...quadRows(anchor.x, anchor.y, this.counts.halos[category] * ratio, 0.55));
        continue;
      }
      const total = this.counts.stars[category];
      for (let index = 0; index < total; index += 1) {
        const point = starPoint(category, index, width, height);
        const alpha = index === total - 1 ? newest : 1;
        rows.push(...quadRows(point.x, point.y, 7 * ratio, alpha));
      }
    }
    return new Float32Array(rows);
  }

  private drawGl(
    gl: WebGLRenderingContext,
    width: number,
    height: number,
    ratio: number,
  ): void {
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const fog = this.fog;
    if (fog !== null && this.quadBuffer !== null) {
      gl.useProgram(fog.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
      const quad = fog.attributes['a_quad'] ?? 0;
      gl.enableVertexAttribArray(quad);
      gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, 0, 0);
      const time = this.reducedMotion ? 0 : (performance.now() % FOG_CYCLE_MS) / FOG_CYCLE_MS;
      gl.uniform1f(fog.uniforms['u_time'] ?? null, time);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    const shapes = this.shapes;
    if (shapes === null || this.shapeBuffer === null) return;
    gl.useProgram(shapes.program);
    gl.uniform2f(shapes.uniforms['u_resolution'] ?? null, width, height);
    gl.uniform2f(shapes.uniforms['u_pan'] ?? null, this.pan.x * ratio, this.pan.y * ratio);
    for (const kind of ['halo', 'star'] as const) {
      const data = this.shapeData(width, height, ratio, kind);
      if (data.length === 0) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.shapeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      const stride = 6 * 4;
      const quad = shapes.attributes['a_quad'] ?? 0;
      const center = shapes.attributes['a_center'] ?? 0;
      const radius = shapes.attributes['a_radius'] ?? 0;
      const alpha = shapes.attributes['a_alpha'] ?? 0;
      gl.enableVertexAttribArray(quad);
      gl.vertexAttribPointer(quad, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(center);
      gl.vertexAttribPointer(center, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(radius);
      gl.vertexAttribPointer(radius, 1, gl.FLOAT, false, stride, 16);
      gl.enableVertexAttribArray(alpha);
      gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, stride, 20);
      gl.uniform3f(
        shapes.uniforms['u_color'] ?? null,
        kind === 'star' ? 0.65 : 0.3,
        kind === 'star' ? 0.98 : 0.8,
        kind === 'star' ? 0.95 : 0.78,
      );
      gl.uniform1f(shapes.uniforms['u_softness'] ?? null, kind === 'star' ? 2.4 : 1.4);
      gl.drawArrays(gl.TRIANGLES, 0, data.length / 6);
    }
  }

  private draw2d(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    ratio: number,
  ): void {
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(this.pan.x * ratio, this.pan.y * ratio);
    for (const category of SKY_CATEGORIES) {
      const anchor = anchorPoint(category, width, height);
      const radius = this.counts.halos[category] * ratio;
      const halo = context.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, radius);
      halo.addColorStop(0, 'rgba(94, 230, 220, 0.30)');
      halo.addColorStop(1, 'rgba(94, 230, 220, 0)');
      context.fillStyle = halo;
      context.beginPath();
      context.arc(anchor.x, anchor.y, radius, 0, Math.PI * 2);
      context.fill();
    }
    const newest = this.starAlpha();
    for (const category of SKY_CATEGORIES) {
      const total = this.counts.stars[category];
      for (let index = 0; index < total; index += 1) {
        const point = starPoint(category, index, width, height);
        context.globalAlpha = index === total - 1 ? newest : 1;
        const size = 7 * ratio;
        const star = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, size);
        star.addColorStop(0, 'rgba(167, 255, 247, 1)');
        star.addColorStop(1, 'rgba(94, 230, 220, 0)');
        context.fillStyle = star;
        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
    context.restore();
  }
}

function quadRows(x: number, y: number, radius: number, alpha: number): number[] {
  const rows: number[] = [];
  for (let corner = 0; corner < 6; corner += 1) {
    rows.push(
      QUAD[corner * 2] ?? 0,
      QUAD[corner * 2 + 1] ?? 0,
      x,
      y,
      radius,
      alpha,
    );
  }
  return rows;
}
