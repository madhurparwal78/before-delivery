// The live 3D pen twin: net wall, collar, moorings, light shafts, particles,
// fish school and the ROV. Unwrap morphs the wall into the metre-true flat chart.

import * as THREE from 'three';
import { reducedMotion } from './ui';

export type ViewName = 'cylinder' | 'flat';

export interface PinPos {
  id: string;
  bearing: number;   // stored bearing
  depth: number;     // stored depth
  chartX: number;    // stored chart x
  chartY: number;    // stored depth (same as depth)
  removed: boolean;
}

export interface SceneCallbacks {
  onMarkTap?: (xM: number, yM: number, zM: number) => void;
  onPinTap?: (id: string) => void;
}

export type UnwrapState = 'cylinder' | 'unwrapping' | 'flat' | 'wrapping';

const CYL_SEGMENTS = 96;

let draggingNow = false;
export function setDragging(v: boolean) { draggingNow = v; }

export class PenScene {
  /** Called when an Unwrap or Wrap run settles, so the address records the view. */
  onSettle: (() => void) | null = null;
  renderer: THREE.WebGLRenderer | null = null;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private host: HTMLElement;
  private cb: SceneCallbacks;

  // pen geometry
  private radius = 25.5;
  private depth = 20;
  private circumference = 160;
  private columns = 16;
  private rows = 4;

  // camera orbit
  private azimuth = 0;      // degrees, bearing the camera faces
  private tilt = 8;          // degrees above level
  private zoom = 1.0;
  private glideFrom: { az: number; tl: number; z: number } | null = null;
  private glideTo: { az: number; tl: number; z: number } | null = null;
  private glideStart = 0;
  private glideDur = 1000;

  // unwrap
  unwrapProgress = 0;        // 0 = cylinder, 1 = flat
  private unwrapFrom = 0;
  private unwrapStart = 0;
  private unwrapDur = 1400;
  private unwrapReversed = false;
  state: UnwrapState = 'cylinder';

  // mesh pieces
  private wall!: THREE.Mesh;
  private wallGeo!: THREE.BufferGeometry;
  private baseCyl!: Float32Array;
  private baseFlat!: Float32Array;
  private collar!: THREE.Line;
  private moorings!: THREE.Group;
  private fishGroup!: THREE.Group;
  private fishData: { angle: number; radius: number; y: number; speed: number; phase: number }[] = [];
  private particles!: THREE.Points;
  private shafts!: THREE.Group;
  private rov!: THREE.Group;
  private rovTarget: THREE.Vector3 | null = null;
  private rovLerpStart: THREE.Vector3 | null = null;
  private rovLerpT = 0;

  // pins: DOM buttons positioned by projecting their world point
  pins: PinPos[] = [];
  private pinLayer: HTMLElement;
  private selectedId: string | null = null;
  private pulseStart = 0;

  private raf = 0;
  private running = false;
  private lastFrame = 0;
  private fishDirection = 1;
  private hiddenUntil = 0;

  constructor(container: HTMLElement, pinLayer: HTMLElement, cb: SceneCallbacks) {
    this.container = container;
    this.pinLayer = pinLayer;
    this.cb = cb;
    this.host = container;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.scene.fog = new THREE.FogExp2(0x000000, 0.022);
    this.scene.background = new THREE.Color(0x000000);

    this.setupLights();
    this.setupWater();
    this.pinLayer = pinLayer;
    this.bindInput();
  }

  setPen(spec: { circumference_m: number; net_depth_m: number; columns: number; rows: number; }) {
    this.circumference = spec.circumference_m;
    this.depth = spec.net_depth_m;
    this.columns = spec.columns;
    this.rows = spec.rows;
    this.radius = spec.circumference_m / (2 * Math.PI);
    this.buildMeshes();
    this.applyCamera();
  }

  private setupLights() {
    const amb = new THREE.AmbientLight(0x2a4a55, 0.55);
    this.scene.add(amb);
    const dir = new THREE.DirectionalLight(0x7fd4e0, 0.5);
    dir.position.set(20, 40, 10);
    this.scene.add(dir);
  }

