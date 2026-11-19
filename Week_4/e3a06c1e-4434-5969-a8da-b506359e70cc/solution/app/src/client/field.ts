// Confidence Strata: the session field. A WebGL terrain 64 bins wide by 240 history rows deep, newest
// row at the front, seen from a fixed camera; the bottom 48 px is a readback strip of 64 bars mirroring
// the front row. Without WebGL, a 2D still of the mean spectrum in the same strip.
import { peakBin } from "../shared/spectrum";

export type FieldView = "idle" | "connecting" | "live" | "closed" | "quota_halted";

const BINS = 64;
const ROWS = 240;
const STRIP_PX = 48;
const ROWS_PER_SECOND = 30;
const GROUND: [number, number, number] = [7 / 255, 8 / 255, 10 / 255];
const ACCENT: [number, number, number] = [61 / 255, 242 / 255, 168 / 255];
const FROZEN: [number, number, number] = [138 / 255, 146 / 255, 156 / 255];
/** Pale grey for a closed session: ink #E7EAEE at about 70 % over the ground. */
const CLOSED: [number, number, number] = [164 / 255, 166 / 255, 170 / 255];
const BASE_LIVE: [number, number, number] = [0.16, 0.36, 0.33];
const BASE_GREY: [number, number, number] = [0.32, 0.34, 0.37];

const VERTEX = `
attribute vec2 aGrid;
attribute float aHeight;
uniform mat4 uProjection;
uniform mat4 uView;
uniform float uLift;
varying float vHeight;
varying float vAge;
void main() {
  float x = (aGrid.x / 63.0 * 2.0 - 1.0) * 1.7;
  float z = -aGrid.y / 239.0 * 3.0;
  vHeight = aHeight;
  vAge = aGrid.y / 239.0;
  gl_Position = uProjection * uView * vec4(x, aHeight * 0.8 + uLift, z, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform vec3 uGround;
uniform vec3 uCrest;
uniform vec3 uBase;
uniform float uLine;
varying float vHeight;
varying float vAge;
void main() {
  vec3 tone = mix(uBase, uCrest, smoothstep(0.25, 0.85, vHeight));
  float fog = pow(1.0 - vAge, 1.6);
  vec3 lit = uLine > 0.5 ? tone : tone * 0.16;
  gl_FragColor = vec4(mix(uGround, lit, fog * (uLine > 0.5 ? 1.0 : 0.9)), 1.0);
}`;

function perspective(fovDegrees: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDegrees * Math.PI) / 360);
  const range = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * range, -1, 0, 0, 2 * far * near * range, 0]);
}

function lookAt(eye: number[], target: number[]): Float32Array {
  const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
  const norm = (v: number[]) => {
    const l = Math.hypot(...v);
    return v.map((x) => x / l);
  };
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const z = norm(sub(eye, target));
  const x = norm(cross([0, 1, 0], z));
  const y = cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
}

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t) as [number, number, number];

interface Gl {
  gl: WebGLRenderingContext;
  heights: WebGLBuffer;
  fillCount: number;
  lineCount: number;
  fill: WebGLBuffer;
  lines: WebGLBuffer;
  u: Record<"projection" | "view" | "lift" | "ground" | "crest" | "base" | "line", WebGLUniformLocation | null>;
}

