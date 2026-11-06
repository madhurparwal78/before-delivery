// The loaf scene: a small WebGL renderer driven by scroll, with the published
// formulas, screen spans, fallback diagram state and reduced-motion behaviour.
import type { Bar } from "../state/api.js";

export interface SceneBatch {
  code: string;
  scentTint: string;
  bars: Bar[];
  barsTotal: number;
}

export interface SceneState {
  dataState: "ready" | "lost" | "fallback";
  progress: string;
  wire: string;
  cutStep: number;
  yaw: number;
  loafBand: string;
  barSpans: string;
  animating: boolean;
  motion: "full" | "reduced";
}

const TINTS: Record<string, { base: [number, number, number]; swirlA: [number, number, number]; swirlB: [number, number, number]; swirlC: [number, number, number] }> = {
  lilac: { base: [0.60, 0.54, 0.70], swirlA: [0.76, 0.70, 0.84], swirlB: [0.56, 0.48, 0.66], swirlC: [0.44, 0.37, 0.53] },
  ash: { base: [0.50, 0.45, 0.41], swirlA: [0.66, 0.60, 0.54], swirlB: [0.43, 0.39, 0.35], swirlC: [0.32, 0.29, 0.26] },
  mint: { base: [0.48, 0.62, 0.51], swirlA: [0.64, 0.77, 0.64], swirlB: [0.41, 0.54, 0.44], swirlC: [0.31, 0.42, 0.35] },
  rose: { base: [0.73, 0.51, 0.54], swirlA: [0.85, 0.66, 0.66], swirlB: [0.63, 0.41, 0.45], swirlC: [0.51, 0.32, 0.37] }
};

const GROUND: [number, number, number] = [0.945, 0.925, 0.871];
const KRAFT: [number, number, number] = [0.60, 0.46, 0.30];
const TAG_COLOR: [number, number, number] = [0.86, 0.80, 0.68];
const WIRE_COLOR: [number, number, number] = [0.71, 0.29, 0.18];

const DURATION_TIP = 600;
const DURATION_WRAP = 600;
const DURATION_WIRE = 320;
const DURATION_YAW = 320;
const ELEVATION = 0.34;

function seedFromString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

