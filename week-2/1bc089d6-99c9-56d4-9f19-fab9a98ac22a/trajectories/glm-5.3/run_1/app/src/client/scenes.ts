// Every 3D scene, built in code, on one fixed canvas behind the whole page.
import { windowProgress } from './scroll.js';
import { prefersReducedMotion } from './dom.js';

export interface SceneWindow {
  el: HTMLElement;
  scene: number;
}

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// One shader, six scenes: dusk contours, city windows, still water,
// moonflowers, the turning moon and the lantern.
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uP;
uniform float uT;
uniform int uScene;
uniform vec2 uHover;
uniform float uHoverAmt;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 duskSky(vec2 uv, float horizon) {
  vec3 top = vec3(0.07, 0.05, 0.12);
  vec3 low = vec3(0.20, 0.13, 0.26);
  float t = smoothstep(0.0, horizon, uv.y);
  return mix(top, low, t);
}
float contourLines(vec2 uv, float t) {
  float acc = 0.0;
  for (int k = 0; k < 6; k++) {
    float fy = float(k) * 0.055 + 0.10;
    float y = fy + 0.012 * sin(uv.x * 9.0 + float(k) * 1.7 + t) + 0.008 * noise(vec2(uv.x * 6.0, float(k)));
    float d = abs(uv.y - y);
    float line = smoothstep(0.0016, 0.0, d);
    float fade = smoothstep(0.0, 0.25, uv.y) * (1.0 - float(k) / 7.0);
    acc += line * fade;
  }
  return acc;
}
vec3 sceneHero(vec2 uv, float p, float t) {
  vec3 col = duskSky(uv, 0.55);
  float star = step(0.995, hash(floor(uv * vec2(220.0, 160.0))));
  col += vec3(0.9, 0.88, 1.0) * star * 0.5 * smoothstep(0.4, 1.0, uv.y);
  float sunY = mix(0.34, 0.14, p);
  vec2 sunPos = vec2(0.62, sunY);
  float d = length((uv - sunPos) * vec2(uRes.x / uRes.y, 1.0));
  col += vec3(0.94, 0.55, 0.26) * smoothstep(0.055, 0.0, d) * 0.95;
  col += vec3(0.94, 0.55, 0.26) * smoothstep(0.30, 0.0, d) * 0.10;
  float lines = contourLines(uv, t * 0.15);
  col += vec3(0.91, 0.86, 0.96) * lines * 0.30;
  col += vec3(0.94, 0.55, 0.26) * smoothstep(0.004, 0.0, abs(uv.y - 0.20)) * 0.35;
  col *= 1.0 - 0.35 * length(uv - 0.5);
  return col;
}
vec3 sceneCity(vec2 uv, float p, float t) {
  vec3 col = mix(vec3(0.05, 0.04, 0.10), vec3(0.12, 0.08, 0.20), smoothstep(0.0, 0.6, uv.y));
  float star = step(0.997, hash(floor(uv * vec2(260.0, 200.0))));
  col += vec3(0.9, 0.88, 1.0) * star * 0.4 * smoothstep(0.5, 1.0, uv.y);
  float litFrac = clamp((p - 0.18) / 0.64, 0.0, 1.0);
  for (int b = 0; b < 7; b++) {
    float fi = float(b) / 7.0;
    float depth = fi;
    float baseY = 0.06 + depth * 0.16;
    float left = 0.06 + fi * 1.05 + 0.02 * sin(float(b) * 3.1);
    float wid = 0.10 + 0.045 * hash(vec2(float(b), 1.0));
    bool inX = uv.x > left && uv.x < left + wid;
    bool inY = uv.y < baseY + 0.55 && uv.y > 0.0;
    if (inX && inY) {
      vec3 building = mix(vec3(0.10, 0.08, 0.16), vec3(0.05, 0.04, 0.09), depth);
      col = building;
      vec2 cell = vec2(uv.x - left, uv.y - baseY);
      vec2 grid = floor(cell / vec2(0.016, 0.030));
      vec2 inCell = fract(cell / vec2(0.016, 0.030));
      float winX = step(0.28, inCell.x) * step(inCell.x, 0.72);
      float winY = step(0.35, inCell.y) * step(inCell.y, 0.72);
      if (winX * winY > 0.5 && hash(grid + float(b) * 17.0) > 0.35) {
        float idx = (grid.x + grid.y * 20.0) / 220.0 + depth * 0.9;
        float lit = step(idx / 1.9, 1.0 - litFrac);
        float warm = 0.75 + 0.25 * hash(grid * 3.0);
        col += vec3(0.95 * warm, 0.6 * warm, 0.28 * warm) * lit * (0.85 + 0.15 * sin(t * 2.0 + grid.x));
      }
    }
  }
  col *= 1.0 - 0.25 * length(uv - vec2(0.5, 0.3));
  return col;
}
vec3 sceneWater(vec2 uv, float p, float t) {
  float horizon = 0.42;
  vec3 col;
  if (uv.y > horizon) {
    col = mix(vec3(0.06, 0.05, 0.12), vec3(0.13, 0.09, 0.22), smoothstep(horizon, 1.0, uv.y));
    float star = step(0.995, hash(floor(uv * vec2(240.0, 180.0))));
    col += vec3(0.9, 0.88, 1.0) * star * 0.5;
    float md = length((uv - vec2(0.74, 0.78)) * vec2(uRes.x / uRes.y, 1.0));
    col += vec3(0.92, 0.9, 0.82) * smoothstep(0.045, 0.0, md) * 0.8;
    col += vec3(0.9, 0.86, 0.75) * smoothstep(0.16, 0.0, md) * 0.08;
  } else {
    col = vec3(0.03, 0.03, 0.07);
    float below = (horizon - uv.y) / horizon;
    float amp = mix(0.9, 0.08, p);
    float ripple = sin((uv.x * 22.0 + t * 1.2) + below * 18.0) * 0.5 + 0.5;
    float bands = smoothstep(0.55, 1.0, ripple) * exp(-below * 2.0);
    col += vec3(0.55, 0.5, 0.65) * bands * amp * 0.35;
    float md = length((uv - vec2(0.74, 0.0)) * vec2(uRes.x / uRes.y, 1.0));
    col += vec3(0.9, 0.85, 0.7) * smoothstep(0.012, 0.0, md) * (1.0 - below) * amp * 0.5;
    float bx = mix(0.18, 0.5, p);
    float bd = length((uv - vec2(bx, horizon - 0.05)) * vec2(uRes.x / uRes.y, 1.0));
    col += vec3(0.95, 0.9, 0.8) * smoothstep(0.016, 0.0, bd);
    col += vec3(0.95, 0.9, 0.8) * smoothstep(0.03, 0.016, bd) * 0.4;
  }
  return col;
}
vec3 sceneFlowers(vec2 uv, float p, float t) {
  vec3 col = mix(vec3(0.04, 0.03, 0.09), vec3(0.10, 0.07, 0.17), uv.y);
  float star = step(0.996, hash(floor(uv * vec2(260.0, 200.0))));
  col += vec3(0.9, 0.88, 1.0) * star * 0.45 * smoothstep(0.5, 1.0, uv.y);
  for (int fy = 0; fy < 5; fy++) {
    for (int fx = 0; fx < 8; fx++) {
      vec2 cell = vec2(float(fx), float(fy));
      vec2 centre = (cell + 0.5 + 0.35 * (vec2(hash(cell), hash(cell + 7.0)) - 0.5)) / vec2(8.0, 5.0);
      centre.y = mix(0.16, 0.72, centre.y);
      float depth = float(fy) / 5.0;
      float close = clamp((p * 1.25 - depth) / 0.35, 0.0, 1.0);
      // the flower whose grid cell the pointer is over closes first
      float hovX = floor(uHover.x * 8.0);
      float hovY = clamp(floor((uHover.y - 0.16) / 0.56 * 5.0), 0.0, 4.0);
      float hovered = step(abs(float(fx) - hovX), 0.5) * step(abs(float(fy) - hovY), 0.5);
      close = max(close, hovered * uHoverAmt);
      float d = length((uv - centre) * vec2(uRes.x / uRes.y, 1.0));
      float size = mix(0.022, 0.05, depth);
      float petal = smoothstep(size, size * 0.4, d);
      vec3 pale = mix(vec3(0.93, 0.90, 0.97), vec3(0.85, 0.80, 0.93), depth);
      col += pale * petal * (1.0 - close * 0.88);
      float openCore = smoothstep(size * 0.5, size * 0.15, d);
      col += vec3(0.95, 0.65, 0.35) * openCore * (1.0 - close);
    }
  }
  col *= 1.0 - 0.3 * length(uv - 0.5);
  return col;
}
vec3 sceneMoon(vec2 uv, float p, float t) {
  vec3 col = mix(vec3(0.03, 0.02, 0.07), vec3(0.09, 0.06, 0.16), uv.y);
  float star = step(0.994, hash(floor(uv * vec2(300.0, 220.0))));
  col += vec3(0.9, 0.88, 1.0) * star * 0.55;
  float illum = sin(clamp(p, 0.0, 1.0) * 3.14159265);
  vec2 centre = vec2(0.5, 0.62);
  float d = length((uv - centre) * vec2(uRes.x / uRes.y, 1.0));
  float disc = smoothstep(0.13, 0.125, d);
  vec3 moonCol = vec3(0.93, 0.90, 0.84);
  col = mix(col, moonCol * (0.15 + 0.85 * illum), disc);
  float limb = smoothstep(0.02, 0.0, abs(uv.x - centre.x)) * disc;
  col += vec3(0.95, 0.9, 0.8) * limb * illum * 0.25;
  col += vec3(0.9, 0.86, 0.95) * smoothstep(0.24, 0.0, d) * 0.06 * illum;
  col *= 1.0 - 0.3 * length(uv - 0.5);
  return col;
}
vec3 sceneLantern(vec2 uv, float p, float t) {
  vec3 col = vec3(0.02, 0.02, 0.05);
  float star = step(0.997, hash(floor(uv * vec2(300.0, 240.0))));
  col += vec3(0.9, 0.88, 1.0) * star * 0.3 * smoothstep(0.45, 1.0, uv.y);
  vec2 hang = vec2(0.5, 0.78);
  col += vec3(0.85, 0.8, 0.9) * smoothstep(0.0015, 0.0, abs(uv.x - hang.x)) * step(hang.y, uv.y) * 0.5;
  vec2 lanternTop = vec2(0.5, 0.72);
  float ly = lanternTop.y - uv.y;
  float halfW = 0.035 + 0.02 * smoothstep(0.0, 0.16, ly);
  float body = step(abs(uv.x - 0.5), halfW) * step(ly, 0.16) * step(0.0, ly);
  col = mix(col, vec3(0.35, 0.30, 0.45), body);
  float flameSize = mix(0.05, 0.004, p);
  float flick = 1.0 + 0.08 * sin(t * 5.0) * (1.0 - p);
  vec2 flamePos = vec2(0.5, 0.65);
  float fd = length((uv - flamePos) * vec2(uRes.x / uRes.y * 0.8, 1.4));
  float glow = smoothstep(flameSize * flick, 0.0, fd);
  col += vec3(0.97, 0.6, 0.28) * glow * (1.0 - p * 0.9);
  col += vec3(0.97, 0.6, 0.28) * smoothstep(flameSize * 6.0, 0.0, fd) * 0.10 * (1.0 - p);
  col *= 1.0 - 0.4 * length(uv - vec2(0.5, 0.5));
  return col;
}
void main() {
  vec2 uv = vUv * 0.5 + 0.5;
  vec3 col;
  if (uScene == 0) col = sceneHero(uv, uP, uT);
  else if (uScene == 1) col = sceneCity(uv, uP, uT);
  else if (uScene == 2) col = sceneWater(uv, uP, uT);
  else if (uScene == 3) col = sceneFlowers(uv, uP, uT);
  else if (uScene == 4) col = sceneMoon(uv, uP, uT);
  else col = sceneLantern(uv, uP, uT);
  gl_FragColor = vec4(col, 1.0);
}`;

export class SceneCanvas {
  private gl: WebGLRenderingContext | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private program: WebGLProgram | null = null;
  private uniforms: { res: WebGLUniformLocation | null; p: WebGLUniformLocation | null; t: WebGLUniformLocation | null; scene: WebGLUniformLocation | null; hover: WebGLUniformLocation | null; hoverAmt: WebGLUniformLocation | null } = { res: null, p: null, t: null, scene: null, hover: null, hoverAmt: null };
  private hoverUv: [number, number] = [-9, -9];
  private hoverAmt = 0;
  private hoverWanted = false;
  private canvas: HTMLCanvasElement;
  private windows: SceneWindow[] = [];
  private active = -1;
  private progress = 0;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (gl) {
      this.gl = gl;
      this.initGl();
    } else {
      this.ctx2d = canvas.getContext('2d');
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private initGl(): void {
    const gl = this.gl!;
    const compile = (type: number, src: string): WebGLShader => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        throw new Error('shader');
      }
      return sh;
    };
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
      gl.useProgram(prog);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.program = prog;
      this.uniforms = {
        res: gl.getUniformLocation(prog, 'uRes'),
        p: gl.getUniformLocation(prog, 'uP'),
        t: gl.getUniformLocation(prog, 'uT'),
        scene: gl.getUniformLocation(prog, 'uScene'),
        hover: gl.getUniformLocation(prog, 'uHover'),
        hoverAmt: gl.getUniformLocation(prog, 'uHoverAmt'),
      };
    } catch {
      this.gl = null;
      this.ctx2d = this.canvas.getContext('2d');
    }
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  setWindows(windows: SceneWindow[]): void {
    this.windows = windows;
  }

  // A flower under the pointer closes within a second; it reopens when the
  // pointer leaves or the scroll moves back above the close point.
  setHover(uv: [number, number] | null): void {
    this.hoverWanted = uv !== null;
    if (uv !== null) this.hoverUv = uv;
  }

  update(time: number): void {
    const mid = window.innerHeight / 2;
    let chosen = -1;
    let chosenP = 0;
    for (const w of this.windows) {
      const rect = w.el.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom >= mid) {
        chosen = w.scene;
        chosenP = windowProgress(w.el);
        break;
      }
    }
    if (chosen !== -1) {
      this.active = chosen;
      this.progress = chosenP;
    }
    if (this.hoverWanted) {
      this.hoverAmt = Math.min(1, this.hoverAmt + 1 / 55);
    } else {
      this.hoverAmt = Math.max(0, this.hoverAmt - 1 / 55);
    }
    this.time = prefersReducedMotion() ? 0 : time / 1000;
    this.draw();
  }

  private draw(): void {
    this.resize();
    if (this.gl && this.program) {
      const gl = this.gl;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.res, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.p, this.progress);
      gl.uniform1f(this.uniforms.t, this.time);
      gl.uniform1i(this.uniforms.scene, Math.max(0, this.active));
      gl.uniform2f(this.uniforms.hover, this.hoverUv[0], this.hoverUv[1]);
      gl.uniform1f(this.uniforms.hoverAmt, this.hoverAmt);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    if (this.ctx2d) {
      this.draw2d(this.ctx2d, Math.max(0, this.active), this.progress, this.time);
    }
  }

  // Flat drawings in the same colours, for browsers without WebGL.
  private draw2d(ctx: CanvasRenderingContext2D, scene: number, p: number, t: number): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#120c1e');
    grad.addColorStop(1, '#241a36');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e9e1f6';
    for (let i = 0; i < 60; i++) {
      const x = ((i * 97) % 100) / 100 * w;
      const y = ((i * 53) % 55) / 100 * h;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
    if (scene === 0) {
      const sunY = h * (0.66 - 0.2 * p);
      ctx.fillStyle = '#e8834a';
      ctx.beginPath();
      ctx.arc(w * 0.62, sunY, h * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(233,225,246,0.5)';
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) {
          const y = h * 0.12 + k * h * 0.055 + Math.sin(x / w * 9 + k * 1.7 + t * 0.15) * h * 0.012;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    } else if (scene === 1) {
      const litFrac = Math.max(0, Math.min(1, (p - 0.18) / 0.64));
      for (let b = 0; b < 7; b++) {
        const depth = b / 7;
        const bw = w * (0.10 + 0.03 * ((b * 37) % 10) / 10);
        const bx = w * (0.06 + depth * 1.0);
        const bh = h * (0.25 + depth * 0.45);
        ctx.fillStyle = depth > 0.5 ? '#0d0a18' : '#1a1226';
        ctx.fillRect(bx % (w - bw), h - bh, bw, bh);
        ctx.fillStyle = '#f0913f';
        for (let gx = 0; gx < 6; gx++) {
          for (let gy = 0; gy < 8; gy++) {
            const idx = (gx + gy * 6) / 60;
            if (idx >= 1 - litFrac) continue;
            if ((gx * 7 + gy * 13 + b) % 4 === 0) continue;
            ctx.globalAlpha = 0.8;
            ctx.fillRect(bx % (w - bw) + 6 + gx * (bw / 6), h - bh + 10 + gy * (bh / 9), bw / 14, bh / 22);
          }
        }
        ctx.globalAlpha = 1;
      }
    } else if (scene === 2) {
      const amp = 0.9 - 0.82 * p;
      ctx.strokeStyle = 'rgba(150,140,170,0.6)';
      for (let k = 0; k < 8; k++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 14) {
          const y = h * 0.55 + k * h * 0.05 + Math.sin(x / w * 20 + t * 1.2 + k) * 10 * amp;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const bx = w * (0.15 + 0.7 * p);
      ctx.fillStyle = '#f6ead9';
      ctx.beginPath();
      ctx.moveTo(bx - 26, h * 0.58);
      ctx.lineTo(bx + 26, h * 0.58);
      ctx.lineTo(bx, h * 0.54);
      ctx.closePath();
      ctx.fill();
    } else if (scene === 3) {
      const hovX = Math.floor((this.hoverUv[0] + 9) * 8);
      const hovY = Math.min(4, Math.max(0, Math.floor(((this.hoverUv[1] + 9) - 0.16) / 0.56 * 5)));
      for (let fy = 0; fy < 5; fy++) {
        for (let fx = 0; fx < 8; fx++) {
          const hovered = fx === hovX && fy === hovY ? this.hoverAmt : 0;
          const close = Math.max(0, Math.min(1, (p * 1.25 - fy / 5) / 0.35), hovered);
          const cx = (fx + 0.5) / 8 * w + ((fx * 29) % 40) - 20;
          const cy = h * (0.4 + fy * 0.11);
          const r = h * 0.04 * (1 + fy * 0.12) * (1 - close * 0.85);
          ctx.fillStyle = close > 0.8 ? '#3a3350' : '#e9e1f6';
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2, r), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (scene === 4) {
      const illum = Math.sin(Math.min(1, Math.max(0, p)) * Math.PI);
      ctx.fillStyle = '#f6ead9';
      ctx.beginPath();
      ctx.arc(w / 2, h * 0.4, h * 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#120c1e';
      ctx.beginPath();
      ctx.arc(w / 2 + h * 0.16 * (1 - illum) * 2, h * 0.4, h * 0.16 + 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const flame = 1 - p;
      ctx.strokeStyle = 'rgba(233,225,246,0.7)';
      ctx.strokeRect(w / 2 - h * 0.06, h * 0.45, h * 0.12, h * 0.2);
      ctx.fillStyle = `rgba(240,145,63,${0.9 * flame + 0.05})`;
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.55, h * 0.05 * flame + 3, h * 0.07 * flame + 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
