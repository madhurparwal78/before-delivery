// The live 3D twin of a net pen. One controller owns the camera, the Unwrap/Wrap run, the ambient loops,
// pin projection and wall picking. Everything that moves follows elapsed time (performance.now), so a slow
// software renderer skips frames but always ends in the same place inside the same time.

import {
  AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Color, ConeGeometry, DoubleSide, Fog, Group,
  InstancedMesh, Line, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera,
  PlaneGeometry, Points, PointsMaterial, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, BoxGeometry,
} from "three";

export type ViewState = "cylinder" | "unwrapping" | "flat" | "wrapping";

export interface Geo {
  circumference_m: number;
  net_depth_m: number;
  grid: { columns: number; rows: number; panel_width_m: number; panel_height_m: number };
}

interface PinData {
  id: string;
  chart_x_m: number;
  depth_m: number;
}

export interface Snapshot {
  view: ViewState;
  camera: string;
  zoom: string;
  hasWebGL: boolean;
}

export interface WallPoint {
  x_m: number;
  y_m: number;
  z_m: number;
}

const RUN_MS = 1400;
const FLY_MS = 900;
const FOV = 32;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const TILT_LIMIT = 40;
const FISH = 36;
const PARTICLES = 160;
const SHAFTS = 5;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rad = (deg: number) => (deg * Math.PI) / 180;
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;
const easeRun = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 4);
const easeFly = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3.2);
const shortest = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