function ease(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** The published scroll formulas, from the integer pixel offset. */
export function scrollMetrics(scrollY: number, n: number): { s: number; p: string; w: number; c: number } {
  const s = Math.max(0, Math.min(2400, Math.floor(scrollY)));
  const p = Math.floor((s * 1000 + 1200) / 2400) / 1000;
  const wHundredths = Math.floor((s * n) / 24);
  const c = Math.min(n, Math.floor((s * n) / 2400));
  return { s, p: p.toFixed(3), w: wHundredths / 100, c };
}

export function deepLinkScroll(k: number, n: number): number {
  if (k < 1 || k > n) return 0;
  return Math.ceil((2400 * k) / n);
}

interface Motion {
  start: number;
  from: number;
  to: number;
  duration: number;
}

const VERTEX = `attribute vec3 aPosition; attribute vec3 aColor; varying vec3 vColor; varying vec3 vLocal;
void main() { gl_Position = vec4(aPosition.xy, 0.0, 1.0); vColor = aColor; vLocal = aPosition; }`;
const FRAGMENT_SWIRL = `precision mediump float; varying vec3 vLocal;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSeed;
void main() {
  float x = vLocal.x * 1.2 + uSeed * 10.0;
  float y = vLocal.y * 1.2 + uSeed * 5.0;
  float a = sin(x * 2.0 + sin(y * 2.6 + uSeed * 6.28) + uSeed * 12.0);
  float b = sin(x * 3.3 + uSeed * 4.0 + sin(y * 1.8 + uSeed * 2.0));
  float v = a * 0.6 + b * 0.4;
  vec3 tone = v > 0.35 ? uA : (v > -0.2 ? uB : uC);
  gl_FragColor = vec4(tone, 1.0);
}`;

export class LoafScene {
  private gl: WebGLRenderingContext | null = null;
  private solidProgram: WebGLProgram | null = null;
  private swirlProgram: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private colorBuffer: WebGLBuffer | null = null;
  private swirlBuffer: WebGLBuffer | null = null;
  private swirlColorBuffer: WebGLBuffer | null = null;
  private contextLost = false;
  private webglSupported = true;
  private batch: SceneBatch | null = null;
  private n = 1;
  private tipMotions = new Map<number, Motion>();
  private wrapMotions = new Map<number, Motion>();
  private wireMotion: Motion | null = null;
  private yawCurrent = 0;
  private yawMotion: Motion | null = null;
  private reducedMotion = false;
  private lastCut = 0;
  private animating = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private figure: HTMLElement,
    private captionEl: HTMLElement,
    private formatCaption: (cut: number, n: number) => string,
    private onState: (state: SceneState) => void
  ) {
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (event) => {
      this.applyReducedMotion(event.matches);
    });
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.publish();
    });
    canvas.addEventListener("webglcontextrestored", () => {
      this.contextLost = false;
      this.initGl();
      this.publish();
    });
    this.initGl();
    if (!this.gl) {
      this.webglSupported = false;
    }
    const tick = () => {
      this.step();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    this.canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || this.reducedMotion) return;
      const rect = this.canvas.getBoundingClientRect();
      const yaw = Math.round(((event.clientX - rect.left) / rect.width - 0.5) * 24);
      this.yawCurrent = Math.max(-12, Math.min(12, yaw));
      this.yawMotion = null;
      this.publish();
    });
    this.canvas.addEventListener("pointerleave", () => {
      if (this.reducedMotion) return;
      this.yawMotion = { start: performance.now(), from: this.yawCurrent, to: 0, duration: DURATION_YAW };
    });
  }

  private applyReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) {
      this.tipMotions.clear();
      this.wrapMotions.clear();
      this.wireMotion = null;
      this.yawMotion = null;
      this.yawCurrent = 0;
      this.animating = false;
    }
    this.publish();
  }

  private initGl(): void {
    const gl = this.canvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) {
      this.gl = null;
      return;
    }
    this.gl = gl;
    this.solidProgram = this.buildProgram(gl, VERTEX,
      `precision mediump float; varying vec3 vColor; void main() { gl_FragColor = vec4(vColor, 1.0); }`);
    this.swirlProgram = this.buildProgram(gl, VERTEX, FRAGMENT_SWIRL);
    this.buffer = gl.createBuffer();
    this.colorBuffer = gl.createBuffer();
    this.swirlBuffer = gl.createBuffer();
    this.swirlColorBuffer = gl.createBuffer();
    gl.disable(gl.DEPTH_TEST);
  }

  private buildProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram | null {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, vertexSource);
    const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      return null;
    }
    return program;
  }

  setBatch(batch: SceneBatch): void {
    const previousBars = this.batch?.bars ?? [];
    const previousCode = this.batch?.code;
    this.batch = batch;
    this.n = Math.max(1, batch.barsTotal);
    if (previousCode !== batch.code) {
      this.wireMotion = this.reducedMotion
        ? null
        : { start: performance.now(), from: 0, to: 1, duration: DURATION_WIRE };
      for (const [index, bar] of batch.bars.entries()) {
        const previousStatus = previousBars[index]?.status;
        if (previousStatus !== bar.status) {
          if (this.reducedMotion) continue;
          this.wrapMotions.set(index, { start: performance.now(), from: 0, to: 1, duration: DURATION_WRAP });
        }
      }
    }
    this.updateCutMotions(scrollMetrics(window.scrollY, this.n).c);
    this.publish();
  }

  setScroll(_scrollY: number): void {
    const metrics = scrollMetrics(window.scrollY, this.n);
    this.updateCutMotions(metrics.c);
    this.publish();
  }

  private updateCutMotions(cut: number): void {
    if (cut === this.lastCut) return;
    const now = performance.now();
    const duration = DURATION_TIP;
    if (!this.reducedMotion) {
      if (cut > this.lastCut) {
        for (let k = this.lastCut; k < cut; k++) {
          this.tipMotions.set(k, { start: now, from: 0, to: 1, duration });
        }
      } else {
        for (let k = cut; k < this.lastCut; k++) {
          this.tipMotions.set(k, { start: now, from: 1, to: 0, duration });
        }
      }
    }
    this.lastCut = cut;
  }

  private step(): void {
    const now = performance.now();
    let animating = false;
    if (this.yawMotion) {
      const t = Math.min(1, (now - this.yawMotion.start) / this.yawMotion.duration);
      this.yawCurrent = this.yawMotion.from + (this.yawMotion.to - this.yawMotion.from) * ease(t);
      if (t >= 1) {
        this.yawMotion = null;
        this.yawCurrent = 0;
      } else {
        animating = true;
      }
    }
    for (const [key, motion] of this.tipMotions) {
      const t = Math.min(1, (now - motion.start) / motion.duration);
      if (t >= 1) {
        this.tipMotions.delete(key);
      } else {
        animating = true;
      }
    }
    for (const [key, motion] of this.wrapMotions) {
      const t = Math.min(1, (now - motion.start) / motion.duration);
      if (t >= 1) {
        this.wrapMotions.delete(key);
      } else {
        animating = true;
      }
    }
    if (this.wireMotion) {
      const t = Math.min(1, (now - this.wireMotion.start) / this.wireMotion.duration);
      if (t >= 1) {
        this.wireMotion = null;
      } else {
        animating = true;
      }
    }
    if (animating !== this.animating) {
      this.animating = animating;
    }
    if (this.animating) {
      this.publish();
    }
  }

  private tipValue(k: number, cut: number, now: number): number {
    const target = cut < this.n && k < cut ? 1 : 0;
    const motion = this.tipMotions.get(k);
    if (this.reducedMotion || !motion) return target;
    const t = Math.min(1, (now - motion.start) / motion.duration);
    if (t >= 1) return target;
    return motion.from + (target - motion.from) * ease(t);
  }

  private wrapValue(k: number, now: number): number {
    const target = this.batch?.bars[k]?.status === "held" ? 1 : 0;
    const motion = this.wrapMotions.get(k);
    if (this.reducedMotion || !motion) return target;
    const t = Math.min(1, (now - motion.start) / motion.duration);
    if (t >= 1) return target;
    return 0 + target * ease(t);
  }

  /** Publish the data attributes and draw. Called on any cause. */
  publish(): void {
    const state = this.currentState();
    const figure = this.figure;
    figure.dataset.state = state.dataState;
    figure.dataset.progress = state.progress;
    figure.dataset.wire = state.wire;
    figure.dataset.cutStep = String(state.cutStep);
    figure.dataset.yaw = String(state.yaw);
    figure.dataset.loafBand = state.loafBand;
    figure.dataset.barSpans = state.barSpans;
    figure.dataset.motion = state.motion;
    figure.dataset.animating = state.animating ? "true" : "false";
    if (this.batch) {
      figure.dataset.batch = this.batch.code;
      figure.dataset.tint = this.batch.scentTint;
      figure.dataset.swirlSeed = this.batch.code;
      figure.dataset.barsTotal = String(this.n);
      figure.dataset.bars = this.batch.bars
        .map((bar) => (bar.status === "available" ? "A" : bar.status === "held" ? "H" : "S"))
        .join("");
    }
    this.captionEl.textContent = this.formatCaption(state.cutStep, this.n);
    this.onState(state);
    if (state.dataState === "ready" && this.gl && this.batch) {
      this.draw(state);
    }
  }

  private currentState(): SceneState {
    const metrics = scrollMetrics(window.scrollY, this.n);
    const layout = this.layout();
    return {
      dataState: !this.webglSupported ? "fallback" : this.contextLost || !this.gl ? "lost" : "ready",
      progress: metrics.p,
      wire: metrics.w.toFixed(2),
      cutStep: metrics.c,
      yaw: Math.round(this.yawCurrent),
      loafBand: `${Math.round(layout.bandTop)}-${Math.round(layout.bandBottom)}`,
      barSpans: layout.spans
        .map((span) => `${Math.round(span[0])}-${Math.round(span[1])}`)
        .join(" "),
      animating: this.animating,
      motion: this.reducedMotion ? "reduced" : "full"
    };
  }

  /** Screen-space geometry, shared by drawing and the published spans. */
  private layout(): { bandTop: number; bandBottom: number; spans: [number, number][]; barW: number; height: number; depth: number; width: number } {
    const cssWidth = this.canvas.clientWidth || 600;
    const cssHeight = this.canvas.clientHeight || 380;
    const n = this.n;
    const barW = Math.min(58, (cssWidth * 0.74) / n);
    const width = barW * n;
    const height = Math.min(cssHeight * 0.4, 170);
    const depth = barW * 0.62;
    const yaw = (this.yawCurrent * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const cx = cssWidth / 2;
    const cy = cssHeight * 0.44;
    const project = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cos + z * sin;
      const rz = -x * sin + z * cos;
      return [cx + rx, cy - y + rz * Math.sin(ELEVATION) * 0.85];
    };
    const domeApex = project(0, height * 1.09, depth / 2);
    const base = project(0, 0, depth / 2);
    const spans: [number, number][] = [];
    const midY = height / 2;
    for (let k = 0; k < n; k++) {
      const left = -width / 2 + k * barW;
      const right = left + barW;
      const p1 = project(left, midY, depth / 2);
      const p2 = project(right, midY, depth / 2);
      const minX = Math.max(0, Math.min(p1[0], p2[0]));
      const maxX = Math.min(cssWidth, Math.max(p1[0], p2[0]));
      spans.push([minX, Math.max(minX + 8, maxX)]);
    }
    return {
      bandTop: domeApex[1],
      bandBottom: base[1],
      spans,
      barW,
      height,
      depth,
      width
    };
  }

  private draw(state: SceneState): void {
    const gl = this.gl;
    const batch = this.batch;
    if (!gl || !batch || !this.solidProgram || !this.swirlProgram) return;
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = this.canvas.clientWidth || 600;
    const cssHeight = this.canvas.clientHeight || 380;
    if (this.canvas.width !== Math.round(cssWidth * dpr)) this.canvas.width = Math.round(cssWidth * dpr);
    if (this.canvas.height !== Math.round(cssHeight * dpr)) this.canvas.height = Math.round(cssHeight * dpr);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(GROUND[0], GROUND[1], GROUND[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const tint = TINTS[batch.scentTint] ?? TINTS.lilac;
    const seed = seedFromString(batch.code);
    const now = performance.now();
    const layout = this.layout();
    const n = this.n;
    const cut = state.cutStep;
    const yaw = (this.yawCurrent * Math.PI) / 180;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const cx = cssWidth / 2;
    const cy = cssHeight * 0.44;
    const project = (x: number, y: number, z: number): [number, number] => {
      const rx = x * cos + z * sin;
      const rz = -x * sin + z * cos;
      return [cx + rx, cy - y + rz * Math.sin(ELEVATION) * 0.85];
    };
    const toClip = (screen: [number, number]): [number, number] => [
      (screen[0] / cssWidth) * 2 - 1,
      1 - (screen[1] / cssHeight) * 2
    ];

    const solid: number[] = [];
    const solidColors: number[] = [];
    const swirl: number[] = [];
    const quad = (
      target: number[],
      corners: [number, number, number][],
      color?: [number, number, number]
    ): void => {
      const projected = corners.map((corner) => toClip(project(corner[0], corner[1], corner[2])));
      for (const index of [0, 1, 2, 0, 2, 3]) {
        target.push(projected[index][0], projected[index][1], 0);
        if (color) {
          solidColors.push(color[0], color[1], color[2]);
        }
      }
    };

    const barW = layout.barW;
    const width = layout.width;
    const height = layout.height;
    const depth = layout.depth;

    for (let k = 0; k < n; k++) {
      const status = batch.bars[k]?.status ?? "available";
      if (status === "sold") continue;
      const tip = this.tipValue(k, cut, now);
      const angle = tip * (Math.PI / 2);
      const left = -width / 2 + k * barW;
      const right = left + barW;
      const pivotZ = depth / 2;
      const rotate = (x: number, y: number, z: number): [number, number, number] => {
        const zRel = z - pivotZ;
        const yRel = y;
        const zNew = zRel * Math.cos(angle) + yRel * Math.sin(angle);
        const yNew = -zRel * Math.sin(angle) + yRel * Math.cos(angle);
        return [x, yNew, pivotZ + zNew];
      };
      const shade = (color: [number, number, number], factor: number): [number, number, number] => [
        Math.min(1, color[0] * factor), Math.min(1, color[1] * factor), Math.min(1, color[2] * factor)
      ];
      const crust = tint.base;
      const faces: { corners: [number, number, number][]; color: [number, number, number] }[] = [
        { corners: [rotate(right, 0, -depth / 2), rotate(left, 0, -depth / 2), rotate(left, height, -depth / 2), rotate(right, height, -depth / 2)], color: shade(crust, 0.78) },
        { corners: [rotate(left, 0, -depth / 2), rotate(left, 0, depth / 2), rotate(left, height, depth / 2), rotate(left, height, -depth / 2)], color: shade(crust, 0.86) },
        { corners: [rotate(right, 0, depth / 2), rotate(right, 0, -depth / 2), rotate(right, height, -depth / 2), rotate(right, height, depth / 2)], color: shade(crust, 0.86) },
        { corners: [rotate(left, height, -depth / 2), rotate(right, height, -depth / 2), rotate(right, height, depth / 2), rotate(left, height, depth / 2)], color: shade(crust, 1.07) }
      ];
      // A low dome: a slightly inset, raised cap over the top face.
      const domeRise = height * 0.09;
      faces.push({
        corners: [
          rotate(left + barW * 0.06, height, -depth / 2 + depth * 0.06),
          rotate(right - barW * 0.06, height, -depth / 2 + depth * 0.06),
          rotate(right - barW * 0.06, height, depth / 2 - depth * 0.06),
          rotate(left + barW * 0.06, height, depth / 2 - depth * 0.06)
        ],
        color: shade(crust, 1.1)
      });
      void domeRise;
      for (const face of faces) {
        quad(solid, face.corners, face.color);
      }
      // The front face is the cut face and shows the swirl.
      quad(swirl, [
        rotate(left, 0, depth / 2),
        rotate(right, 0, depth / 2),
        rotate(right, height, depth / 2),
        rotate(left, height, depth / 2)
      ]);
      const wrap = this.wrapValue(k, now);
      if (wrap > 0 || status === "held") {
        const wrapFrontZ = depth / 2 + 1.2;
        const wrapTop = height * 0.96;
        const fold = barW * 0.14;
        const wrapQuad = [
          rotate(left - fold, 0, wrapFrontZ),
          rotate(right + fold, 0, wrapFrontZ),
          rotate(right + fold, wrapTop, wrapFrontZ),
          rotate(left - fold, wrapTop, wrapFrontZ)
        ];
        quad(solid, wrapQuad, KRAFT);
        quad(solid, [
          rotate(left + barW * 0.12, 0, wrapFrontZ + 1.2),
          rotate(left + barW * 0.6, 0, wrapFrontZ + 1.2),
          rotate(left + barW * 0.6, height * 0.16, wrapFrontZ + 1.2),
          rotate(left + barW * 0.12, height * 0.16, wrapFrontZ + 1.2)
        ], TAG_COLOR);
      }
    }

    // The wire: a taut rust line across the loaf's depth at the cut position.
    const wireBars = parseFloat(state.wire);
    const wireX = cut >= n ? width / 2 : -width / 2 + Math.min(wireBars, n) * barW;
    const wireY = height * 0.5;
    const thickness = Math.max(1.4, barW * 0.045);
    const front = project(wireX, wireY, depth / 2 + 0.5);
    const back = project(wireX, wireY, -depth / 2 - 0.5);
    const clipFront = toClip(front);
    const clipBack = toClip(back);
    const dx = thickness / cssWidth;
    const dy = thickness / cssHeight;
    const wireClipQuad: [number, number][] = [
      [clipFront[0] - dx, clipFront[1] - dy],
      [clipFront[0] + dx, clipFront[1] + dy],
      [clipBack[0] + dx, clipBack[1] + dy],
      [clipBack[0] - dx, clipBack[1] - dy]
    ];
    for (const index of [0, 1, 2, 0, 2, 3]) {
      solid.push(wireClipQuad[index][0], wireClipQuad[index][1], 0);
      solidColors.push(WIRE_COLOR[0], WIRE_COLOR[1], WIRE_COLOR[2]);
    }
    // Small handles at each end.
    for (const end of [front, back]) {
      const clip = toClip(end);
      const sizeX = Math.max(4, barW * 0.14) / cssWidth * 2;
      const sizeY = Math.max(4, barW * 0.14) / cssHeight * 2;
      const handleQuad: [number, number][] = [
        [clip[0] - sizeX, clip[1] - sizeY],
        [clip[0] + sizeX, clip[1] - sizeY],
        [clip[0] + sizeX, clip[1] + sizeY],
        [clip[0] - sizeX, clip[1] + sizeY]
      ];
      for (const index of [0, 1, 2, 0, 2, 3]) {
        solid.push(handleQuad[index][0], handleQuad[index][1], 0);
        solidColors.push(WIRE_COLOR[0], WIRE_COLOR[1], WIRE_COLOR[2]);
      }
    }

    const drawArrays = (program: WebGLProgram, target: "solid" | "swirl", count: number): void => {
      if (count === 0) return;
      const data = target === "solid" ? solid : swirl;
      const colorData = target === "solid" ? solidColors : solidColors.slice(-1).map(() => 0);
      gl.useProgram(program);
      const positionLocation = gl.getAttribLocation(program, "aPosition");
      gl.bindBuffer(gl.ARRAY_BUFFER, target === "solid" ? this.buffer : this.swirlBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 0, 0);
      const colorLocation = gl.getAttribLocation(program, "aColor");
      gl.bindBuffer(gl.ARRAY_BUFFER, target === "solid" ? this.colorBuffer : this.swirlColorBuffer);
      if (target === "solid") {
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colorData), gl.DYNAMIC_DRAW);
      } else {
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.length), gl.DYNAMIC_DRAW);
      }
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(colorLocation, 3, gl.FLOAT, false, 0, 0);
      if (target === "swirl") {
        const aLocation = gl.getUniformLocation(program, "uA");
        const bLocation = gl.getUniformLocation(program, "uB");
        const cLocation = gl.getUniformLocation(program, "uC");
        const seedLocation = gl.getUniformLocation(program, "uSeed");
        gl.uniform3f(aLocation, tint.swirlA[0], tint.swirlA[1], tint.swirlA[2]);
        gl.uniform3f(bLocation, tint.swirlB[0], tint.swirlB[1], tint.swirlB[2]);
        gl.uniform3f(cLocation, tint.swirlC[0], tint.swirlC[1], tint.swirlC[2]);
        gl.uniform1f(seedLocation, seed);
      }
      gl.drawArrays(gl.TRIANGLES, 0, count / 3);
    };
    drawArrays(this.solidProgram, "solid", solid.length);
    drawArrays(this.swirlProgram, "swirl", swirl.length);
  }
}
