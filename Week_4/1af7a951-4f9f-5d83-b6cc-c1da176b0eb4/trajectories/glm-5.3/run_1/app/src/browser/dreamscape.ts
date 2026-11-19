// The dreamscape: WebGL sky with four constellations, fog drift, panning,
// sign condensation and the reduced-motion and no-WebGL fallbacks.

import type { ConstellationInfo } from './api.js';

export type CondensationPhase = 'idle' | 'underline' | 'flight' | 'settle' | 'refused';

export const CATEGORY_LABELS = {
  inner_awareness: 'Inner awareness',
  action: 'Action',
  form: 'Form',
  context: 'Context',
};

interface AnchorPoint {
  x: number;
  y: number;
}

const ANCHORS: Record<CategoryKey, AnchorPoint> = {
  inner_awareness: { x: 0.28, y: 0.3 },
  action: { x: 0.72, y: 0.28 },
  form: { x: 0.3, y: 0.72 },
  context: { x: 0.74, y: 0.7 },
};

type CategoryKey = 'inner_awareness' | 'action' | 'form' | 'context';

const CATEGORY_COLOR = [0.36, 0.93, 0.9];

interface Star {
  x: number;
  y: number;
  r: number;
  twinkleSeed: number;
}

export class Dreamscape {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private stars: Star[] = [];
  private haloPx = { inner_awareness: 12, action: 12, form: 12, context: 12 };
  private counts = { inner_awareness: 0, action: 0, form: 0, context: 0 };
  private panX = 0;
  private panY = 0;
  private maxPan = { x: 0, y: 0 };
  private reducedMotion = false;
  private width = 0;
  private height = 0;
  private fogOffset = 0;
  private frame = 0;
  private running = false;
  private webglOk = false;
  private fallback: HTMLCanvasElement | null = null;
  private fogSpeed = 60; // seconds per drift cycle

  constructor(canvas: HTMLCanvasElement, reduced: boolean) {
    this.canvas = canvas;
    this.reducedMotion = reduced;
    const attrs: WebGLContextAttributes = { alpha: true, antialias: true };
    this.gl = (canvas.getContext('webgl', attrs) ?? canvas.getContext('experimental-webgl', attrs)) as WebGLRenderingContext | null;
    this.webglOk = this.gl !== null;
    if (this.webglOk && this.gl !== null) {
      this.initGl(this.gl);
    }
    this.fogSpeed = 40 + Math.random() * 40;
  }