function setup(canvas: HTMLCanvasElement): Gl | null {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  const grid = new Float32Array(BINS * ROWS * 2);
  for (let r = 0; r < ROWS; r++) for (let b = 0; b < BINS; b++) grid.set([b, r], (r * BINS + b) * 2);
  const gridBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
  const aGrid = gl.getAttribLocation(program, "aGrid");
  gl.enableVertexAttribArray(aGrid);
  gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);
  const heights = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, heights);
  gl.bufferData(gl.ARRAY_BUFFER, BINS * ROWS * 4, gl.DYNAMIC_DRAW);
  const aHeight = gl.getAttribLocation(program, "aHeight");
  gl.enableVertexAttribArray(aHeight);
  gl.vertexAttribPointer(aHeight, 1, gl.FLOAT, false, 0, 0);
  const fillIndex: number[] = [];
  const lineIndex: number[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let b = 0; b < BINS - 1; b++) {
      const v = r * BINS + b;
      if (r < ROWS - 1) fillIndex.push(v, v + 1, v + BINS, v + 1, v + BINS + 1, v + BINS);
      if (r % 2 === 0) lineIndex.push(v, v + 1);
    }
  }
  const fill = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, fill);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(fillIndex), gl.STATIC_DRAW);
  const lines = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lines);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lineIndex), gl.STATIC_DRAW);
  const at = (name: string) => gl.getUniformLocation(program, name);
  return {
    gl,
    heights,
    fill,
    lines,
    fillCount: fillIndex.length,
    lineCount: lineIndex.length,
    u: { projection: at("uProjection"), view: at("uView"), lift: at("uLift"), ground: at("uGround"), crest: at("uCrest"), base: at("uBase"), line: at("uLine") },
  };
}

interface FieldOptions {
  reducedMotion: boolean;
  /** The public hero: one named loop over the bundled demo spectrum. */
  demo?: number[][];
}

/** Bar i's columns, [start, end): ⌊i·W/64⌋ up to ⌊(i+1)·W/64⌋. */
const barColumns = (i: number, width: number): [number, number] => [Math.floor((i * width) / BINS), Math.floor(((i + 1) * width) / BINS)];

/** A bar's lit height: round(value × 48). */
const barPixels = (value: number): number => Math.round(Math.max(0, Math.min(1, value)) * STRIP_PX);

export class SessionField {
  readonly canvas: HTMLCanvasElement;
  readonly webgl: boolean;
  private readonly g: Gl | null;
  private readonly reduced: boolean;
  private readonly history = new Float32Array(BINS * ROWS);
  private front = new Array<number>(BINS).fill(0);
  private readonly bars = new Float32Array(BINS);
  private mean = new Array<number>(BINS).fill(0);
  private view: FieldView = "idle";
  private grey = 0;
  private frame = 0;
  private dirty = true;
  private raf = 0;
  private last = 0;
  private terrainHeld = false;
  private queued: { row: number[]; frame: number; peak: number } | null = null;
  private stepper: ReturnType<typeof setInterval> | null = null;
  private readonly demo: number[][] | null;
  private demoStart = -1;
  private demoOffset = 0;
  /** Hero emphasis by Signal path stage: 1 strip only, 2 rows advance, 3..5 as 2. */
  stage = 5;
  private readonly resize: ResizeObserver;

