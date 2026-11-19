// The Confidence Strata session field: WebGL terrain, readback strip, still fallback.

import { BINS } from '../src-shared/spectrum';
import type { SessionState } from '../src-shared/protocol';
import { prefersReducedMotion } from './lib';

export type FieldRow = { frame: number; peak_bin: number; bins: number[] };

export type FieldState = {
  /** The public semantic state: idle, connecting, live, closed, quota_halted */
  display: 'idle' | 'connecting' | 'live' | 'closed' | 'quota_halted';
  /** The exact server state, mirrored in data-end-state */
  endState: SessionState | 'none';
};

export type FieldHandle = {
  canvas: HTMLCanvasElement;
  pushRow(row: FieldRow): void;
  setState(state: FieldState): void;
  loadHistory(rows: FieldRow[]): void;
  destroy(): void;
};

const ROWS = 240;
const STRIP_PX = 48;

/**
 * Creates the session field. WebGL terrain when available, else the 2D still fallback
 * with the same accessible name and the same data attributes.
 */
export function createSessionField(name: string): FieldHandle {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', name);
  canvas.className = 'session-field';
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: true, alpha: false });

  const state: FieldState = { display: 'idle', endState: 'none' };
  let history: Float32Array[] = [];
  let currentFrame = 0;
  let currentPeak = 0;
  // Smoothed strip heights: rise within ~1/20 s, fall over ~1/4 s.
  const stripH = new Float32Array(BINS);
  const target = new Float32Array(BINS);
  let historyDirty = true;
  let raf = 0;
  let lastDraw = 0;
  let stopped = false;
  let lastStep = 0;
  let attributeFrame = 0;
  let uGrey: WebGLUniformLocation | null = null;
  let uRes: WebGLUniformLocation | null = null;
  let fieldTex: WebGLTexture | null = null;
  let program: WebGLProgram | null = null;

  const texData = new Uint8Array(BINS * ROWS);

  function attrs(): void {
    canvas.setAttribute('data-session-state', state.display);
    canvas.setAttribute('data-end-state', state.endState);
    canvas.setAttribute('data-frame', String(attributeFrame));
    canvas.setAttribute('data-peak-bin', String(currentPeak));
  }

  function resize(): void {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    // The drawing buffer is exactly the displayed size: one buffer pixel per layout pixel.
    const w = Math.max(2, Math.round(rect.width * dpr));
    const h = Math.max(2, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      if (gl) gl.viewport(0, 0, w, h);
      historyDirty = true;
    }
  }

  function initWebGL(): void {
    if (!gl) return;
    const vs = `
attribute vec2 aPos;
varying vec2 vPos;
void main() { vPos = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;
    const fs = `
precision mediump float;
varying vec2 vPos;
uniform sampler2D uField;
uniform float uGrey;
uniform vec2 uRes;
void main() {
  vec2 uv = vPos * 0.5 + 0.5;
  float stripPx = 48.0;
  float yPx = uv.y * uRes.y;
  if (yPx < stripPx) {
    float bin = floor(uv.x * 64.0);
    float v = texture2D(uField, vec2((bin + 0.5) / 64.0, 0.5)).r;
    float lit = floor(v * stripPx + 0.5);
    vec3 ground = vec3(0.047, 0.055, 0.063);
    vec3 bar = mix(ground, mix(vec3(0.24, 0.86, 0.59), vec3(0.68, 0.72, 0.75), uGrey), lit > yPx ? 1.0 : 0.0);
    gl_FragColor = vec4(bar, 1.0);
    return;
  }
  vec2 t = vec2(uv.x, (yPx - stripPx) / (uRes.y - stripPx));
  float depth = t.y;                       // 0 = back, 1 = front edge
  float rowFloat = depth * (239.0);
  float row0 = floor(rowFloat);
  float rowFrac = rowFloat - row0;
  float h0 = texture2D(uField, vec2(t.x, (row0 + 0.5) / 240.0)).r;
  float h1 = texture2D(uField, vec2(t.x, (min(row0 + 1.0, 239.0) + 0.5) / 240.0)).r;
  float h = mix(h0, h1, rowFrac);
  float inside = step(depth, h);
  vec3 accent = vec3(0.24, 0.86, 0.59);
  vec3 grey = vec3(0.52, 0.57, 0.60);
  vec3 col = mix(vec3(0.035, 0.04, 0.047), mix(accent, grey, uGrey), inside * (0.3 + 0.7 * h));
  col = mix(col * 0.5, col, depth);
  gl_FragColor = vec4(col, 1.0);
}
`;
    program = buildProgram(gl, vs, fs);
    if (!program) return;
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    fieldTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, BINS, ROWS, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(BINS * ROWS));
    uGrey = gl.getUniformLocation(program, 'uGrey');
    uRes = gl.getUniformLocation(program, 'uRes');
  }

  function buildProgram(gl2: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl2.createShader(type);
      if (!sh) return null;
      gl2.shaderSource(sh, src);
      gl2.compileShader(sh);
      if (!gl2.getShaderParameter(sh, gl2.COMPILE_STATUS)) return null;
      return sh;
    };
    const vs = compile(gl2.VERTEX_SHADER, vsSrc);
    const fs = compile(gl2.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl2.createProgram();
    if (!prog) return null;
    gl2.attachShader(prog, vs);
    gl2.attachShader(prog, fs);
    gl2.linkProgram(prog);
    if (!gl2.getProgramParameter(prog, gl2.LINK_STATUS)) return null;
    return prog;
  }

  function uploadTexture(): void {
    if (!gl || !fieldTex) return;
    gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    // The front (newest) row is at texture v = (ROWS-1)/ROWS, i.e. uv.y near 1 after strip mapping.
    for (let r = 0; r < ROWS; r++) {
      const src = history[r];
      for (let b = 0; b < BINS; b++) texData[r * BINS + b] = Math.max(0, Math.min(255, Math.round((src ? src[b] : 0) * 255)));
    }
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BINS, ROWS, gl.LUMINANCE, gl.UNSIGNED_BYTE, texData);
  }

  const ctx2d = gl ? null : canvas.getContext('2d');

  function drawStrip2d(): void {
    if (!ctx2d) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx2d.fillStyle = '#0c0e10';
    ctx2d.fillRect(0, 0, W, H);
    const accent = state.display === 'live' ? '#3ddc97' : state.display === 'quota_halted' ? '#6a7075' : '#c7ccd1';
    ctx2d.fillStyle = accent;
    for (let i = 0; i < BINS; i++) {
      const x0 = Math.floor((i * W) / BINS);
      const x1 = Math.floor(((i + 1) * W) / BINS) - 1;
      const lit = Math.round(stripH[i] * STRIP_PX);
      if (lit > 0 && x1 >= x0) ctx2d.fillRect(x0, H - lit, x1 - x0 + 1, lit);
    }
  }

  function renderGL(): void {
    if (!gl || !program) return;
    if (historyDirty) {
      uploadTexture();
      historyDirty = false;
    }
    const grey = state.display === 'quota_halted' ? 1.0 : 0.0;
    gl.uniform1f(uGrey, grey);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function step(ts: number): void {
    if (stopped) return;
    raf = requestAnimationFrame(step);
    resize();
    const dt = Math.min(64, ts - (lastDraw || ts));
    lastDraw = ts;
    if (prefersReducedMotion()) {
      // The strip and data-frame step once per second to the latest row, no easing.
      if (ts - lastStep >= 1000) {
        lastStep = ts;
        for (let i = 0; i < BINS; i++) stripH[i] = target[i];
        attributeFrame = currentFrame;
        attrs();
        if (gl) renderGL();
        else drawStrip2d();
      }
      return;
    }
    for (let i = 0; i < BINS; i++) {
      const diff = target[i] - stripH[i];
      if (diff > 0) stripH[i] = Math.min(target[i], stripH[i] + diff * Math.min(1, dt / 50));
      else if (diff < 0) stripH[i] = Math.max(target[i], stripH[i] + diff * Math.min(1, dt / 250));
    }
    attributeFrame = currentFrame;
    attrs();
    if (gl) renderGL();
    else drawStrip2d();
  }

  if (gl) initWebGL();
  else canvas.className = 'session-field still';
  raf = requestAnimationFrame(step);
  resize();
  attrs();

  return {
    canvas,
    pushRow(row: FieldRow): void {
      currentFrame = row.frame;
      currentPeak = row.peak_bin;
      history.push(Float32Array.from(row.bins));
      if (history.length > ROWS) history.shift();
      for (let i = 0; i < BINS; i++) target[i] = row.bins[i] ?? 0;
      historyDirty = true;
      attributeFrame = row.frame;
      attrs();
    },
    setState(next: FieldState): void {
      state.display = next.display;
      state.endState = next.endState;
      if (next.display === 'connecting') {
        // The terrain lies flat at baseline and no strip bar is taller than 2 pixels.
        history = [];
        for (let i = 0; i < BINS; i++) { target[i] = 0; stripH[i] = Math.min(stripH[i], 0.04); }
        historyDirty = true;
      }
      attrs();
    },
    loadHistory(rows: FieldRow[]): void {
      history = rows.slice(-ROWS).map((r) => Float32Array.from(r.bins));
      const last = rows[rows.length - 1];
      if (last) {
        currentFrame = last.frame;
        currentPeak = last.peak_bin;
        for (let i = 0; i < BINS; i++) { target[i] = last.bins[i] ?? 0; stripH[i] = last.bins[i] ?? 0; }
      }
      historyDirty = true;
      attributeFrame = currentFrame;
      attrs();
    },
    destroy(): void {
      stopped = true;
      cancelAnimationFrame(raf);
    },
  };
}
