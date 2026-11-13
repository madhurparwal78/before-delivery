/** The venue grid stage: a fixed, never-unmounted WebGL canvas or its still frame. */

export type SceneName = 'landing' | 'brief' | 'configurator' | 'working';
export type MotionMode = 'animated' | 'still' | 'fallback';

export interface StageState {
  scene: SceneName;
  motion: MotionMode;
  keyframe: number | null;
  roomWidth: string;
  roomDepth: string;
  silhouette: 'none' | 'camera-reactive-wall' | 'portrait-kiosk' | 'projection-room';
  dust: number;
}

export interface StageInputs {
  roomWidthM?: number;
  roomDepthM?: number;
  silhouette?: StageState['silhouette'];
  dust?: number;
}

const vertexSrc = `
attribute vec3 aPos;
attribute float aKind;
uniform mat4 uMvp;
uniform float uOpacity;
varying float vKind;
varying float vFade;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  vKind = aKind;
  vFade = uOpacity;
}`;

const fragmentSrc = `
precision mediump float;
varying float vKind;
varying float vFade;
uniform float uDim;
uniform float uTime;
void main() {
  float alpha = vFade;
  vec3 grid = vec3(0.85, 0.92, 1.0);
  vec3 plus = vec3(0.7, 0.85, 1.0);
  vec3 dust = vec3(0.75, 0.85, 1.0);
  vec3 blue = vec3(0.15, 0.45, 1.0);
  vec3 col = grid;
  if (vKind > 0.5 && vKind < 1.5) col = plus;
  else if (vKind > 1.5 && vKind < 2.5) col = dust;
  else if (vKind > 2.5 && vKind < 3.5) col = blue;
  gl_FragColor = vec4(col, alpha * (1.0 - uDim * 0.2));
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('compile');
  return shader;
}

interface GridPoint {
  x: number;
  y: number;
  kind: number;
}

/** Builds the bowed perspective plane: grid lines, plus markers, dust motes. */
function buildGrid(roomWidth: number, roomDepth: number, dustCount: number): { points: GridPoint[]; lines: Array<[GridPoint, GridPoint]> } {
  const points: GridPoint[] = [];
  const lines: Array<[GridPoint, GridPoint]> = [];
  const w = Math.max(roomWidth, 8);
  const d = Math.max(roomDepth, 8);
  const cell = 1;
  const nx = Math.ceil(w / cell) + 1;
  const nz = Math.ceil(d / cell) + 1;
  // Grid lines along x at each z, and along z at each x.
  for (let i = 0; i < nx; i++) {
    const x = (i / (nx - 1)) * w - w / 2;
    const line: [GridPoint, GridPoint] = [
      { x, y: 0, kind: 0 },
      { x, y: d, kind: 0 },
    ];
    lines.push(line);
  }
  for (let j = 0; j < nz; j++) {
    const z = (j / (nz - 1)) * d;
    lines.push([
      { x: -w / 2, y: z, kind: 0 },
      { x: w / 2, y: z, kind: 0 },
    ]);
  }
  // Plus markers at every second crossing.
  for (let i = 0; i < nx; i += 2) {
    for (let j = 0; j < nz; j += 2) {
      const x = (i / (nx - 1)) * w - w / 2;
      const z = (j / (nz - 1)) * d;
      points.push({ x: x - 0.08, y: z, kind: 1 });
      points.push({ x: x + 0.08, y: z, kind: 1 });
      points.push({ x, y: z - 0.08, kind: 1 });
      points.push({ x, y: z + 0.08, kind: 1 });
    }
  }
  // Dust motes float above the plane.
  for (let k = 0; k < dustCount; k++) {
    const seed = k * 12.9898;
    const rx = Math.sin(seed) * 43758.5453;
    const rz = Math.sin(seed * 2.0) * 12345.6789;
    points.push({ x: (rx - Math.floor(rx)) * w - w / 2, y: (rz - Math.floor(rz)) * d, kind: 2 });
  }
  // The installation silhouette: a wall, kiosk or tower outline standing on the grid.
  return { points, lines };
}

function silhouetteLines(kind: StageState['silhouette']): Array<[GridPoint, GridPoint]> {
  const lines: Array<[GridPoint, GridPoint]> = [];
  const mk = (x1: number, y1: number, x2: number, y2: number): void => {
    lines.push([
      { x: x1, y: y1, kind: 3 },
      { x: x2, y: y2, kind: 3 },
    ]);
  };
  if (kind === 'camera-reactive-wall') {
    for (const z of [0.4, 0.5]) {
      mk(-2, z, 2, z);
    }
    mk(-2, 0.4, -2, 0.5);
    mk(2, 0.4, 2, 0.5);
  } else if (kind === 'portrait-kiosk') {
    mk(-0.6, 0, -0.6, 0.9);
    mk(0.6, 0, 0.6, 0.9);
    mk(-0.6, 0.9, 0.6, 0.9);
  } else if (kind === 'projection-room') {
    mk(-0.5, 0, -0.5, 1.4);
    mk(0.5, 0, 0.5, 1.4);
    mk(-0.5, 1.4, 0.5, 1.4);
  }
  return lines;
}

export class VenueStage {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private posBuf: WebGLBuffer | null = null;
  private kindBuf: WebGLBuffer | null = null;
  private pointCount = 0;
  private lineCount = 0;
  private mvp: Float32Array = new Float32Array(16);
  private startAt = 0;
  private lastInput = 0;
  private fadeStart = 0;
  private rafId: number | null = null;
  private pointerTilt = { x: 0, y: 0 };
  private current: StageState;
  private scrollProgress = 0;
  private dimmed = false;
  private slow = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.current = {
      scene: 'landing',
      motion: reduced ? 'still' : 'animated',
      keyframe: 0,
      roomWidth: '',
      roomDepth: '',
      silhouette: 'none',
      dust: 60,
    };
    try {
      const gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
      if (gl) {
        this.gl = gl;
        const vs = compile(gl, gl.VERTEX_SHADER, vertexSrc);
        const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
        const program = gl.createProgram();
        if (program) {
          gl.attachShader(program, vs);
          gl.attachShader(program, fs);
          gl.linkProgram(program);
          if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
            this.program = program;
            this.posBuf = gl.createBuffer();
            this.kindBuf = gl.createBuffer();
          }
        }
      }
    } catch {
      this.gl = null;
    }
    if (!this.gl) this.current.motion = 'fallback';
    this.startAt = performance.now();
    this.lastInput = performance.now();
    this.fadeStart = performance.now();
    this.rebuildGeometry();
    this.syncAttributes();
    this.loop();
    window.addEventListener('resize', () => {
      this.resize();
    });
    window.addEventListener('scroll', () => {
      this.lastInput = performance.now();
    });
    window.addEventListener('pointermove', (e) => {
      this.pointerTilt = {
        x: (e.clientX / window.innerWidth - 0.5) * 4,
        y: (e.clientY / window.innerHeight - 0.5) * -4,
      };
      this.lastInput = performance.now();
    });
    this.resize();
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    this.canvas.width = Math.floor(window.innerWidth * dpr);
    this.canvas.height = Math.floor(window.innerHeight * dpr);
    this.canvas.style.width = `${window.innerWidth}px`;
    this.canvas.style.height = `${window.innerHeight}px`;
  }

  private rebuildGeometry(): void {
    const gl = this.gl;
    if (!gl || !this.posBuf) return;
    const { points, lines } = buildGrid(Number(this.current.roomWidth) || 12, Number(this.current.roomDepth) || 9, this.current.dust);
    const sil = silhouetteLines(this.current.silhouette);
    const allLines = [...lines, ...sil];
    const positions: number[] = [];
    const kinds: number[] = [];
    // Line segments use degenerate triangles; we draw them as LINES for simplicity.
    for (const [a, b] of allLines) {
      positions.push(a.x, 0, a.y, b.x, 0, b.y);
      kinds.push(a.kind, b.kind);
    }
    this.lineCount = allLines.length * 2;
    // Points rendered as very short lines.
    for (const p of points) {
      positions.push(p.x, 0.05, p.y, p.x + 0.001, 0.05, p.y);
      kinds.push(p.kind, p.kind);
    }
    this.pointCount = points.length * 2;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    if (this.kindBuf) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.kindBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(kinds), gl.STATIC_DRAW);
    }
  }

  private syncAttributes(): void {
    this.canvas.setAttribute('data-scene', this.current.scene);
    this.canvas.setAttribute('data-motion', this.current.motion);
    this.canvas.setAttribute('data-room-width', this.current.roomWidth);
    this.canvas.setAttribute('data-room-depth', this.current.roomDepth);
    this.canvas.setAttribute('data-silhouette', this.current.silhouette);
    this.canvas.setAttribute('data-dust', String(this.current.dust));
    if (this.current.keyframe !== null) this.canvas.setAttribute('data-keyframe', String(this.current.keyframe));
    else this.canvas.removeAttribute('data-keyframe');
  }

  setScene(scene: SceneName): void {
    if (this.current.scene === scene) return;
    this.current.scene = scene;
    this.dimmed = scene === 'working' || scene === 'configurator';
    this.slow = scene === 'working';
    this.current.keyframe = scene === 'landing' ? 0 : null;
    this.syncAttributes();
    this.lastInput = performance.now();
    this.render();
  }

  setRoom(widthM: number | undefined, depthM: number | undefined, silhouette?: StageState['silhouette'], dust?: number): void {
    if (widthM !== undefined) this.current.roomWidth = String(widthM);
    if (depthM !== undefined) this.current.roomDepth = String(depthM);
    if (silhouette) this.current.silhouette = silhouette;
    if (dust !== undefined) this.current.dust = dust;
    this.syncAttributes();
    this.rebuildGeometry();
    this.lastInput = performance.now();
    this.render();
  }

  setKeyframe(k: number): void {
    if (this.current.scene !== 'landing') return;
    this.current.keyframe = k;
    this.scrollProgress = k;
    this.syncAttributes();
    this.lastInput = performance.now();
    this.render();
  }

  private mvpFor(time: number): void {
    // Perspective camera: bowed, slightly tilted plane.
    const gl = this.gl;
    if (!gl) return;
    const near = 0.1;
    const far = 100;
    const fov = (50 * Math.PI) / 180;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const f = 1 / Math.tan(fov / 2);
    const p = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
    // Camera position moves with keyframe or idle drift.
    let eyeY = 3.2;
    let eyeZ = 9;
    let eyeX = 0;
    const t = this.current.motion === 'animated' ? time : 0;
    if (this.current.scene === 'landing') {
      const k = this.scrollProgress;
      // Five keyframes: wide, face-on, orbiting left, close, back out.
      if (k < 1) {
        eyeX = 0; eyeY = 3.2 - k * 0.4; eyeZ = 9 - k * 1.5;
      } else if (k < 2) {
        const u = k - 1;
        eyeX = 0; eyeY = 2.8 + u * 0.6; eyeZ = 7.5 - u * 1.2;
      } else if (k < 3) {
        const u = k - 2;
        eyeX = -u * 2.5; eyeY = 3.4; eyeZ = 6.3 + u * 0.4;
      } else if (k < 4) {
        const u = k - 3;
        eyeX = -2.5 + u * 1.2; eyeY = 3.4 - u * 2.2; eyeZ = 6.7 - u * 2.6;
      } else {
        const u = Math.min(1, k - 4);
        eyeX = -1.3 + u * 1.3; eyeY = 1.2 + u * 2.0; eyeZ = 4.1 + u * 4.9;
      }
    } else if (this.current.scene === 'configurator') {
      eyeX = 0; eyeY = 6.5; eyeZ = 8;
    } else {
      // Brief and working screens: a calm wide view.
      const drift = this.current.motion === 'animated' ? Math.sin(t / 4000) * 0.3 : 0;
      eyeX = drift; eyeY = 3.4; eyeZ = 8.5;
    }
    // Pointer tilt of at most 2 degrees.
    const tiltX = this.current.scene === 'landing' ? this.pointerTilt.x * 0.35 : 0;
    const tiltY = this.current.scene === 'landing' ? this.pointerTilt.y * 0.35 : 0;
    eyeX += tiltX * 0.05;
    eyeY += tiltY * 0.05;
    const cx = 0;
    const cy = 0;
    const cz = 4;
    let zx = cx - eyeX;
    let zy = cy - eyeY;
    let zz = cz - eyeZ;
    const zl = Math.hypot(zx, zy, zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    let ux = 0;
    let uy = 1;
    let uz = 0;
    let xx = uy * zz - uz * zy;
    let xy = uz * zx - ux * zz;
    let xz = ux * zy - uy * zx;
    const xl = Math.hypot(xx, xy, xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    const view = [xx, yx, -zx, 0, xy, yy, -zy, 0, xz, yz, -zz, 0, -(xx * eyeX + xy * eyeY + xz * eyeZ), -(yx * eyeX + yy * eyeY + yz * eyeZ), (zx * eyeX + zy * eyeY + zz * eyeZ), 1];
    const out = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const p0 = p[i * 4] ?? 0;
        const p1 = p[i * 4 + 1] ?? 0;
        const p2 = p[i * 4 + 2] ?? 0;
        const p3 = p[i * 4 + 3] ?? 0;
        out[i * 4 + j] = p0 * (view[j] ?? 0) + p1 * (view[4 + j] ?? 0) + p2 * (view[8 + j] ?? 0) + p3 * (view[12 + j] ?? 0);
      }
    }
    this.mvp = out;
  }

  private render(): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const time = performance.now() - this.startAt;
    this.mvpFor(time);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    const mvpLoc = gl.getUniformLocation(this.program, 'uMvp');
    const opLoc = gl.getUniformLocation(this.program, 'uOpacity');
    const dimLoc = gl.getUniformLocation(this.program, 'uDim');
    const timeLoc = gl.getUniformLocation(this.program, 'uTime');
    if (mvpLoc) gl.uniformMatrix4fv(mvpLoc, false, this.mvp);
    // Fade up over 1.6 seconds on the brief's opening, and with each answer.
    const since = performance.now() - this.lastInput;
    const fadeMs = Math.max(0, Math.min(1600, performance.now() - this.fadeStart));
    let opacity = this.current.motion === 'animated' ? fadeMs / 1600 : 1;
    // Nothing moves within 2 seconds of the last input: fully drawn but not re-animated.
    if (since > 2000 && this.current.motion === 'animated') opacity = 1;
    if (opLoc) gl.uniform1f(opLoc, opacity);
    if (dimLoc) gl.uniform1f(dimLoc, this.dimmed ? 0.6 : 0);
    if (timeLoc) gl.uniform1f(timeLoc, time / 1000);
    const posAttr = gl.getAttribLocation(this.program, 'aPos');
    const kindAttr = gl.getAttribLocation(this.program, 'aKind');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.kindBuf);
    gl.enableVertexAttribArray(kindAttr);
    gl.vertexAttribPointer(kindAttr, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINES, 0, this.lineCount + this.pointCount);
    gl.disableVertexAttribArray(posAttr);
    gl.disableVertexAttribArray(kindAttr);
  }

  private loop = (): void => {
    const animate =
      this.current.motion === 'animated' &&
      (this.current.scene === 'landing' || performance.now() - this.fadeStart < 1700 || performance.now() - this.lastInput < 2000);
    if (this.gl && animate) {
      this.render();
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  pulseAnswer(): void {
    // The stage responds over 0.6 seconds after a saved answer.
    this.fadeStart = performance.now() - 1000;
    this.lastInput = performance.now();
  }

  dispose(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }
}