  constructor(label: string, options: FieldOptions) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "field-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", label);
    this.reduced = options.reducedMotion;
    this.demo = options.demo ?? null;
    this.g = setup(this.canvas);
    this.webgl = this.g !== null;
    this.canvas.dataset.renderer = this.webgl ? "webgl" : "still";
    this.attributes("idle", "idle", 0, 0);
    this.resize = new ResizeObserver(() => {
      this.dirty = true;
      this.draw();
    });
    this.resize.observe(this.canvas);
    if (this.demo) this.startDemo();
    else if (this.reduced) this.stepper = setInterval(() => this.step(), 1000);
    if (!this.reduced && this.webgl) this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  private attributes(view: string, end: string, frame: number, peak: number): void {
    this.canvas.dataset.sessionState = view;
    this.canvas.dataset.endState = end;
    this.canvas.dataset.frame = String(frame);
    this.canvas.dataset.peakBin = String(peak);
  }

  setView(view: FieldView, endState: string): void {
    const halted = view === "quota_halted";
    if (halted && this.reduced) this.grey = 1;
    this.view = view;
    this.canvas.dataset.sessionState = view;
    this.canvas.dataset.endState = endState;
    if (halted || view === "closed") this.queued = null;
    if (halted) {
      // The strip keeps its last frame.
      this.bars.set(this.front);
    }
    this.dirty = true;
    this.draw();
  }

  /** Replaces the history with stored rows (oldest first) and puts the last at the front. */
  load(rows: number[][], frame: number, peak: number, mean: number[]): void {
    this.mean = mean.length === BINS ? mean : this.mean;
    this.history.fill(0);
    const recent = rows.slice(-ROWS);
    recent.forEach((row, i) => this.history.set(row, (recent.length - 1 - i) * BINS));
    this.front = recent[recent.length - 1] ?? new Array<number>(BINS).fill(0);
    this.frame = frame;
    if (this.view === "quota_halted" || this.view === "closed" || this.reduced) this.bars.set(this.front);
    this.terrainHeld = this.reduced && recent.length > 0;
    this.canvas.dataset.frame = String(frame);
    this.canvas.dataset.peakBin = String(peak);
    this.dirty = true;
    this.draw();
  }

  /** The still fallback's fresh mean for an open session, drawn at once with no easing. */
  setMean(mean: number[]): void {
    this.mean = mean;
    this.dirty = true;
    this.draw();
  }

  /** A newest row from the live stream. Under reduced motion it waits for the once-a-second step. */
  push(row: number[], frame: number, peak: number): void {
    if (this.view !== "live" || frame <= this.frame && this.frame !== 0) return;
    if (this.reduced) {
      this.queued = { row, frame, peak };
      return;
    }
    this.advance(row, frame, peak);
  }

  private advance(row: number[], frame: number, peak: number): void {
    if (!(this.reduced && this.terrainHeld)) {
      this.history.copyWithin(BINS, 0, BINS * (ROWS - 1));
      this.history.set(row, 0);
      this.terrainHeld = this.reduced;
    }
    this.front = row;
    this.frame = frame;
    this.canvas.dataset.frame = String(frame);
    this.canvas.dataset.peakBin = String(peak);
    this.dirty = true;
  }

  private step(): void {
    if (!this.queued) return;
    const { row, frame, peak } = this.queued;
    this.queued = null;
    this.advance(row, frame, peak);
    this.bars.set(row);
    this.draw();
  }

  /** The hero opens on the demo's first 240 rows, then replays the recording at 30 rows a second. */
  private startDemo(): void {
    const rows = this.demo!;
    if (rows.length === 0) return;
    this.view = "live";
    this.attributes("live", "live", 0, 0);
    const opening = rows.slice(0, ROWS);
    const front = opening[opening.length - 1];
    this.demoOffset = opening.length - 1;
    this.load(opening, this.demoOffset, peakBin(front), front);
    this.bars.set(front);
  }

  private demoFrame(now: number): void {
    const rows = this.demo!;
    if (this.demoStart < 0) this.demoStart = now;
    const target = this.demoOffset + Math.floor(((now - this.demoStart) / 1000) * ROWS_PER_SECOND);
    let produced = this.frame;
    while (produced < target) {
      produced++;
      const row = rows[produced % rows.length];
      const peak = peakBin(row);
      if (this.stage >= 2) this.advance(row, produced, peak);
      else {
        this.front = row;
        this.frame = produced;
        this.canvas.dataset.frame = String(produced);
        this.canvas.dataset.peakBin = String(peak);
      }
    }
  }

  private tick(now: number): void {
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    if (this.demo) this.demoFrame(now);
    if (this.view === "live" || this.view === "connecting") {
      const target = this.view === "connecting" ? new Array<number>(BINS).fill(0) : this.front;
      for (let i = 0; i < BINS; i++) {
        const tau = target[i] > this.bars[i] ? 15 : 80;
        this.bars[i] += (target[i] - this.bars[i]) * (1 - Math.exp(-dt / tau));
      }
      this.dirty = true;
    }
    if (this.view === "quota_halted" && this.grey < 1) {
      this.grey = Math.min(1, this.grey + dt / 250);
      this.dirty = true;
    }
    this.draw();
    this.raf = requestAnimationFrame((t) => this.tick(t));
  }

  /** The drawing buffer is exactly the displayed size: one buffer pixel per layout pixel. */
  private size(): { width: number; height: number } {
    const width = Math.max(1, Math.round(this.canvas.clientWidth));
    const height = Math.max(1, Math.round(this.canvas.clientHeight));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    return { width, height };
  }

  /** The accent only while the signal is live; pale grey once closed; fading to dim grey on a halt. */
  private palette(): { bar: [number, number, number]; base: [number, number, number] } {
    if (this.view === "closed") return { bar: CLOSED, base: BASE_GREY };
    return { bar: mix(ACCENT, FROZEN, this.grey), base: mix(BASE_LIVE, BASE_GREY, this.grey) };
  }

  draw(): void {
    if (!this.dirty || !this.canvas.isConnected) return;
    this.dirty = false;
    const { width, height } = this.size();
    const strip = STRIP_PX;
    const { bar: barColour, base } = this.palette();
    if (!this.g) {
      this.still(width, height, strip, barColour);
      return;
    }
    const { gl, u } = this.g;
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    gl.clearColor(...GROUND, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const terrainHeight = Math.max(1, height - strip);
    gl.viewport(0, strip, width, terrainHeight);
    gl.enable(gl.DEPTH_TEST);
    gl.uniformMatrix4fv(u.projection, false, perspective(20, width / terrainHeight, 0.1, 20));
    gl.uniformMatrix4fv(u.view, false, lookAt([0, 1.45, 2.35], [0, 0.22, -1.0]));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.g.heights);
    const flat = this.view === "connecting" || this.view === "idle";
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, flat ? new Float32Array(BINS * ROWS) : this.history);
    gl.uniform3f(u.ground, ...GROUND);
    gl.uniform3f(u.crest, ...barColour);
    gl.uniform3f(u.base, ...base);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.uniform1f(u.line, 0);
    gl.uniform1f(u.lift, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.g.fill);
    gl.drawElements(gl.TRIANGLES, this.g.fillCount, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1f(u.line, 1);
    gl.uniform1f(u.lift, 0.002);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.g.lines);
    gl.drawElements(gl.LINES, this.g.lineCount, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.DEPTH_TEST);
    // The readback strip: bar i fills columns ⌊i·W/64⌋ to ⌊(i+1)·W/64⌋−1, cleared through a scissor box.
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(...barColour, 1);
    for (let i = 0; i < BINS; i++) {
      const [x0, x1] = barColumns(i, width);
      const barHeight = barPixels(flat ? 0 : this.bars[i]);
      if (barHeight <= 0) continue;
      gl.scissor(x0, 0, x1 - x0, barHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  /** The still fallback: the session's mean spectrum in the same strip, and its outline above. */
  private still(width: number, height: number, strip: number, colour: [number, number, number]): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const rgb = (c: number[], alpha = 1) => `rgba(${c.map((v) => Math.round(v * 255)).join(",")},${alpha})`;
    ctx.fillStyle = rgb(GROUND);
    ctx.fillRect(0, 0, width, height);
    const values = this.mean;
    const top = height - strip;
    // The outline stays above the strip, which holds only the bars and the ground.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, top);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(0, top);
    values.forEach((v, i) => ctx.lineTo(((i + 0.5) * width) / BINS, top - v * top * 0.8));
    ctx.lineTo(width, top);
    ctx.closePath();
    ctx.fillStyle = rgb(colour, 0.12);
    ctx.fill();
    ctx.strokeStyle = rgb(colour, 0.7);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = rgb(colour);
    values.forEach((v, i) => {
      const [x0, x1] = barColumns(i, width);
      const barHeight = barPixels(v);
      ctx.fillRect(x0, height - barHeight, x1 - x0, barHeight);
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    if (this.stepper) clearInterval(this.stepper);
    this.resize.disconnect();
    this.canvas.getContext("webgl")?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