  private initGl(gl: WebGLRenderingContext): void {
    const vsSource = `
      attribute vec2 aPos;
      varying vec2 vPos;
      void main() {
        gl_Position = vec4(aPos, 0.0, 1.0);
        vPos = aPos;
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec2 vPos;
      uniform vec2 uPan;
      uniform vec2 uSize;
      uniform float uTime;
      uniform float uFogPhase;
      uniform vec4 uStars[64];
      uniform int uStarCount;
      uniform vec4 uHalos[4];
      void main() {
        vec2 uv = (vPos + 1.0) * 0.5;
        vec2 sky = uv * uSize + uPan;
        vec3 col = mix(vec3(0.055, 0.043, 0.13), vec3(0.09, 0.06, 0.2), 1.0 - uv.y);
        float fog = sin(uv.x * 3.1 + uFogPhase) * 0.5 + 0.5;
        float fog2 = sin(uv.x * 1.7 - uFogPhase * 0.6 + uv.y * 2.3) * 0.5 + 0.5;
        col += vec3(0.10, 0.06, 0.18) * fog * 0.16;
        col += vec3(0.07, 0.04, 0.14) * fog2 * 0.1;
        for (int i = 0; i < 4; i++) {
          vec4 halo = uHalos[i];
          float d = distance(sky, halo.xy);
          float r = halo.z;
          float a = smoothstep(r, r * 0.2, d) * 0.16;
          col = mix(col, vec3(0.24, 0.9, 0.88), a);
        }
        for (int i = 0; i < 64; i++) {
          if (i >= uStarCount) break;
          vec4 s = uStars[i];
          float d = distance(sky, s.xy);
          float tw = 0.75 + 0.25 * sin(uTime * 1.7 + s.w);
          float core = smoothstep(s.z, s.z * 0.25, d);
          float glow = smoothstep(s.z * 3.2, s.z * 0.4, d) * 0.25;
          col = mix(col, vec3(0.55, 1.0, 0.96), (core + glow) * tw);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `;
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (shader === null) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, vsSource);
    const fs = compile(gl.FRAGMENT_SHADER, fsSource);
    if (vs === null || fs === null) {
      this.webglOk = false;
      this.gl = null;
      return;
    }
    const program = gl.createProgram();
    if (program === null) {
      this.webglOk = false;
      this.gl = null;
      return;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      this.webglOk = false;
      this.gl = null;
      return;
    }
    gl.useProgram(program);
    this.program = program;
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.webglOk = true;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.floor(width * dpr));
    this.canvas.height = Math.max(1, Math.floor(height * dpr));
    this.maxPan = { x: width / 2, y: height / 2 };
    if (this.gl !== null) this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.placeStars();
    this.draw(0);
  }

  // stars are placed deterministically from their index so every load draws
  // the same sky.
  private placeStars(): void {
    const stars: Star[] = [];
    for (const cat of Object.keys(ANCHORS) as (keyof typeof ANCHORS)[]) {
      const anchor = ANCHORS[cat];
      const count = this.counts[cat];
      for (let i = 0; i < count; i += 1) {
        const angle = (i * 137.508 * Math.PI) / 180;
        const ring = 1 + Math.floor(i / 9);
        const spread = 34 + ring * 22;
        stars.push({
          x: anchor.x * this.width + Math.cos(angle) * spread,
          y: anchor.y * this.height + Math.sin(angle) * spread,
          r: 2.2 + ((i * 37) % 100) / 100 * 1.6,
          twinkleSeed: i * 3.7,
        });
      }
    }
    this.stars = stars;
  }

  setConstellations(constellations: ConstellationInfo[]): void {
    for (const c of constellations) {
      this.counts[c.category] = c.stars;
      this.haloPx[c.category] = c.halo_px;
    }
    this.placeStars();
    this.draw(0);
  }

  countsSnapshot(): { inner_awareness: number; action: number; form: number; context: number } {
    return { ...this.counts };
  }

  panBy(dx: number, dy: number): void {
    this.panX = clamp(this.panX + dx, -this.maxPan.x, this.maxPan.x);
    this.panY = clamp(this.panY + dy, -this.maxPan.y, this.maxPan.y);
    this.draw(0);
  }

  recenter(): void {
    this.panX = 0;
    this.panY = 0;
    this.draw(0);
  }

  // The condensation: called when a tag is confirmed. Returns the category
  // anchor for the browser's flight animation.
  anchorFor(category: string): { x: number; y: number } {
    const a = ANCHORS[category as keyof typeof ANCHORS] ?? ANCHORS.form;
    const rect = this.canvas.getBoundingClientRect();
    return { x: a.x * rect.width, y: a.y * rect.height };
  }

  addStar(category: string): void {
    this.counts[category as keyof typeof this.counts] += 1;
    this.placeStars();
    this.draw(0);
  }

  removeStar(category: string): void {
    const key = category as keyof typeof this.counts;
    this.counts[key] = Math.max(0, this.counts[key] - 1);
    this.placeStars();
    this.draw(0);
  }

  get hasWebgl(): boolean {
    return this.webglOk;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number): void => {
      if (!this.running) return;
      if (!document.hidden) this.draw(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  private draw(time: number): void {
    if (!this.webglOk || this.gl === null || this.program === null) {
      this.drawFallback();
      return;
    }
    const gl = this.gl;
    gl.useProgram(this.program);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const size = gl.getUniformLocation(this.program, 'uSize');
    gl.uniform2f(size, this.width, this.height);
    const pan = gl.getUniformLocation(this.program, 'uPan');
    gl.uniform2f(pan, this.panX * dpr, this.panY * dpr);
    const t = gl.getUniformLocation(this.program, 'uTime');
    gl.uniform1f(t, time / 1000);
    const fog = gl.getUniformLocation(this.program, 'uFogPhase');
    const phase = this.reducedMotion ? 0 : (time / 1000 / this.fogSpeed) * Math.PI * 2;
    gl.uniform1f(fog, phase);
    const starsLoc = gl.getUniformLocation(this.program, 'uStars');
    const dprStars = this.stars.map((s) => [s.x * dpr, s.y * dpr, s.r * dpr, s.twinkleSeed]);
    const flat = new Float32Array(64 * 4);
    for (let i = 0; i < Math.min(dprStars.length, 64); i += 1) {
      const s = dprStars[i];
      flat[i * 4] = s ? (s[0] ?? 0) : 0;
      flat[i * 4 + 1] = s ? (s[1] ?? 0) : 0;
      flat[i * 4 + 2] = s ? (s[2] ?? 0) : 0;
      flat[i * 4 + 3] = s ? (s[3] ?? 0) : 0;
    }
    gl.uniform4fv(starsLoc, flat);
    const countLoc = gl.getUniformLocation(this.program, 'uStarCount');
    gl.uniform1i(countLoc, Math.min(this.stars.length, 64));
    const halosLoc = gl.getUniformLocation(this.program, 'uHalos');
    const haloData = new Float32Array(16);
    let hi = 0;
    for (const cat of Object.keys(ANCHORS) as (keyof typeof ANCHORS)[]) {
      const a = ANCHORS[cat];
      haloData[hi] = a.x * this.width * dpr;
      haloData[hi + 1] = a.y * this.height * dpr;
      haloData[hi + 2] = this.haloPx[cat] * dpr;
      haloData[hi + 3] = 0;
      hi += 4;
    }
    gl.uniform4fv(halosLoc, haloData);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawFallback(): void {
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#170f2b');
    grad.addColorStop(1, '#0e0a21');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);
    for (const cat of Object.keys(ANCHORS) as (keyof typeof ANCHORS)[]) {
      const anchor = ANCHORS[cat];
      const cx = anchor.x * this.width - this.panX;
      const cy = anchor.y * this.height - this.panY;
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, this.haloPx[cat]);
      halo.addColorStop(0, 'rgba(92, 238, 230, 0.18)');
      halo.addColorStop(1, 'rgba(92, 238, 230, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, this.haloPx[cat], 0, Math.PI * 2);
      ctx.fill();
    }
    for (const s of this.stars) {
      const x = s.x - this.panX;
      const y = s.y - this.panY;
      ctx.fillStyle = 'rgba(140, 255, 245, 0.95)';
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function reducedMotionWanted(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