export class Twin {
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  private host: HTMLElement;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 1, 4000);
  private width = 1;
  private height = 1;
  private geo: Geo | null = null;
  private R = 25;
  private D = 20;
  private d0 = 100;
  private d1 = 300;
  private pins = new Map<string, HTMLElement>();
  private defs: PinData[] = [];
  private selected: string | null = null;
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private reduced: boolean;
  private raf = 0;
  private last = 0;
  private disposed = false;
  // camera state
  private azT = 0;
  private azA = 0;
  private tiltT = 0;
  private tiltA = 0;
  private zoomT = 1;
  private zoomA = 1;
  private panU = 0;
  private panT = 0;
  private panV = 0;
  private panVT = 0;
  // run state: tau runs 0 (cylinder) .. RUN_MS (flat)
  private tau = 0;
  private dir = 0;
  private lastRun = 0;
  private azBeforeRun = 0;
  private fly: null | { t0: number; az0: number; az1: number; pan0: number; pan1: number } = null;
  private rovFrom = new Vector3();
  private rovTo = new Vector3();
  private rovMove: null | { t0: number } = null;
  private rovAt = new Vector3();
  private hasRov = false;
  // scene objects
  private net: LineSegments | null = null;
  private netNodes: { u: number; y: number }[] = [];
  private netSegments: [number, number][] = [];
  private collar: LineSegments | null = null;
  private moorings = new Group();
  private fishMesh: InstancedMesh | null = null;
  private fishInfo: { r: number; y: number; phase: number; lap: number }[] = [];
  private particles: Points | null = null;
  private particleSeed: { a: number; r: number; y: number }[] = [];
  private shafts = new Group();
  private rov = new Group();
  private tether: Line | null = null;
  private lamp: Mesh | null = null;
  private fishMaterial = new MeshBasicMaterial({ color: new Color(0x15606c), transparent: true });
  private mooringMaterial = new LineBasicMaterial({ color: new Color(0x2f7f88), transparent: true });
  private shaftMaterial: MeshBasicMaterial | null = null;
  private lastP = -1;
  private tmp = new Vector3();
  private dummy = new Object3D();

  constructor(host: HTMLElement, canvas: HTMLCanvasElement, overlay: HTMLCanvasElement, reduced: boolean) {
    this.host = host;
    this.canvas = canvas;
    this.overlay = overlay;
    this.reduced = reduced;
    this.scene.background = new Color(0x010101);
    this.scene.fog = new Fog(0x010101, 50, 200);
    this.tiltT = this.tiltA = 14;
    try {
      this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
      this.renderer.setClearColor(0x010101, 1);
    } catch {
      this.renderer = null;
    }
    if (this.renderer) {
      this.buildAmbient();
    } else {
      this.tau = RUN_MS;
    }
    this.snapshot = this.compute();
    const box = host.getBoundingClientRect();
    this.resize(Math.max(1, box.width), Math.max(1, box.height));
    this.markDirty();
  }

  get hasWebGL(): boolean {
    return this.renderer !== null;
  }

  // ------------------------------------------------------------------ subscription
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): Snapshot => this.snapshot;

  private compute(): Snapshot {
    const view: ViewState =
      this.dir > 0 ? "unwrapping" : this.dir < 0 ? "wrapping" : this.tau >= RUN_MS ? "flat" : "cylinder";
    const camera = view === "flat" ? "Camera: flat chart" : `Camera: ${Math.floor(wrap360(this.azA) + 0.5) % 360}°`;
    return { view, camera, zoom: `Zoom: ${this.zoomT.toFixed(2)}×`, hasWebGL: this.renderer !== null };
  }

  private publish(): void {
    const next = this.compute();
    const prev = this.snapshot;
    if (next.view !== prev.view || next.camera !== prev.camera || next.zoom !== prev.zoom) {
      this.snapshot = next;
      this.listeners.forEach((fn) => fn());
    }
  }

  // ------------------------------------------------------------------ geometry
  setGeometry(geo: Geo): void {
    if (this.geo && this.geo.circumference_m === geo.circumference_m && this.geo.net_depth_m === geo.net_depth_m) {
      this.geo = geo;
      return;
    }
    this.geo = geo;
    this.R = geo.circumference_m / (2 * Math.PI);
    this.D = geo.net_depth_m;
    this.rebuildNet();
    this.layoutAmbient();
    this.fit();
    this.lastP = -1;
    this.markDirty();
  }

  private fit(): void {
    const aspect = this.width / this.height;
    const t = Math.tan(rad(FOV / 2));
    const C = this.geo?.circumference_m ?? 2 * Math.PI * this.R;
    this.d0 = Math.max((this.D * 1.6) / 2 / t, this.R / (0.84 * t * aspect));
    this.d1 = Math.max((C * 1.08) / 2 / (t * aspect), (this.D * 1.5) / 2 / t);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  resize(w: number, h: number): void {
    if (w < 2 || h < 2) return;
    this.width = w;
    this.height = h;
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = Math.round(w * ratio);
    this.overlay.height = Math.round(h * ratio);
    this.fit();
    this.markDirty();
  }

  // ------------------------------------------------------------------ the surface function
  private place(u: number, y: number, p: number, out: Vector3): Vector3 {
    const k = Math.max((1 - p) / this.R, 1e-7);
    const a = Math.sin(k * u) / k;
    const dz = (1 - Math.cos(k * u)) / k;
    return out.set(-a, y, this.R - dz);
  }

  private get progress(): number {
    return easeRun(this.tau / RUN_MS);
  }

  private get linearX(): number {
    return clamp(this.tau / RUN_MS, 0, 1);
  }

  // ------------------------------------------------------------------ scene building
  private rebuildNet(): void {
    if (!this.renderer || !this.geo) return;
    const C = this.geo.circumference_m;
    const nu = Math.max(24, Math.round(C / 1.7 / 2) * 2);
    const nv = Math.max(10, Math.round(this.D / 0.9 / 2) * 2);
    const nodes: { u: number; y: number }[] = [];
    const index = new Map<number, number>();
    for (let i = 0; i <= nu; i++) {
      for (let j = 0; j <= nv; j++) {
        if ((i + j) % 2) continue;
        index.set(i * (nv + 1) + j, nodes.length);
        nodes.push({ u: -C / 2 + (C * i) / nu, y: (-this.D * j) / nv });
      }
    }
    const segments: [number, number][] = [];
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j <= nv; j++) {
        const a = index.get(i * (nv + 1) + j);
        if (a === undefined) continue;
        for (const dj of [1, -1]) {
          const b = j + dj >= 0 && j + dj <= nv ? index.get((i + 1) * (nv + 1) + j + dj) : undefined;
          if (b !== undefined) segments.push([a, b]);
        }
      }
    }
    this.netNodes = nodes;
    this.netSegments = segments;
    if (this.net) {
      this.scene.remove(this.net);
      this.net.geometry.dispose();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(segments.length * 6), 3));
    const colors = new Float32Array(segments.length * 6);
    const surface = new Color(0x2f9aa6);
    const deep = new Color(0x0a2328);
    segments.forEach(([a, b], s) => {
      [a, b].forEach((n, k) => {
        const f = clamp(-nodes[n].y / this.D, 0, 1);
        const c = surface.clone().lerp(deep, Math.pow(f, 0.6));
        colors.set([c.r, c.g, c.b], s * 6 + k * 3);
      });
    });
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    this.net = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 }));
    this.net.frustumCulled = false;
    this.scene.add(this.net);

    if (this.collar) {
      this.scene.remove(this.collar);
      this.collar.geometry.dispose();
    }
    const samples = 160;
    const collarGeometry = new BufferGeometry();
    collarGeometry.setAttribute("position", new BufferAttribute(new Float32Array(samples * 3 * 2 * 3), 3));
    this.collar = new LineSegments(collarGeometry, new LineBasicMaterial({ color: new Color(0x9fd8de), transparent: true, opacity: 0.9 }));
    this.collar.frustumCulled = false;
    this.scene.add(this.collar);

    this.moorings.clear();
    const positions: number[] = [];
    for (let k = 0; k < 4; k++) {
      const th = rad(45 + 90 * k);
      positions.push(this.R * Math.sin(th), 0, -this.R * Math.cos(th));
      positions.push(this.R * 3.4 * Math.sin(th), -this.D * 0.55, -this.R * 3.4 * Math.cos(th));
    }
    const mooringGeometry = new BufferGeometry();
    mooringGeometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    this.moorings.add(new LineSegments(mooringGeometry, this.mooringMaterial));
    this.scene.add(this.moorings);
    this.lastP = -1;
  }

  private buildAmbient(): void {
    const fishGeometry = new ConeGeometry(0.28, 1.3, 5);
    fishGeometry.rotateX(Math.PI / 2);
    this.fishMesh = new InstancedMesh(fishGeometry, this.fishMaterial, FISH);
    this.fishMesh.frustumCulled = false;
    this.scene.add(this.fishMesh);
    const positions = new Float32Array(PARTICLES * 3);
    const particleGeometry = new BufferGeometry();
    particleGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.particles = new Points(
      particleGeometry,
      new PointsMaterial({ color: new Color(0x6fb7be), size: 0.22, transparent: true, opacity: 0.5, sizeAttenuation: true }),
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, 0, 64);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(1, "#000000");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 4, 64);
    }
    const alpha = new CanvasTexture(canvas);
    this.shaftMaterial = new MeshBasicMaterial({
      color: new Color(0x4fb4bd), transparent: true, opacity: 0.16, alphaMap: alpha, blending: AdditiveBlending,
      depthWrite: false, side: DoubleSide,
    });
    for (let i = 0; i < SHAFTS; i++) {
      const shaft = new Mesh(new PlaneGeometry(1, 1), this.shaftMaterial);
      shaft.frustumCulled = false;
      this.shafts.add(shaft);
    }
    this.scene.add(this.shafts);
    const body = new Mesh(new BoxGeometry(1, 0.55, 0.7), new MeshBasicMaterial({ color: new Color(0xd3dfe1) }));
    const lampMaterial = new MeshBasicMaterial({
      color: new Color(0xe8f6ee), transparent: true, opacity: 0.16, blending: AdditiveBlending, depthWrite: false,
    });
    const cone = new ConeGeometry(1.4, 4, 18, 1, true);
    cone.translate(0, -2, 0);
    cone.rotateX(-Math.PI / 2);
    this.lamp = new Mesh(cone, lampMaterial);
    this.rov.add(body, this.lamp);
    this.rov.visible = false;
    this.scene.add(this.rov);
    const tether = new BufferGeometry();
    tether.setAttribute("position", new BufferAttribute(new Float32Array(6), 3));
    this.tether = new Line(tether, new LineBasicMaterial({ color: new Color(0xb9c9cc), transparent: true, opacity: 0.55 }));
    this.tether.frustumCulled = false;
    this.tether.visible = false;
    this.scene.add(this.tether);
  }

  private layoutAmbient(): void {
    if (!this.renderer) return;
    this.fishInfo = Array.from({ length: FISH }, (_, i) => ({
      r: this.R * (0.3 + 0.5 * ((i * 0.618) % 1)),
      y: -this.D * (0.18 + 0.62 * ((i * 0.381) % 1)),
      phase: ((i * 0.754) % 1) * Math.PI * 2,
      lap: 36000 + 18000 * ((i * 0.447) % 1),
    }));
    this.particleSeed = Array.from({ length: PARTICLES }, (_, i) => ({
      a: ((i * 0.618) % 1) * Math.PI * 2,
      r: this.R * 1.25 * Math.sqrt((i * 0.754) % 1),
      y: -this.D * ((i * 0.381) % 1),
    }));
    this.shafts.children.forEach((child, i) => {
      const mesh = child as Mesh;
      const a = rad((360 / SHAFTS) * i + 20);
      mesh.scale.set(this.R * 0.28, this.D * 1.25, 1);
      mesh.position.set(this.R * 0.7 * Math.sin(a), -this.D * 0.56, -this.R * 0.7 * Math.cos(a));
      mesh.rotation.y = a + Math.PI / 2;
    });
  }

  // ------------------------------------------------------------------ pins and selection
  registerPin(id: string, el: HTMLElement | null): void {
    if (el) this.pins.set(id, el);
    else this.pins.delete(id);
  }

  setPins(list: PinData[]): void {
    this.defs = list;
    this.updatePins();
    this.markDirty();
  }

  setSelected(id: string | null, jump: boolean): void {
    if (id === this.selected) return;
    this.selected = id;
    const def = id ? this.defs.find((d) => d.id === id) : undefined;
    if (!def) {
      this.markDirty();
      return;
    }
    const target = this.rovTarget(def);
    if (!this.hasRov || jump || this.reduced) {
      this.rovAt.copy(target);
      this.rovMove = null;
    } else {
      this.rovFrom.copy(this.rovAt);
      this.rovTo.copy(target);
      this.rovMove = { t0: performance.now() };
    }
    this.hasRov = true;
    this.markDirty();
  }

  private rovTarget(def: PinData): Vector3 {
    const u = def.chart_x_m - (this.geo?.circumference_m ?? 0) / 2;
    const th = ((u / (this.geo?.circumference_m ?? 1)) * 360 + 180) * (Math.PI / 180);
    const r = Math.max(this.R - 2.6, this.R * 0.55);
    return new Vector3(r * Math.sin(th), -Math.max(def.depth_m - 0.8, 0.8), -r * Math.cos(th));
  }

  /** Face a defect: cylinder azimuth to its bearing, flat view pan to its chart x. Jump skips the glide. */
  focusDefect(id: string, jump: boolean): void {
    const def = this.defs.find((d) => d.id === id);
    if (!def || !this.geo || this.dir !== 0) return;
    const C = this.geo.circumference_m;
    const bearing = (def.chart_x_m / C) * 360;
    if (this.tau >= RUN_MS) {
      this.moveCamera(this.azT, def.chart_x_m - C / 2, jump);
    } else {
      this.moveCamera(bearing, this.panT, jump);
    }
  }

  private moveCamera(az: number, pan: number, jump: boolean): void {
    const clampedPan = this.clampPan(pan);
    if (jump || this.reduced) {
      this.fly = null;
      this.azT = this.azA = wrap360(az);
      this.panT = this.panU = clampedPan;
    } else {
      this.fly = { t0: performance.now(), az0: this.azA, az1: this.azA + shortest(this.azA, az), pan0: this.panU, pan1: clampedPan };
    }
    this.publish();
    this.markDirty();
  }

  /** How far the flat chart may be panned: only as far as the zoom hides part of it. */
  private panLimits(): [number, number] {
    const C = this.geo?.circumference_m ?? 0;
    const t = Math.tan(rad(FOV / 2));
    const visibleW = (2 * this.d1 * t * (this.width / this.height)) / this.zoomT;
    const visibleH = (2 * this.d1 * t) / this.zoomT;
    return [Math.max(0, (C - visibleW) / 2 + 2), Math.max(0, (this.D - visibleH) / 2 + 1)];
  }

  private clampPan(pan: number): number {
    const [limit] = this.panLimits();
    return clamp(pan, -limit, limit);
  }

  private clampPanV(pan: number): number {
    const [, limit] = this.panLimits();
    return clamp(pan, -limit, limit);
  }

  /** Loading an address shows its end state at once: the view, and the camera on the selected defect. */
  applyAddress(view: "cylinder" | "flat", selectedId: string | null): void {
    if (this.renderer) {
      this.tau = view === "flat" ? RUN_MS : 0;
      this.dir = 0;
    }
    this.fly = null;
    this.lastP = -1;
    const def = selectedId ? this.defs.find((d) => d.id === selectedId) : undefined;
    if (def && this.geo) {
      const C = this.geo.circumference_m;
      if (view === "cylinder") this.azT = this.azA = wrap360((def.chart_x_m / C) * 360);
      else this.panT = this.panU = this.clampPan(def.chart_x_m - C / 2);
    }
    this.setSelected(selectedId, true);
    this.publish();
    this.markDirty();
  }

  // ------------------------------------------------------------------ input
  orbit(deltaDeg: number): void {
    if (this.tau >= RUN_MS || this.dir !== 0) return;
    this.fly = null;
    this.azT = wrap360(this.azT + deltaDeg);
    if (this.reduced) this.azA = this.azT;
    this.publish();
    this.markDirty();
  }

  tilt(deltaDeg: number): void {
    if (this.tau >= RUN_MS || this.dir !== 0) return;
    this.tiltT = clamp(this.tiltT + deltaDeg, -TILT_LIMIT, TILT_LIMIT);
    if (this.reduced) this.tiltA = this.tiltT;
    this.markDirty();
  }

  panPanels(columns: number, rows: number): void {
    if (this.tau < RUN_MS || !this.geo) return;
    this.fly = null;
    this.panT = this.clampPan(this.panT + columns * this.geo.grid.panel_width_m);
    this.panVT = this.clampPanV(this.panVT + rows * this.geo.grid.panel_height_m);
    if (this.reduced) {
      this.panU = this.panT;
      this.panV = this.panVT;
    }
    this.markDirty();
  }

  zoomStep(step: number): void {
    this.setZoom(this.zoomT + step);
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoomT * factor);
  }

  private setZoom(value: number): void {
    this.zoomT = clamp(Math.round(value * 1000) / 1000, ZOOM_MIN, ZOOM_MAX);
    this.panT = this.clampPan(this.panT);
    this.panVT = this.clampPanV(this.panVT);
    if (this.reduced) {
      this.zoomA = this.zoomT;
      this.panU = this.panT;
      this.panV = this.panVT;
    }
    this.publish();
    this.markDirty();
  }

  /** Dragging the stage: orbit in the cylinder view, pan the chart in the flat view. */
  dragBy(dx: number, dy: number): void {
    if (this.dir !== 0) return;
    this.fly = null;
    if (this.tau >= RUN_MS) {
      const visible = 2 * this.d1 / this.zoomA * Math.tan(rad(FOV / 2)) * (this.width / this.height);
      this.panT = this.clampPan(this.panT - (dx / this.width) * visible);
      this.panU = this.panT;
      this.panVT = this.clampPanV(this.panVT + (dy / this.height) * visible / (this.width / this.height));
      this.panV = this.panVT;
    } else {
      this.azT = wrap360(this.azT - (dx / this.width) * 180);
      this.azA = this.azT;
      this.tiltT = this.tiltA = clamp(this.tiltT + (dy / this.height) * 60, -TILT_LIMIT, TILT_LIMIT);
    }
    this.publish();
    this.markDirty();
  }

  /** A short glide when a drag ends. */
  glide(velocityPxPerMs: number): void {
    if (this.reduced || this.tau >= RUN_MS || this.dir !== 0) return;
    const extra = clamp(((-velocityPxPerMs * 40) / this.width) * 180, -10, 10);
    this.azT = wrap360(this.azT + extra);
    this.publish();
    this.markDirty();
  }

  unwrap(): void {
    if (!this.renderer || this.dir > 0 || this.tau >= RUN_MS) return;
    this.startRun(1);
  }

  wrapUp(): void {
    if (!this.renderer || this.dir < 0 || this.tau <= 0) return;
    this.startRun(-1);
  }

  private startRun(dir: 1 | -1): void {
    this.fly = null;
    if (this.tau <= 0 && dir > 0) this.azBeforeRun = this.azA;
    if (this.reduced) {
      this.tau = dir > 0 ? RUN_MS : 0;
      this.dir = 0;
      if (dir > 0) this.azA = this.azT = 0;
      else this.azA = this.azT = this.azBeforeRun;
      this.lastP = -1;
      this.publish();
      this.markDirty();
      return;
    }
    this.dir = dir;
    this.lastRun = performance.now();
    this.publish();
    this.markDirty();
  }

  get viewState(): ViewState {
    return this.snapshot.view;
  }

  get settledView(): "cylinder" | "flat" {
    return this.tau >= RUN_MS ? "flat" : "cylinder";
  }

  // ------------------------------------------------------------------ projection and picking
  private project(point: Vector3): [number, number] {
    this.tmp.copy(point).project(this.camera);
    return [(this.tmp.x * 0.5 + 0.5) * this.width, (-this.tmp.y * 0.5 + 0.5) * this.height];
  }

  private pinPoint(def: PinData, p: number, out: Vector3): Vector3 {
    const C = this.geo?.circumference_m ?? 1;
    return this.place(def.chart_x_m - C / 2, -def.depth_m, p, out);
  }

  updatePins(): void {
    if (!this.geo) return;
    const p = this.progress;
    this.camera.updateMatrixWorld();
    const point = new Vector3();
    for (const def of this.defs) {
      const el = this.pins.get(def.id);
      if (!el) continue;
      const [x, y] = this.project(this.pinPoint(def, p, point));
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  /** The tapped net-wall point in the pen's own frame, or null when the tap misses the net. */
  pickWall(clientX: number, clientY: number): WallPoint | null {
    if (!this.geo || this.dir !== 0) return null;
    const box = this.host.getBoundingClientRect();
    const ndc = new Vector2(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
    this.applyCamera();
    this.camera.updateMatrixWorld();
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    let theta: number;
    let y: number;
    if (this.tau >= RUN_MS) {
      if (Math.abs(d.z) < 1e-9) return null;
      const t = (this.R - o.z) / d.z;
      if (t <= 0) return null;
      const x = o.x + d.x * t;
      y = o.y + d.y * t;
      const C = this.geo.circumference_m;
      const bearing = 180 + (-x / C) * 360;
      if (bearing < 0 || bearing >= 360) return null;
      theta = rad(bearing);
    } else {
      const a = d.x * d.x + d.z * d.z;
      const b = 2 * (o.x * d.x + o.z * d.z);
      const c = o.x * o.x + o.z * o.z - this.R * this.R;
      const disc = b * b - 4 * a * c;
      if (a < 1e-12 || disc < 0) return null;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t <= 0) return null;
      const x = o.x + d.x * t;
      const z = o.z + d.z * t;
      y = o.y + d.y * t;
      theta = Math.atan2(x, -z);
    }
    if (y > 0 || y < -this.D) return null;
    return { x_m: this.R * Math.sin(theta), y_m: y, z_m: this.R * Math.cos(theta) };
  }

  // ------------------------------------------------------------------ the frame
  markDirty(): void {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.frame);
  }

  setReduced(reduced: boolean): void {
    this.reduced = reduced;
    this.markDirty();
  }

  private ambient(): boolean {
    return this.renderer !== null && !this.reduced && !document.hidden;
  }

  private frame = (): void => {
    this.raf = 0;
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(120, Math.max(0, now - (this.last || now)));
    this.last = now;
    const busy = this.step(now, dt);
    this.render(now);
    if (busy || this.ambient()) this.markDirty();
  };

  private step(now: number, dt: number): boolean {
    let busy = false;
    if (this.dir !== 0) {
      const span = now - this.lastRun;
      this.lastRun = now;
      this.tau = clamp(this.tau + this.dir * span, 0, RUN_MS);
      if ((this.dir > 0 && this.tau >= RUN_MS) || (this.dir < 0 && this.tau <= 0)) this.dir = 0;
      this.publish();
      busy = this.dir !== 0;
      const turn = easeRun(this.linearX * 2.6);
      if (this.tau < RUN_MS) {
        this.azA = this.azBeforeRun + shortest(this.azBeforeRun, 0) * turn;
        this.azT = this.azA;
      } else {
        this.azA = this.azT = 0;
      }
      if (this.tau <= 0) {
        this.azA = this.azT = wrap360(this.azBeforeRun);
      }
      this.tiltA = this.tiltT * (1 - this.progress);
    } else if (this.fly) {
      const x = (now - this.fly.t0) / FLY_MS;
      const e = easeFly(x);
      this.azA = lerp(this.fly.az0, this.fly.az1, e);
      this.panU = lerp(this.fly.pan0, this.fly.pan1, e);
      if (x >= 1) {
        this.azA = this.azT = wrap360(this.fly.az1);
        this.panU = this.panT = this.fly.pan1;
        this.fly = null;
      } else {
        busy = true;
      }
      this.publish();
    } else {
      const k = 1 - Math.exp(-dt / 70);
      if (Math.abs(shortest(this.azA, this.azT)) > 0.02) {
        this.azA = wrap360(this.azA + shortest(this.azA, this.azT) * k);
        busy = true;
      } else {
        this.azA = this.azT;
      }
      if (Math.abs(this.panU - this.panT) > 0.01 || Math.abs(this.panV - this.panVT) > 0.01) {
        this.panU += (this.panT - this.panU) * k;
        this.panV += (this.panVT - this.panV) * k;
        busy = true;
      } else {
        this.panU = this.panT;
        this.panV = this.panVT;
      }
      if (Math.abs(this.tiltA - this.tiltT) > 0.02) {
        this.tiltA += (this.tiltT - this.tiltA) * k;
        busy = true;
      } else {
        this.tiltA = this.tiltT;
      }
      this.publish();
    }
    if (this.dir === 0) {
      const k = 1 - Math.exp(-dt / 70);
      if (Math.abs(this.zoomA - this.zoomT) > 0.002) {
        this.zoomA += (this.zoomT - this.zoomA) * k;
        busy = true;
      } else {
        this.zoomA = this.zoomT;
      }
    } else if (Math.abs(this.zoomA - this.zoomT) > 0.002) {
      this.zoomA += (this.zoomT - this.zoomA) * (1 - Math.exp(-dt / 70));
    }
    if (this.rovMove) {
      const x = (now - this.rovMove.t0) / FLY_MS;
      this.rovAt.lerpVectors(this.rovFrom, this.rovTo, easeFly(x));
      if (x >= 1) {
        this.rovAt.copy(this.rovTo);
        this.rovMove = null;
      } else {
        busy = true;
      }
    }
    return busy;
  }

  private applyCamera(): void {
    const pe = this.progress;
    const R = this.R;
    const distance = Math.exp(lerp(Math.log(this.d0), Math.log(this.d1), pe)) / this.zoomA;
    const lift = distance * Math.tan(rad(FOV / 2)) * 2 * 0.06;
    const target = new Vector3(-this.panU * pe, -this.D / 2 - this.panV * pe - lift, R * pe);
    const e = rad(this.tiltA * (1 - pe));
    const a = rad(this.azA);
    this.camera.position.set(
      target.x + distance * Math.sin(a) * Math.cos(e),
      target.y + distance * Math.sin(e),
      target.z - distance * Math.cos(a) * Math.cos(e),
    );
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    if (this.scene.fog instanceof Fog) {
      this.scene.fog.near = distance - R * 0.9;
      this.scene.fog.far = distance + R * 2.8 + pe * distance * 4;
    }
  }

  private writeNet(p: number): void {
    if (!this.net) return;
    const attribute = this.net.geometry.getAttribute("position") as BufferAttribute;
    const array = attribute.array as Float32Array;
    const cache: Vector3[] = this.netNodes.map((n) => this.place(n.u, n.y, p, new Vector3()));
    this.netSegments.forEach(([a, b], s) => {
      array.set([cache[a].x, cache[a].y, cache[a].z, cache[b].x, cache[b].y, cache[b].z], s * 6);
    });
    attribute.needsUpdate = true;
    if (this.collar && this.geo) {
      const geometry = this.collar.geometry.getAttribute("position") as BufferAttribute;
      const out = geometry.array as Float32Array;
      const C = this.geo.circumference_m;
      const samples = out.length / 18;
      const prev = [new Vector3(), new Vector3(), new Vector3()];
      const cur = [new Vector3(), new Vector3(), new Vector3()];
      const normal = new Vector3();
      const offsets = [-0.5, 0, 0.5];
      for (let s = 0; s <= samples; s++) {
        const u = -C / 2 + (C * s) / samples;
        const k = Math.max((1 - p) / this.R, 1e-7);
        normal.set(-Math.sin(k * u), 0, Math.cos(k * u));
        this.place(u, 0, p, this.tmp);
        for (let line = 0; line < 3; line++) {
          cur[line].copy(this.tmp).addScaledVector(normal, offsets[line]);
        }
        if (s > 0) {
          for (let line = 0; line < 3; line++) {
            const at = ((s - 1) * 3 + line) * 6;
            out.set([prev[line].x, prev[line].y, prev[line].z, cur[line].x, cur[line].y, cur[line].z], at);
          }
        }
        for (let line = 0; line < 3; line++) prev[line].copy(cur[line]);
      }
      geometry.needsUpdate = true;
    }
  }

  private render(now: number): void {
    if (!this.geo) {
      this.drawOverlay();
      this.renderer?.render(this.scene, this.camera);
      return;
    }
    const p = this.progress;
    const x = this.linearX;
    const t = this.reduced ? 0 : now;
    this.applyCamera();
    if (this.renderer) {
      if (p !== this.lastP) {
        this.writeNet(p);
        this.lastP = p;
      }
      const fade = clamp(1 - x * 3.2, 0, 1);
      this.mooringMaterial.opacity = 0.7 * fade;
      this.moorings.visible = fade > 0.001;
      this.fishMaterial.opacity = 0.95 * fade;
      if (this.fishMesh) {
        this.fishMesh.visible = fade > 0.001;
        for (let i = 0; i < FISH; i++) {
          const info = this.fishInfo[i];
          if (!info) continue;
          const angle = info.phase + (t / info.lap) * Math.PI * 2;
          this.dummy.position.set(info.r * Math.sin(angle), info.y + Math.sin(angle * 3 + i) * 0.4, -info.r * Math.cos(angle));
          this.dummy.rotation.set(0, Math.PI - angle, 0);
          this.dummy.updateMatrix();
          this.fishMesh.setMatrixAt(i, this.dummy.matrix);
        }
        this.fishMesh.instanceMatrix.needsUpdate = true;
      }
      if (this.particles) {
        const attribute = this.particles.geometry.getAttribute("position") as BufferAttribute;
        const array = attribute.array as Float32Array;
        for (let i = 0; i < this.particleSeed.length; i++) {
          const seed = this.particleSeed[i];
          const rise = (t / 30000) * this.D;
          const y = -((((-seed.y - rise) % this.D) + this.D) % this.D);
          array.set([seed.r * Math.sin(seed.a), y, -seed.r * Math.cos(seed.a)], i * 3);
        }
        attribute.needsUpdate = true;
        (this.particles.material as PointsMaterial).opacity = 0.5 * lerp(1, 0.3, x);
      }
      if (this.shaftMaterial) {
        this.shaftMaterial.opacity = 0.16 * lerp(1, 0.25, x);
        this.shafts.children.forEach((child, i) => {
          child.rotation.z = Math.sin((t / 10000) * Math.PI * 2 + i * 1.7) * 0.07;
        });
      }
      const rovVisible = this.hasRov && this.selected !== null && fade > 0.001;
      this.rov.visible = rovVisible;
      if (this.tether) this.tether.visible = rovVisible;
      if (rovVisible && this.tether) {
        this.rov.position.copy(this.rovAt);
        this.rov.lookAt(this.rovAt.x * 3, this.rovAt.y, this.rovAt.z * 3);
        this.rov.scale.setScalar(Math.max(this.R / 25, 0.6));
        if (this.lamp) (this.lamp.material as MeshBasicMaterial).opacity = 0.16 * fade;
        const attribute = this.tether.geometry.getAttribute("position") as BufferAttribute;
        attribute.array.set([this.rovAt.x * 1.1, 0, this.rovAt.z * 1.1, this.rovAt.x, this.rovAt.y + 0.3, this.rovAt.z]);
        attribute.needsUpdate = true;
        (this.tether.material as LineBasicMaterial).opacity = 0.55 * fade;
      }
      this.renderer.render(this.scene, this.camera);
    }
    this.updatePins();
    this.drawOverlay();
  }

  // ------------------------------------------------------------------ overlay: grid, labels, fallback chart
  private drawOverlay(): void {
    const ctx = this.overlay.getContext("2d");
    if (!ctx) return;
    const ratio = this.overlay.width / this.width;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    if (!this.geo) return;
    const x = this.renderer ? this.linearX : 1;
    const alpha = this.renderer ? clamp((x - 0.72) / 0.28, 0, 1) : 1;
    if (this.renderer && alpha <= 0) return;
    const g = this.geo;
    const C = g.circumference_m;
    const p = this.renderer ? this.progress : 1;
    const point = new Vector3();
    const at = (u: number, y: number): [number, number] => this.project(this.place(u, y, p, point));
    this.camera.updateMatrixWorld();
    if (!this.renderer) {
      const [x0, y0] = at(-C / 2, 0);
      const [x1, y1] = at(C / 2, -this.D);
      const gradient = ctx.createLinearGradient(0, y0, 0, y1);
      gradient.addColorStop(0, "rgba(34,120,130,0.55)");
      gradient.addColorStop(1, "rgba(4,22,26,0.9)");
      ctx.fillStyle = gradient;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = "rgba(111,183,190,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const mesh = Math.max(4, Math.round(C / 1.7));
      for (let i = 0; i < mesh; i++) {
        const xa = lerp(x0, x1, i / mesh);
        const xb = lerp(x0, x1, (i + 1) / mesh);
        for (let j = 0; j < 8; j++) {
          const ya = lerp(y0, y1, j / 8);
          const yb = lerp(y0, y1, (j + 1) / 8);
          if ((i + j) % 2) {
            ctx.moveTo(xa, ya);
            ctx.lineTo(xb, yb);
          } else {
            ctx.moveTo(xa, yb);
            ctx.lineTo(xb, ya);
          }
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= g.grid.columns; c++) {
      const [xa, ya] = at(-C / 2 + c * g.grid.panel_width_m, 0);
      const [xb, yb] = at(-C / 2 + c * g.grid.panel_width_m, -this.D);
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
    }
    for (let r = 0; r <= g.grid.rows; r++) {
      const [xa, ya] = at(-C / 2, -r * g.grid.panel_height_m);
      const [xb, yb] = at(C / 2, -r * g.grid.panel_height_m);
      ctx.moveTo(xa, ya);
      ctx.lineTo(xb, yb);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    for (let c = 0; c < g.grid.columns; c++) {
      const [lx, ly] = at(-C / 2 + (c + 0.5) * g.grid.panel_width_m, 0);
      ctx.fillText(String.fromCharCode(65 + c), lx, ly - 4);
    }
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let r = 0; r < g.grid.rows; r++) {
      const [lx, ly] = at(-C / 2, -(r + 0.5) * g.grid.panel_height_m);
      ctx.fillText(String(r + 1), lx - 6, ly);
    }
    ctx.globalAlpha = 1;
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.listeners.clear();
  }
}

