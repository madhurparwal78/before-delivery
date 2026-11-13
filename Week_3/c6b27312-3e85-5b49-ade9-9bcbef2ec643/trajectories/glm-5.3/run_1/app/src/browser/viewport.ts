import type { Solid } from "../shared/records.js";

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
}

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  fov: number;
  projection: "perspective" | "orthographic";
}

/** The default pose of a part's bounding box, per the brief's camera rules. */
export function defaultPose(bbox: number[]): Pose {
  const cx = 0, cy = 0, cz = bbox[2]! / 2;
  const diag = Math.hypot(bbox[0]!, bbox[1]!, bbox[2]!);
  const d = Math.max(40, 2.5 * diag);
  const k = d / Math.sqrt(3);
  return {
    position: [cx + k, cy - k, cz + k],
    target: [cx, cy, cz],
    up: [0, 0, 1],
    fov: 35,
  };
}

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform mat4 uMvp;
uniform mat4 uModel;
varying vec3 vNormal;
varying vec3 vPos;
void main() {
  gl_Position = uMvp * vec4(aPos, 1.0);
  vNormal = mat3(uModel) * aNormal;
  vPos = (uModel * vec4(aPos, 1.0)).xyz;
}`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uColor;
uniform vec3 uLightDir;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float amb = 0.35;
  vec3 viewDir = normalize(-vPos);
  vec3 h = normalize(normalize(uLightDir) + viewDir);
  float spec = pow(max(dot(n, h), 0.0), 24.0) * 0.25;
  vec3 col = uColor * (amb + diff * 0.75) + vec3(0.7, 0.9, 1.0) * spec;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

/** One WebGL scene: the evaluated solid in front of its cyan work lamp. */
export class Viewport {
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private program: WebGLProgram | null = null;
  private buffers: { pos: WebGLBuffer | null; normal: WebGLBuffer | null; count: number; overlay?: WebGLBuffer | null; overlayCount?: number } = { pos: null, normal: null, count: 0 };
  private camera: CameraState;
  private baseColor: [number, number, number] = [0.55, 0.62, 0.7];
  private addedColor: [number, number, number] = [0.21, 0.83, 0.91];
  private onCameraChange: (() => void) | null = null;
  private dpr = 1;
  private needsDraw = true;
  private reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private glide: { from: CameraState; to: CameraState; start: number; duration: number } | null = null;

  constructor(root: HTMLElement, pose: Pose) {
    this.root = root;
    this.camera = { position: [...pose.position] as [number, number, number], target: [...pose.target] as [number, number, number], up: [...pose.up] as [number, number, number], fov: pose.fov, projection: "perspective" };
    this.canvas = document.createElement("canvas");
    this.gl = this.canvas.getContext("webgl", { antialias: true, alpha: true });
    root.append(this.canvas);
    if (this.gl) this.initGl();
    this.bindPointer();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(root);
    const loop = (): void => {
      if (this.needsDraw || this.glide) this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  get webglAvailable(): boolean { return this.gl !== null; }

  onCamera(cb: () => void): void { this.onCameraChange = cb; }

  private initGl(): void {
    const gl = this.gl!;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.gl = null;
      return;
    }
    this.program = prog;
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
  }

  /** Build triangle meshes for the solid's ops. */
  private meshFor(solid: Solid): { positions: Float32Array; normals: Float32Array } {
    const pos: number[] = [];
    const norm: number[] = [];
    const push = (a: number[], b: number[], c: number[], n: number[]): void => {
      pos.push(...a, ...b, ...c);
      norm.push(...n, ...n, ...n);
    };
    const body = solid.ops[0] as Record<string, number> | undefined;
    if (!body) return { positions: new Float32Array(pos), normals: new Float32Array(norm) };
    const H = Number(body.h ?? 0);
    if (String(body.op) === "box") {
      const w = Number(body.w), d = Number(body.d);
      const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
      const quads: [number[], number[], number[], number[], number[]][] = [
        [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0], [0, 0, -1]],
        [[x0, y1, H], [x1, y1, H], [x1, y0, H], [x0, y0, H], [0, 0, 1]],
        [[x0, y0, H], [x0, y1, H], [x0, y1, 0], [x0, y0, 0], [-1, 0, 0]],
        [[x1, y1, H], [x1, y0, H], [x1, y0, 0], [x1, y1, 0], [1, 0, 0]],
        [[x0, y1, H], [x0, y1, 0], [x1, y1, 0], [x1, y1, H], [0, 1, 0]],
        [[x1, y0, H], [x1, y0, 0], [x0, y0, 0], [x0, y0, H], [0, -1, 0]],
      ];
      for (const [a, b, c, dd, n] of quads) {
        push(a, b, c, n);
        push(a, c, dd, n);
      }
    } else {
      const dia = Number(body.dia);
      const R = dia / 2;
      const seg = 48;
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * Math.PI * 2;
        const t1 = ((i + 1) / seg) * Math.PI * 2;
        const p0 = [R * Math.cos(t0), R * Math.sin(t0)];
        const p1 = [R * Math.cos(t1), R * Math.sin(t1)];
        // side
        const nx = Math.cos((t0 + t1) / 2), ny = Math.sin((t0 + t1) / 2);
        push([p0[0]!, p0[1]!, 0], [p1[0]!, p1[1]!, 0], [p1[0]!, p1[1]!, H], [nx, ny, 0]);
        push([p0[0]!, p0[1]!, 0], [p1[0]!, p1[1]!, H], [p0[0]!, p0[1]!, H], [nx, ny, 0]);
        // caps
        push([p0[0]!, p0[1]!, H], [p1[0]!, p1[1]!, H], [0, 0, H], [0, 0, 1]);
        push([p1[0]!, p1[1]!, 0], [p0[0]!, p0[1]!, 0], [0, 0, 0], [0, 0, -1]);
      }
    }
    // Cuts and bosses are drawn as wireframe-free simplified markers: holes as
    // cylinder outlines would need CSG; instead we shade the solid's colour and
    // draw cut markers in the DOM chrome. Here bosses add their cylinders.
    for (const raw of solid.ops.slice(1)) {
      const o = raw as unknown as Record<string, number>;
      if (String(o.op) === "boss") {
        const R = Number(o.dia) / 2;
        const bx = Number(o.x ?? 0), by = Number(o.y ?? 0);
        const z0 = H, z1 = H + Number(o.h ?? 0);
        const seg = 32;
        for (let i = 0; i < seg; i++) {
          const t0 = (i / seg) * Math.PI * 2;
          const t1 = ((i + 1) / seg) * Math.PI * 2;
          const p0 = [bx + R * Math.cos(t0), by + R * Math.sin(t0)];
          const p1 = [bx + R * Math.cos(t1), by + R * Math.sin(t1)];
          const nx = Math.cos((t0 + t1) / 2), ny = Math.sin((t0 + t1) / 2);
          push([p0[0]!, p0[1]!, z0], [p1[0]!, p1[1]!, z0], [p1[0]!, p1[1]!, z1], [nx, ny, 0]);
          push([p0[0]!, p0[1]!, z0], [p1[0]!, p1[1]!, z1], [p0[0]!, p0[1]!, z1], [nx, ny, 0]);
          push([p0[0]!, p0[1]!, z1], [p1[0]!, p1[1]!, z1], [bx, by, z1], [0, 0, 1]);
        }
      }
    }
    return { positions: new Float32Array(pos), normals: new Float32Array(norm) };
  }

  setSolid(solid: Solid, opts: { color?: "base" | "added" } = {}): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    const mesh = this.meshFor(solid);
    if (this.buffers.pos) gl.deleteBuffer(this.buffers.pos);
    if (this.buffers.normal) gl.deleteBuffer(this.buffers.normal);
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    const normal = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normal);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
    this.buffers = { pos, normal, count: mesh.positions.length / 3 };
    this.baseColor = opts.color === "added" ? this.addedColor : [0.55, 0.62, 0.7];
    this.needsDraw = true;
  }

  setPlaceholderImage(src: string, alt: string): void {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    this.canvas.replaceWith(img);
    this.gl = null;
  }

  private bindPointer(): void {
    let dragging = false;
    let lastX = 0, lastY = 0;
    const active = new Map<number, { x: number; y: number }>();
    let pinchDist: number | null = null;
    this.root.addEventListener("pointerdown", (e) => {
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        return;
      }
      if (active.size > 2) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      try { this.root.setPointerCapture(e.pointerId); } catch { /* gone */ }
    });
    this.root.addEventListener("pointermove", (e) => {
      if (active.has(e.pointerId)) active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        if (pinchDist !== null && d > 0) {
          this.zoomBy(pinchDist / d);
          pinchDist = d;
          this.emitCamera();
        }
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.orbitBy(dx * 0.01, dy * 0.01);
      this.emitCamera();
    });
    const end = (e: PointerEvent): void => {
      active.delete(e.pointerId);
      if (active.size < 2) pinchDist = null;
      if (active.size === 0) dragging = false;
      try { this.root.releasePointerCapture(e.pointerId); } catch { /* gone */ }
    };
    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);
    this.root.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomBy(e.deltaY > 0 ? 1.1 : 0.9);
      this.emitCamera();
    }, { passive: false });
    // The viewport captures every touch gesture: dragging never scrolls the page.
    this.root.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  private orbitBy(az: number, el: number): void {
    const c = this.camera;
    const rel: [number, number, number] = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
    const r = Math.hypot(...rel);
    let theta = Math.atan2(rel[1]!, rel[0]!);
    let phi = Math.acos(Math.max(-1, Math.min(1, rel[2]! / r)));
    theta -= az;
    phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi - el));
    c.position = [
      c.target[0] + r * Math.sin(phi) * Math.cos(theta),
      c.target[1] + r * Math.sin(phi) * Math.sin(theta),
      c.target[2] + r * Math.cos(phi),
    ];
    this.needsDraw = true;
  }

  private zoomBy(factor: number): void {
    const c = this.camera;
    const rel: [number, number, number] = [c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]];
    const r = Math.max(20, Math.hypot(...rel) * factor);
    const k = r / Math.hypot(...rel);
    c.position = [c.target[0] + rel[0]! * k, c.target[1] + rel[1]! * k, c.target[2] + rel[2]! * k];
    this.needsDraw = true;
  }

  resetView(pose: Pose): void {
    this.camera.position = [...pose.position] as [number, number, number];
    this.camera.target = [...pose.target] as [number, number, number];
    this.camera.up = [...pose.up] as [number, number, number];
    this.camera.fov = pose.fov;
    this.needsDraw = true;
    this.emitCamera();
  }

  setProjection(p: "perspective" | "orthographic"): void {
    this.camera.projection = p;
    this.needsDraw = true;
    this.emitCamera();
  }

  get pose(): CameraState { return this.camera; }

  /** Glide to a pose; with reduced motion it applies in one frame. */
  glideTo(pose: Pose, durationMs = 480): void {
    const from: CameraState = { ...this.camera, position: [...this.camera.position] as [number, number, number], target: [...this.camera.target] as [number, number, number] };
    const to: CameraState = {
      position: [...pose.position] as [number, number, number],
      target: [...pose.target] as [number, number, number],
      up: [...pose.up] as [number, number, number],
      fov: pose.fov,
      projection: this.camera.projection,
    };
    this.root.dataset.cameraMoving = "true";
    if (this.reducedMotion) {
      this.camera = to;
      this.root.dataset.cameraMoving = "false";
      this.root.dataset.camera = cameraText(this.camera);
      this.needsDraw = true;
      this.emitCamera();
      return;
    }
    this.glide = { from, to, start: performance.now(), duration: Math.max(400, Math.min(560, durationMs)) };
  }

  private emitCamera(): void {
    this.root.dataset.camera = cameraText(this.camera);
    this.onCameraChange?.();
  }

  private resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.needsDraw = true;
  }

  private draw(): void {
    const gl = this.gl;
    if (!gl || !this.program) return;
    if (this.glide) {
      const t = (performance.now() - this.glide.start) / this.glide.duration;
      if (t >= 1) {
        this.camera = this.glide.to;
        this.glide = null;
        this.root.dataset.cameraMoving = "false";
        this.emitCamera();
      } else {
        const e = 1 - Math.pow(1 - t, 3);
        const lerp3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
          [a[0]! + (b[0]! - a[0]!) * e, a[1]! + (b[1]! - a[1]!) * e, a[2]! + (b[2]! - a[2]!) * e];
        this.camera.position = lerp3(this.glide.from.position, this.glide.to.position);
        this.camera.target = lerp3(this.glide.from.target, this.glide.to.target);
        this.camera.fov = this.glide.from.fov + (this.glide.to.fov - this.glide.from.fov) * e;
        this.root.dataset.camera = cameraText(this.camera);
      }
    }
    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (this.buffers.count === 0) return;
    gl.useProgram(this.program);
    const mvp = this.mvp();
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "uMvp"), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "uModel"), false, identity());
    gl.uniform3fv(gl.getUniformLocation(this.program, "uColor"), this.baseColor);
    gl.uniform3f(gl.getUniformLocation(this.program, "uLightDir"), 0.4, -0.6, 0.9);
    const posLoc = gl.getAttribLocation(this.program, "aPos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.pos);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
    const normLoc = gl.getAttribLocation(this.program, "aNormal");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.normal);
    gl.enableVertexAttribArray(normLoc);
    gl.vertexAttribPointer(normLoc, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.buffers.count);
    this.needsDraw = false;
  }

  private mvp(): Float32Array {
    const c = this.camera;
    const f = Math.tan(((c.fov / 2) * Math.PI) / 180);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const near = 1, far = 100000;
    const dist = Math.hypot(c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]);
    let proj: number[];
    if (c.projection === "orthographic") {
      const hHalf = dist * f;
      const wHalf = hHalf * aspect;
      proj = [
        1 / wHalf, 0, 0, 0,
        0, 1 / hHalf, 0, 0,
        0, 0, -2 / (far - near), 0,
        0, 0, -(far + near) / (far - near), 1,
      ];
    } else {
      proj = [
        1 / (f * aspect), 0, 0, 0,
        0, 1 / f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0,
      ];
    }
    return multiply(proj, lookAt(c));
  }
}

function identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function multiply(a: number[], b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j]! * b[k * 4 + i]!;
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function lookAt(c: CameraState): Float32Array {
  const z = normalize([c.position[0] - c.target[0], c.position[1] - c.target[1], c.position[2] - c.target[2]]);
  const x = normalize(cross(c.up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0]! * c.position[0]! + x[1]! * c.position[1]! + x[2]! * c.position[2]!),
    -(y[0]! * c.position[0]! + y[1]! * c.position[1]! + y[2]! * c.position[2]!),
    -(z[0]! * c.position[0]! + z[1]! * c.position[1]! + z[2]! * c.position[2]!),
    1,
  ]);
}

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

function cross(a: number[], b: number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}

/** data-camera text: seven comma-separated numbers rounded to 0.001. */
export function cameraText(c: CameraState): string {
  const r = (n: number): string => String(Math.round(n * 1000) / 1000);
  return [c.position[0], c.position[1], c.position[2], c.target[0], c.target[1], c.target[2], c.fov]
    .map((n) => r(n as number)).join(",");
}