  private setupWater() {
    // faint god-rays from the surface
    this.shafts = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const g = new THREE.PlaneGeometry(6 + i * 2, 46);
      const m = new THREE.MeshBasicMaterial({
        color: 0x1c5a66, transparent: true, opacity: 0.05,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const shaft = new THREE.Mesh(g, m);
      shaft.position.set(-18 + i * 9, 12, -6 - (i % 2) * 8);
      shaft.rotation.z = 0.08 * (i % 3 - 1);
      this.shafts.add(shaft);
    }
    this.scene.add(this.shafts);

    // particles drifting upwards
    const N = 260;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = -Math.random() * 40 + 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x6a8a99, size: 0.14, transparent: true, opacity: 0.45, depthWrite: false });
    this.particles = new THREE.Points(geo, mat);
    this.scene.add(this.particles);

    // mooring lines
    this.moorings = new THREE.Group();
    this.scene.add(this.moorings);

    // fish school
    this.fishGroup = new THREE.Group();
    this.scene.add(this.fishGroup);

    // ROV with a lamp cone
    this.rov = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.7, 1.6),
      new THREE.MeshBasicMaterial({ color: 0x9fb3bd })
    );
    this.rov.add(body);
    const lamp = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 7, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xaff0ff, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide })
    );
    lamp.position.set(0, 0, 4.2);
    lamp.rotation.x = -Math.PI / 2;
    this.rov.add(lamp);
    const tether = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 26, 4),
      new THREE.MeshBasicMaterial({ color: 0x51606c })
    );
    tether.position.y = 13;
    this.rov.add(tether);
    this.rov.position.set(0, -2, 0);
    this.scene.add(this.rov);
  }

  private buildMeshes() {
    // remove old
    for (const obj of [this.wall, this.collar].filter(Boolean)) this.scene.remove(obj);
    if (this.moorings) { this.scene.remove(this.moorings); this.moorings = new THREE.Group(); this.scene.add(this.moorings); }
    if (this.fishGroup) { this.scene.remove(this.fishGroup); this.fishGroup = new THREE.Group(); this.scene.add(this.fishGroup); }

    const cols = this.columns * 8;
    const rowsN = this.rows * 6;
    const positions: number[] = [];
    const indices: number[] = [];
    const cyl: number[] = [];
    const flat: number[] = [];

    const chartW = this.circumference;
    const chartH = this.depth;
    // scale so both views share metres-per-pixel: the flat chart's height is the net depth.
    const flatScale = this.depth / (this.depth * 1.0);

    for (let r = 0; r <= rowsN; r++) {
      const v = r / rowsN;
      const y = -v * this.depth;                 // 0 at collar, -depth at bottom
      for (let c = 0; c <= cols; c++) {
        const u = (c % cols) / cols;              // wraps
        const ang = u * Math.PI * 2;
        const x = Math.sin(ang) * this.radius;
        const z = Math.cos(ang) * this.radius;
        cyl.push(x, y, z);
        // flat: chart x from 0..chartW, depth downward; centred at origin, y up
        const fx = (u * chartW - chartW / 2);
        const fy = -v * chartH;
        flat.push(fx, fy, 0);
      }
    }
    for (let r = 0; r < rowsN; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        const b = a + 1;
        const d = (r + 1) * (cols + 1) + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    const geo = new THREE.BufferGeometry();
    this.baseCyl = new Float32Array(cyl);
    this.baseFlat = new Float32Array(flat);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cyl), 3));
    geo.setIndex(indices);
    // diamond net look: wireframe over a barely lit wall
    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x0d2b33, side: THREE.DoubleSide, transparent: true, opacity: 0.5,
    });
    this.wallGeo = geo;
    this.wall = new THREE.Mesh(geo, wallMat);
    this.scene.add(this.wall);

    // net lines: a second geometry drawn as lines gives the mesh texture
    const linePos: number[] = [];
    for (let r = 0; r <= rowsN; r += 2) {
      for (let c = 0; c <= cols; c++) {
        const i = r * (cols + 1) + c;
        linePos.push(cyl[i * 3], cyl[i * 3 + 1], cyl[i * 3 + 2]);
      }
    }
    // vertical strands
    for (let c = 0; c <= cols; c += 2) {
      for (let r = 0; r <= rowsN; r++) {
        const i = r * (cols + 1) + c;
        linePos.push(cyl[i * 3], cyl[i * 3 + 1], cyl[i * 3 + 2]);
      }
    }

    const collarGeo = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 97 }, (_, i) => {
        const a = (i / 96) * Math.PI * 2;
        return new THREE.Vector3(Math.sin(a) * this.radius, 0.2, Math.cos(a) * this.radius);
      })
    );
    this.collar = new THREE.Line(collarGeo, new THREE.LineBasicMaterial({ color: 0x9fd8e8 }));
    this.scene.add(this.collar);

    // moorings run out of frame
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const pts = [
        new THREE.Vector3(Math.sin(a) * this.radius * 0.99, 0, Math.cos(a) * this.radius * 0.99),
        new THREE.Vector3(Math.sin(a) * this.radius * 2.6, -this.depth * 0.5, Math.cos(a) * this.radius * 2.6),
      ];
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this.moorings.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x3b4c58 })));
    }

    // up to 60 fish
    const count = Math.min(60, 34 + Math.floor(Math.random() * 20));
    for (let i = 0; i < count; i++) {
      const size = 0.45 + Math.random() * 0.3;
      const fish = new THREE.Mesh(
        new THREE.ConeGeometry(size * 0.32, size * 1.6, 5),
        new THREE.MeshBasicMaterial({ color: 0x11242e })
      );
      fish.rotation.z = -Math.PI / 2;
      this.fishGroup.add(fish);
      this.fishData.push({
        angle: Math.random() * Math.PI * 2,
        radius: this.radius * (0.3 + Math.random() * 0.5),
        y: -2 - Math.random() * (this.depth - 6),
        speed: (0.10 + Math.random() * 0.05) * (Math.PI * 2 / 40),
        phase: Math.random() * Math.PI * 2,
      });
    }
    this.fishDirection = Math.random() < 0.5 ? 1 : -1;
  }

  // ---------- camera ----------

  setAzimuth(deg: number) { this.azimuth = ((deg % 360) + 360) % 360; this.applyCamera(); }
  getAzimuth(): number { return this.azimuth; }
  setTilt(deg: number) { this.tilt = Math.max(-40, Math.min(40, deg)); this.applyCamera(); }
  getTilt(): number { return this.tilt; }
  setZoom(z: number) { this.zoom = Math.max(0.5, Math.min(3.0, z)); this.applyCamera(); }
  getZoom(): number { return this.zoom; }

  glideToView(az: number, tl: number, z: number, durationMs = 1000) {
    if (reducedMotion()) {
      this.azimuth = az; this.tilt = tl; this.zoom = z;
      this.applyCamera();
      return;
    }
    let targetAz = az;
    // shortest wrap path
    const cur = this.azimuth;
    let delta = (targetAz - cur) % 360;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    this.glideFrom = { az: cur, tl: this.tilt, z: this.zoom };
    this.glideTo = { az: cur + delta, tl, z };
    this.glideStart = performance.now();
    this.glideDur = Math.max(700, Math.min(1400, durationMs));
  }

  private applyCamera() {
    const target = new THREE.Vector3(0, -this.depth * 0.28, 0);
    const flat = this.unwrapProgress > 0.999;
    if (flat) {
      const dist = (this.circumference * 0.62) / this.zoom;
      this.camera.position.set(0, this.depth * 0.34, dist);
      this.camera.lookAt(0, -this.depth * 0.28, 0);
    } else {
      const a = (this.azimuth * Math.PI) / 180;
      const d = (this.radius * 3.1) / this.zoom;
      const y = this.depth * 0.28 + (this.tilt / 40) * this.depth * 0.9;
      this.camera.position.set(Math.sin(a) * d, y - this.depth * 0.2, Math.cos(a) * d);
      this.camera.lookAt(target);
    }
  }

  // ---------- unwrap ----------

  unwrap(reduced: boolean) {
    if (this.state === 'flat' || this.state === 'unwrapping') return;
    if (reduced) {
      this.unwrapProgress = 1;
      this.state = 'flat';
      this.morph(1);
      this.applyCamera();
      return;
    }
    this.unwrapFrom = this.unwrapProgress;
    this.unwrapStart = performance.now();
    this.unwrapReversed = false;
    this.state = 'unwrapping';
    this.running = true;
  }

  wrap(reduced: boolean) {
    if (this.state === 'cylinder' || this.state === 'wrapping') return;
    if (reduced) {
      this.unwrapProgress = 0;
      this.state = 'cylinder';
      this.morph(0);
      this.applyCamera();
      return;
    }
    // Reversing plays the progress made so far back at the pace it was made.
    const p = this.unwrapProgress;
    const remaining = p * this.unwrapDur;
    const dur = Math.max(300, Math.min(800, remaining));
    this.unwrapFrom = p;
    this.unwrapStart = performance.now();
    this.unwrapDur = dur;
    this.unwrapReversed = true;
    this.state = 'wrapping';
    this.running = true;
  }

  get unwrapping(): boolean { return this.state === 'unwrapping' || this.state === 'wrapping'; }

  /** The flat chart shown at once, for a load or the reduced-motion end state. */
  showFlat(instant: boolean) {
    this.unwrapProgress = 1;
    this.state = 'flat';
    this.morph(1);
    if (instant) this.applyCamera();
  }

  /** The cylinder shown at once. */
  showCylinder(instant: boolean) {
    this.unwrapProgress = 0;
    this.state = 'cylinder';
    this.morph(0);
    if (instant) this.applyCamera();
  }

  private ease(t: number): number {
    // fast start, long soft settle
    return 1 - Math.pow(1 - t, 3);
  }

  private morph(p: number) {
    const pos = this.wallGeo.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const n = this.baseCyl.length;
    const e = this.ease(p);
    for (let i = 0; i < n; i++) {
      const c = this.baseCyl[i];
      const f = this.baseFlat[i];
      // cut edges swing outward: nothing extra needed; the far side comes forward via flat positions
      arr[i] = c + (f - c) * e;
    }
    pos.needsUpdate = true;
    this.wallGeo.computeBoundingSphere();
    // collar straightens into the chart's top edge
    const collarGeo = this.collar.geometry as THREE.BufferGeometry;
    const cp = collarGeo.getAttribute('position') as THREE.BufferAttribute;
    const carr = cp.array as Float32Array;
    const chartW = this.circumference;
    for (let i = 0; i < 97; i++) {
      const u = i / 96;
      const a = u * Math.PI * 2;
      const cx = Math.sin(a) * this.radius;
      const cz = Math.cos(a) * this.radius;
      const fx = u * chartW - chartW / 2;
      carr[i * 3] = cx + (fx - cx) * e;
      carr[i * 3 + 1] = 0.2;
      carr[i * 3 + 2] = cz * (1 - e);
    }
    cp.needsUpdate = true;
    // moorings and fish fade out on the way to the chart
    this.moorings.visible = e < 0.98;
    this.fishGroup.visible = e < 0.98;
    this.shafts.visible = e < 0.9;
  }

  // ---------- pins ----------

  setPins(pins: PinPos[]) {
    this.pins = pins;
    this.renderPins();
  }

  setSelected(id: string | null) {
    this.selectedId = id;
    if (id) this.pulseStart = performance.now();
    this.renderPins();
  }

  private projectChart(p: PinPos): { x: number; y: number } | null {
    const el = this.host;
    const w = el.clientWidth, hgt = el.clientHeight;
    const chartW = this.circumference, chartH = this.depth;
    const scale = Math.min((w * 0.9) / chartW, (hgt * 0.68) / chartH);
    const cx = w / 2, cy = hgt / 2 + hgt * 0.08;
    return { x: cx + (p.chartX - chartW / 2) * scale, y: cy + p.chartY * scale };
  }

  private renderPins() {
    if (!this.renderer) return;
    const layer = this.pinLayer;
    for (const child of Array.from(layer.children)) child.remove();
    if (this.unwrapProgress > 0.999) {
      for (const p of this.pins) {
        if (p.removed) continue;
        const pt = this.projectChart(p);
        if (!pt) continue;
        this.addPinButton(p.id, pt.x, pt.y);
      }
      return;
    }
    for (const p of this.pins) {
      if (p.removed) continue;
      const a = (p.bearing * Math.PI) / 180;
      const world = new THREE.Vector3(Math.sin(a) * this.radius, -p.depth, Math.cos(a) * this.radius);
      const v = world.clone().project(this.camera);
      const el = this.host;
      const x = (v.x * 0.5 + 0.5) * el.clientWidth;
      const y = (-v.y * 0.5 + 0.5) * el.clientHeight;
      if (v.z > 1) continue;
      this.addPinButton(p.id, x, y);
    }
  }

  private addPinButton(id: string, x: number, y: number) {
    const btn = document.createElement('button');
    btn.className = 'pin';
    btn.setAttribute('aria-label', `Pin ${id}`);
    btn.style.left = `${x}px`;
    btn.style.top = `${y}px`;
    if (id === this.selectedId) btn.setAttribute('aria-pressed', 'true');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cb.onPinTap?.(id);
    });
    this.pinLayer.append(btn);
  }

  /** The wall point under client coordinates, in the pen frame. */
  wallPointAt(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    return this.pickWallPoint(clientX, clientY);
  }

  // ---------- input ----------

  private bindInput() {
    let dragging = false;
    let lastX = 0, lastY = 0;
    let pinching = false;
    let pinchDist = 0;
    const touches = new Map<number, { x: number; y: number }>();

    const onDown = (x: number, y: number) => { dragging = true; setDragging(true); lastX = x; lastY = y; };
    const onMove = (x: number, y: number) => {
      if (!dragging) return;
      const dx = x - lastX, dy = y - lastY;
      lastX = x; lastY = y;
      const el = this.host;
      if (this.unwrapProgress > 0.999) {
        // pan the flat chart via zoom/tilt approximation: adjust camera x offset
        this.camera.position.x -= dx * (this.circumference / el.clientWidth) * 0.5;
        this.camera.position.y += dy * (this.depth / el.clientHeight) * 0.5;
      } else {
        const degPerPx = 180 / el.clientWidth;
        this.setAzimuth(this.azimuth + dx * degPerPx);
        this.setTilt(this.tilt + dy * -0.15);
      }
    };

    this.host.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (touches.size === 2) {
          pinching = true; dragging = false;
          const [a, b] = Array.from(touches.values());
          pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        } else {
          onDown(e.clientX, e.clientY);
        }
      } else {
        onDown(e.clientX, e.clientY);
      }
    });
    this.host.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pinching && touches.size === 2) {
          const [a, b] = Array.from(touches.values());
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchDist > 0) {
            const factor = d / pinchDist;
            this.setZoom(this.zoom * factor);
          }
          pinchDist = d;
          return;
        }
      }
      onMove(e.clientX, e.clientY);
    });
    const endPointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId);
        if (touches.size < 2) pinching = false;
        if (touches.size === 0) { dragging = false; setDragging(false); }
      } else {
        dragging = false; setDragging(false);
      }
    };
    this.host.addEventListener('pointerup', endPointer);
    this.host.addEventListener('pointercancel', endPointer);

    this.host.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1.0 / 1.12 : 1.12;
      this.setZoom(this.zoom * dir);
    }, { passive: false });

    this.host.addEventListener('click', (e) => {
      // marking mode: convert the click into the pen frame
      if (this.markingMode) {
        const pt = this.pickWallPoint(e.clientX, e.clientY);
        if (pt) this.cb.onMarkTap?.(pt.x, pt.y, pt.z);
      }
    });
  }

  markingMode = false;
  setMarking(on: boolean) { this.markingMode = on; }

  /** The net-wall point under a client point, in metres from the pen centre. */
  private pickWallPoint(clientX: number, clientY: number): { x: number; y: number; z: number } | null {
    if (!this.renderer) return null;
    const rect = this.host.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObject(this.wall, false);
    if (!hits.length) return null;
    const p = hits[0].point;
    // world -> pen frame: z_m towards 0°, x_m towards 90°, y_m up (negative below collar)
    return { x: p.x, y: p.y, z: p.z };
  }

  // ---------- ROV ----------

  parkRov() {
    this.rovTarget = null;
    this.rov.position.set(0, -2, 0);
  }

  flyRovToDefect(bearing: number, depth: number, instant: boolean) {
    const a = (bearing * Math.PI) / 180;
    const r = this.radius - 2.2;
    const target = new THREE.Vector3(Math.sin(a) * r, -depth, Math.cos(a) * r);
    if (instant) {
      this.rov.position.copy(target);
      this.rovTarget = null;
      return;
    }
    this.rovLerpStart = this.rov.position.clone();
    this.rovTarget = target;
    this.rovLerpT = 0;
  }

  // ---------- render loop ----------

  ensureRenderer(): boolean {
    if (this.renderer) return true;
    // Decide before constructing: without a WebGL context there is no 3D twin.
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') ?? probe.getContext('webgl');
      if (!gl) return false;
    } catch {
      return false;
    }
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      this.renderer = null;
      return false;
    }
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(this.host.clientWidth, this.host.clientHeight, false);
    const canvas = this.renderer.domElement;
    canvas.style.width = '100%'; canvas.style.height = '100%';
    canvas.setAttribute('role', 'img');
    this.host.prepend(canvas);
    this.resize();
    return true;
  }


  resize() {
    if (!this.renderer) return;
    const w = this.host.clientWidth, hgt = this.host.clientHeight;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / Math.max(1, hgt);
    this.camera.updateProjectionMatrix();
  }

  start() {
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (!this.renderer) return;
      const dt = Math.min(50, t - this.lastFrame);
      this.lastFrame = t;
      this.tick(t, dt);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick(t: number, dt: number) {
    // glide
    if (this.glideTo && this.glideFrom) {
      const p = Math.min(1, (t - this.glideStart) / this.glideDur);
      const e = p < 1 ? (1 - Math.pow(1 - p, 2)) : 1;
      this.azimuth = this.glideFrom.az + (this.glideTo.az - this.glideFrom.az) * e;
      this.tilt = this.glideFrom.tl + (this.glideTo.tl - this.glideFrom.tl) * e;
      this.zoom = this.glideFrom.z + (this.glideTo.z - this.glideFrom.z) * e;
      if (p >= 1) { this.glideFrom = null; this.glideTo = null; }
      this.applyCamera();
    }

    // unwrap progress
    if (this.state === 'unwrapping' || this.state === 'wrapping') {
      const p = Math.min(1, (t - this.unwrapStart) / this.unwrapDur);
      if (this.unwrapReversed) {
        this.unwrapProgress = this.unwrapFrom * (1 - this.ease(p));
      } else {
        this.unwrapProgress = this.unwrapFrom + (1 - this.unwrapFrom) * this.ease(p);
      }
      this.morph(this.unwrapProgress);
      this.applyCamera();
      if (p >= 1) {
        this.unwrapProgress = this.unwrapReversed ? 0 : 1;
        this.state = this.unwrapReversed ? 'cylinder' : 'flat';
        this.onSettle?.();
      }
    }

    // ambient loops stop under reduced motion
    if (!reducedMotion()) {
      // fish school circles once every 30-60s
      for (let i = 0; i < this.fishData.length; i++) {
        const f = this.fishData[i];
        f.angle += f.speed * dt * 0.001 * this.fishDirection * (40 / 45);
        const wob = Math.sin(t * 0.001 + f.phase) * 0.4;
        const fish = this.fishGroup.children[i] as THREE.Mesh;
        if (fish) {
          fish.position.set(
            Math.sin(f.angle) * f.radius,
            f.y + wob,
            Math.cos(f.angle) * f.radius
          );
          fish.rotation.y = -f.angle + (this.fishDirection > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
      // particles drift upwards, crossing the stage in 20-40s
      const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const rise = (dt / 28000) * 40;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += rise * (0.7 + ((i % 7) / 7) * 0.6);
        if (arr[i] > 20) arr[i] = -22;
      }
      pos.needsUpdate = true;
      // light shafts sway once every 8-12s
      this.shafts.rotation.z = Math.sin((t / 10000) * Math.PI * 2) * 0.06;
    }

    // ROV glide
    if (this.rovTarget && this.rovLerpStart) {
      this.rovLerpT = Math.min(1, this.rovLerpT + dt / 1000);
      const e = 1 - Math.pow(1 - this.rovLerpT, 2);
      this.rov.position.lerpVectors(this.rovLerpStart, this.rovTarget, e);
      if (this.rovLerpT >= 1) { this.rovTarget = null; this.rovLerpStart = null; }
    }
    this.rov.lookAt(this.camera.position);

    // pins ride their vertices; refresh positions as the camera settles
    if (t - (this.lastPinRefresh ?? 0) > 33) {
      this.lastPinRefresh = t;
      if (this.unwrapProgress > 0.001 || this.unwrapping || this.glideTo || draggingNow) {
        this.renderPins();
      }
    }
  }

  private lastPinRefresh = 0;

  renderOnce() {
    this.renderPins();
  }

  dispose() {
    this.stop();
    this.renderer?.dispose();
    this.renderer = null;
  }
}

