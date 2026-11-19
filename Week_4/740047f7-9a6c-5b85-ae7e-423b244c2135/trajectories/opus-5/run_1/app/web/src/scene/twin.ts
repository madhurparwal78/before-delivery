import {
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  BufferGeometry,
  Color,
  ConeGeometry,
  Fog,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { h, reducedMotion } from "../dom";

const GROUND = 0x060708;
const WATER = 0x2e6f78;

export interface PenGeometrySpec {
  circumference_m: number;
  net_depth_m: number;
  columns: number;
  rows: number;
}

export interface SceneDefect {
  id: string;
  bearing_deg: number;
  depth_m: number;
  chart_x_m: number;
  chart_y_m: number;
}

export type ViewName = "cylinder" | "unwrapping" | "flat" | "wrapping";

const UNWRAP_MS = 1400;
const FLY_MS = 900;
const SEGMENTS_U = 96;
const SEGMENTS_V = 24;
const MAX_FISH = 60;

function columnLetter(index: number): string {
  let remaining = index;
  let letters = "";
  for (;;) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
    if (remaining < 0) return letters;
  }
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/// A soft-edged shaft of light falling from the surface.
function shaftCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) return canvas;
  const across = context.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, "rgba(255,255,255,0)");
  across.addColorStop(0.5, "rgba(255,255,255,1)");
  across.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = across;
  context.fillRect(0, 0, 64, 256);
  const down = context.createLinearGradient(0, 0, 0, 256);
  down.addColorStop(0, "rgba(0,0,0,0)");
  down.addColorStop(1, "rgba(0,0,0,1)");
  context.globalCompositeOperation = "destination-out";
  context.fillStyle = down;
  context.fillRect(0, 0, 64, 256);
  return canvas;
}

interface StageOptions {
  onSelect: (id: string) => void;
  onWallPoint: (point: { x_m: number; y_m: number; z_m: number }) => void;
  onChange: () => void;
  interactive: boolean;
}

/// The live 3D twin of one pen: net wall, collar, moorings, light shafts,
/// particles, fish and the ROV, with one pin button per defect.
export class PenStage {
  readonly webgl: boolean;
  private host: HTMLElement;
  private options: StageOptions;
  private canvas: HTMLCanvasElement;
  private pinLayer: HTMLElement;
  private labelLayer: HTMLElement;
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(42, 1, 0.5, 4000);
  private pen: PenGeometrySpec = {
    circumference_m: 160,
    net_depth_m: 20,
    columns: 16,
    rows: 4,
  };
  private defects: SceneDefect[] = [];
  private pins = new Map<string, HTMLButtonElement>();
  private selected: string | null = null;
  private marking = false;

  private azimuth = 0;
  private elevation = 12;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private morph = 0;
  private runDirection = 0;
  private runElapsed = 0;
  private runFrom: 0 | 1 = 0;
  private flight: { from: number; to: number; started: number } | null = null;

  private net: LineSegments | null = null;
  private netU = new Float32Array(0);
  private netV = new Float32Array(0);
  private collar: Line | null = null;
  private collarU = new Float32Array(0);
  private moorings = new Group();
  private shafts = new Group();
  private particles: Points | null = null;
  private fish = new Group();
  private rov = new Group();
  private gridLines = new Group();
  private clock = 0;
  private frame = 0;
  private observer: ResizeObserver | null = null;
  private stopped = false;

  constructor(host: HTMLElement, options: StageOptions) {
    this.host = host;
    this.options = options;
    this.canvas = h("canvas", { role: "img", "aria-label": "3D twin" });
    this.pinLayer = h("div", { class: "pin-layer" });
    this.labelLayer = h("div", { class: "grid-labels", "aria-hidden": "true" });
    host.appendChild(this.canvas);
    host.appendChild(this.labelLayer);
    host.appendChild(this.pinLayer);
    this.webgl = this.createRenderer();
    if (this.webgl) {
      this.buildScene();
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.morph = 1;
    }
    if (options.interactive) this.bindPointer();
    window.addEventListener("resize", this.resize);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
  }

  private createRenderer(): boolean {
    try {
      const renderer = new WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
      });
      renderer.setClearColor(new Color(GROUND), 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      this.renderer = renderer;
      return true;
    } catch {
      this.renderer = null;
      return false;
    }
  }

  private radius(): number {
    return this.pen.circumference_m / (2 * Math.PI);
  }

  /// A point on the net wall, from the cylinder (morph 0) to the flat chart
  /// (morph 1). 0° is the chart's left edge and the circumference its right.
  private wallPosition(u: number, v: number, morph: number, out: Vector3): Vector3 {
    const bearing = u * Math.PI * 2;
    const radius = this.radius();
    // Bearings run leftwards across the stage, so the unwrap never folds the
    // wall through itself: 0° ends at the chart's left edge.
    const cx = -radius * Math.sin(bearing);
    const cz = radius * Math.cos(bearing);
    const fx = u * this.pen.circumference_m - this.pen.circumference_m / 2;
    const y = -v * this.pen.net_depth_m;
    out.set(cx + (fx - cx) * morph, y, cz * (1 - morph));
    return out;
  }

  private buildNet(): void {
    const vertices: number[] = [];
    const us: number[] = [];
    const vs: number[] = [];
    const push = (u: number, v: number) => {
      us.push(u);
      vs.push(v);
      vertices.push(0, 0, 0);
    };
    for (let i = 0; i < SEGMENTS_U; i += 1) {
      for (let j = 0; j < SEGMENTS_V; j += 1) {
        const u0 = i / SEGMENTS_U;
        const u1 = (i + 1) / SEGMENTS_U;
        const v0 = j / SEGMENTS_V;
        const v1 = (j + 1) / SEGMENTS_V;
        push(u0, v0);
        push(u1, v1);
        push(u1, v0);
        push(u0, v1);
      }
    }
    this.netU = new Float32Array(us);
    this.netV = new Float32Array(vs);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
    const material = new LineBasicMaterial({
      color: new Color(WATER).lerp(new Color(0xffffff), 0.3),
      transparent: true,
      opacity: 0.26,
      fog: true,
    });
    this.net = new LineSegments(geometry, material);
    this.scene.add(this.net);

    const collarVertices: number[] = [];
    const collarU: number[] = [];
    for (let i = 0; i <= SEGMENTS_U; i += 1) {
      collarU.push(i / SEGMENTS_U);
      collarVertices.push(0, 0, 0);
    }
    this.collarU = new Float32Array(collarU);
    const collarGeometry = new BufferGeometry();
    collarGeometry.setAttribute(
      "position",
      new BufferAttribute(new Float32Array(collarVertices), 3),
    );
    this.collar = new Line(
      collarGeometry,
      new LineBasicMaterial({ color: 0xdfe6e8, transparent: true, opacity: 0.85 }),
    );
    this.scene.add(this.collar);
  }

  private buildScene(): void {
    this.scene.fog = new Fog(GROUND, this.radius() * 1.2, this.radius() * 7);
    this.scene.background = new Color(GROUND);
    this.buildNet();

    for (let i = 0; i < 4; i += 1) {
      const bearing = (Math.PI / 2) * i + Math.PI / 4;
      const geometry = new BufferGeometry();
      const radius = this.radius();
      geometry.setAttribute(
        "position",
        new BufferAttribute(
          new Float32Array([
            -radius * Math.sin(bearing),
            0,
            radius * Math.cos(bearing),
            -radius * 5 * Math.sin(bearing),
            -this.pen.net_depth_m * 1.8,
            radius * 5 * Math.cos(bearing),
          ]),
          3,
        ),
      );
      this.moorings.add(
        new Line(
          geometry,
          new LineBasicMaterial({ color: 0x8f949b, transparent: true, opacity: 0.5 }),
        ),
      );
    }
    this.scene.add(this.moorings);

    const shaftTexture = new CanvasTexture(shaftCanvas());
    for (let i = 0; i < 5; i += 1) {
      const shaft = new Mesh(
        new PlaneGeometry(this.radius() * 0.55, this.pen.net_depth_m * 3.4),
        new MeshBasicMaterial({
          color: new Color(WATER).lerp(new Color(0xffffff), 0.7),
          map: shaftTexture,
          transparent: true,
          opacity: 0.075,
          blending: AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      shaft.position.set(
        (i - 2) * this.radius() * 0.72,
        -this.pen.net_depth_m * 0.6,
        -this.radius() * 1.4,
      );
      this.shafts.add(shaft);
    }
    this.scene.add(this.shafts);

    const count = 320;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * this.radius() * 3;
      positions[i * 3 + 1] = -Math.random() * this.pen.net_depth_m * 1.4;
      positions[i * 3 + 2] = (Math.random() - 0.5) * this.radius() * 3;
    }
    const particleGeometry = new BufferGeometry();
    particleGeometry.setAttribute("position", new BufferAttribute(positions, 3));
    this.particles = new Points(
      particleGeometry,
      new PointsMaterial({
        color: 0xc8d6d8,
        size: 0.14,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.scene.add(this.particles);

    const fishGeometry = new ConeGeometry(0.16, 0.7, 5);
    for (let i = 0; i < MAX_FISH; i += 1) {
      const body = new Mesh(
        fishGeometry,
        new MeshBasicMaterial({ color: 0x10181a, transparent: true }),
      );
      body.userData["offset"] = (i / MAX_FISH) * Math.PI * 2;
      body.userData["ring"] = 0.45 + (i % 5) * 0.08;
      body.userData["depth"] = -2 - (i % 7) * 1.6;
      this.fish.add(body);
    }
    this.scene.add(this.fish);

    const hull = new Mesh(
      new PlaneGeometry(0.9, 0.5),
      new MeshBasicMaterial({ color: 0xe8eef0 }),
    );
    const lamp = new Mesh(
      new ConeGeometry(0.9, 2.6, 16, 1, true),
      new MeshBasicMaterial({
        color: 0xdff0f2,
        transparent: true,
        opacity: 0.12,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    lamp.rotation.x = Math.PI / 2;
    lamp.position.z = -1.4;
    this.rov.add(hull);
    this.rov.add(lamp);
    this.scene.add(this.rov);
    this.scene.add(this.gridLines);
    this.buildGridLines();
    this.resize();
  }

  /// The flat chart's panel grid lines, shown only in the flat-chart view.
  private buildGridLines(): void {
    this.gridLines.clear();
    const material = new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.22,
    });
    const width = this.pen.circumference_m;
    const depth = this.pen.net_depth_m;
    for (let column = 0; column <= this.pen.columns; column += 1) {
      const x = (column / this.pen.columns) * width - width / 2;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([x, 0, 0.05, x, -depth, 0.05]), 3),
      );
      this.gridLines.add(new Line(geometry, material));
    }
    for (let row = 0; row <= this.pen.rows; row += 1) {
      const y = -(row / this.pen.rows) * depth;
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array([-width / 2, y, 0.05, width / 2, y, 0.05]), 3),
      );
      this.gridLines.add(new Line(geometry, material));
    }
  }

  setPen(pen: PenGeometrySpec, defects: SceneDefect[]): void {
    const sameShape =
      pen.circumference_m === this.pen.circumference_m &&
      pen.net_depth_m === this.pen.net_depth_m &&
      pen.columns === this.pen.columns &&
      pen.rows === this.pen.rows;
    this.pen = pen;
    this.defects = defects;
    if (this.webgl && !sameShape) {
      this.scene.clear();
      this.moorings = new Group();
      this.shafts = new Group();
      this.fish = new Group();
      this.rov = new Group();
      this.gridLines = new Group();
      this.buildScene();
    }
    this.syncPins();
    if (!this.webgl) this.drawFallback();
  }

  private syncPins(): void {
    const seen = new Set<string>();
    for (const defect of this.defects) {
      seen.add(defect.id);
      let pin = this.pins.get(defect.id);
      if (!pin) {
        pin = h("button", {
          type: "button",
          class: "pin",
          "aria-label": `Pin ${defect.id}`,
          "aria-pressed": "false",
        });
        const id = defect.id;
        pin.addEventListener("click", () => this.options.onSelect(id));
        this.pins.set(id, pin);
        this.pinLayer.appendChild(pin);
      }
      pin.setAttribute("aria-pressed", this.selected === defect.id ? "true" : "false");
    }
    for (const [id, pin] of [...this.pins]) {
      if (!seen.has(id)) {
        pin.remove();
        this.pins.delete(id);
      }
    }
    this.placePins();
  }

  /// The canvas is the twin: it carries the image role and the pen's name.
  setPenLabel(penName: string): void {
    this.canvas.setAttribute("aria-label", `3D twin of ${penName}`);
  }

  pinFor(id: string): HTMLButtonElement | null {
    return this.pins.get(id) ?? null;
  }

  setSelected(id: string | null): void {
    this.selected = id;
    for (const [pinId, pin] of this.pins) {
      pin.setAttribute("aria-pressed", pinId === id ? "true" : "false");
    }
  }

  setMarking(on: boolean): void {
    this.marking = on;
  }

  view(): ViewName {
    if (this.runDirection !== 0) {
      // The wall is unwrapping whenever the morph is on its way to the chart.
      return this.runDirection > 0 ? "unwrapping" : "wrapping";
    }
    return this.morph >= 0.5 ? "flat" : "cylinder";
  }

  settledView(): "cylinder" | "flat" {
    if (this.runDirection !== 0) {
      return this.runFrom === 0 ? "cylinder" : "flat";
    }
    return this.morph >= 0.5 ? "flat" : "cylinder";
  }

  /// The view the stage is heading for: the destination mid-run, otherwise the
  /// settled view. The Unwrap/Wrap control follows it, so the opposite control
  /// is always there to reverse a run.
  controlTarget(): "cylinder" | "flat" {
    if (this.runDirection !== 0) {
      return this.runDirection > 0 ? "flat" : "cylinder";
    }
    return this.morph >= 0.5 ? "flat" : "cylinder";
  }

  cameraAzimuth(): number {
    const value = Math.round(this.azimuth);
    return ((value % 360) + 360) % 360;
  }

  zoomLevel(): number {
    return this.zoom;
  }

  /// Unwrap and Wrap follow elapsed time, and pressing the opposite control
  /// mid-run plays the progress made so far back at the pace it was made.
  unwrap(): void {
    this.startRun(1);
  }

  wrap(): void {
    this.startRun(0);
  }

  private startRun(target: 0 | 1): void {
    if (!this.webgl) return;
    if (this.runDirection !== 0) {
      const heading: 0 | 1 = this.runFrom === 0 ? 1 : 0;
      if (heading !== target) {
        this.runDirection = -this.runDirection;
        this.options.onChange();
      }
      return;
    }
    if (this.morph === target) return;
    if (reducedMotion()) {
      this.settle(target);
      return;
    }
    this.runFrom = target === 1 ? 0 : 1;
    this.runElapsed = target === 1 ? 0 : UNWRAP_MS;
    this.runDirection = target === 1 ? 1 : -1;
    this.flight = null;
    this.azimuth = 0;
    this.options.onChange();
  }

  private settle(target: 0 | 1): void {
    this.runDirection = 0;
    this.morph = target;
    this.runElapsed = target === 1 ? UNWRAP_MS : 0;
    if (target === 1) {
      this.panX = 0;
      this.panY = 0;
      this.azimuth = 0;
    }
    this.options.onChange();
  }

  /// Loading an address shows its end state in a single frame.
  setView(target: "cylinder" | "flat"): void {
    this.runDirection = 0;
    this.morph = target === "flat" ? 1 : 0;
    this.runElapsed = this.morph * UNWRAP_MS;
  }

  faceBearing(bearing: number): void {
    this.flight = null;
    this.azimuth = ((bearing % 360) + 360) % 360;
  }

  flyTo(id: string, animated: boolean): void {
    const defect = this.defects.find((entry) => entry.id === id);
    if (!defect) return;
    if (this.morph >= 0.5) {
      this.panX = 0;
      this.panY = 0;
      this.options.onChange();
      return;
    }
    if (!animated || reducedMotion()) {
      this.faceBearing(defect.bearing_deg);
      this.options.onChange();
      return;
    }
    const delta = ((defect.bearing_deg - this.azimuth + 540) % 360) - 180;
    this.flight = {
      from: this.azimuth,
      to: this.azimuth + delta,
      started: performance.now(),
    };
  }

  orbit(deltaAzimuth: number, deltaElevation: number): void {
    this.flight = null;
    this.azimuth = (((this.azimuth + deltaAzimuth) % 360) + 360) % 360;
    this.elevation = Math.max(-40, Math.min(40, this.elevation + deltaElevation));
    this.options.onChange();
  }

  panByPanels(columns: number, rows: number): void {
    this.panX += (columns * this.pen.circumference_m) / this.pen.columns;
    this.panY += (rows * this.pen.net_depth_m) / this.pen.rows;
    this.options.onChange();
  }

  zoomBy(step: number): void {
    const next = Math.round((this.zoom + step) * 100) / 100;
    this.zoom = Math.max(0.5, Math.min(3, next));
    this.options.onChange();
    if (!this.webgl) this.drawFallback();
  }

  destroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    window.removeEventListener("resize", this.resize);
    this.renderer?.dispose();
  }

  private bindPointer(): void {
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinchDistance = 0;

    this.host.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        dragging = false;
        return;
      }
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      this.host.setPointerCapture(event.pointerId);
    });
    this.host.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDistance > 0 && Math.abs(distance - pinchDistance) > 14) {
          this.zoomBy(distance > pinchDistance ? 0.25 : -0.25);
          pinchDistance = distance;
        }
        return;
      }
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      lastX = event.clientX;
      lastY = event.clientY;
      const width = this.host.clientWidth || 1;
      if (this.morph >= 0.5) {
        this.panX -= (dx / width) * this.visibleWidth();
        this.panY += (dy / width) * this.visibleWidth();
        this.options.onChange();
        if (!this.webgl) this.drawFallback();
      } else {
        // A drag left across the full stage width raises the azimuth by 180°.
        this.orbit((-dx / width) * 180, (dy / width) * 90);
      }
    });
    this.host.addEventListener("pointerup", (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchDistance = 0;
      if (dragging && !moved && this.marking) this.markFromPointer(event);
      dragging = false;
    });
    this.host.addEventListener("pointercancel", (event) => {
      pointers.delete(event.pointerId);
      dragging = false;
    });
    this.host.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoomBy(event.deltaY < 0 ? 0.25 : -0.25);
      },
      { passive: false },
    );
  }

  /// A tap on the net wall becomes a point in the pen's own frame.
  private markFromPointer(event: PointerEvent): void {
    const rect = this.host.getBoundingClientRect();
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    const radius = this.radius();
    let bearing: number;
    let depth: number;
    if (this.morph >= 0.5) {
      const visibleW = this.visibleWidth();
      const visibleH = visibleW / (this.camera.aspect || 1);
      const worldX = this.panX + (nx * visibleW) / 2;
      const worldY = -this.pen.net_depth_m / 2 + this.panY + (ny * visibleH) / 2;
      const chartX = worldX + this.pen.circumference_m / 2;
      bearing = ((chartX / this.pen.circumference_m) * 360 + 360) % 360;
      depth = -worldY;
    } else {
      bearing = this.azimuth + nx * -55;
      depth = ((1 - ny) / 2) * this.pen.net_depth_m;
    }
    depth = Math.max(0, Math.min(this.pen.net_depth_m, depth));
    const radians = (bearing * Math.PI) / 180;
    this.options.onWallPoint({
      x_m: -radius * Math.sin(radians),
      y_m: -depth,
      z_m: radius * Math.cos(radians),
    });
  }

  private visibleWidth(): number {
    return (this.pen.circumference_m * 1.08) / this.zoom;
  }

  private resize = (): void => {
    if (!this.renderer) {
      this.drawFallback();
      return;
    }
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private tick = (now: number): void => {
    if (this.stopped) return;
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden || !this.renderer) return;
    const delta = Math.min(50, now - (this.clock || now));
    this.clock = now;

    if (this.runDirection !== 0) {
      this.runElapsed += delta * this.runDirection;
      if (this.runElapsed >= UNWRAP_MS) {
        this.settle(1);
      } else if (this.runElapsed <= 0) {
        this.settle(0);
      } else {
        this.morph = easeOut(this.runElapsed / UNWRAP_MS);
        this.options.onChange();
      }
    }
    if (this.flight) {
      const progress = Math.min(1, (now - this.flight.started) / FLY_MS);
      const value =
        this.flight.from + (this.flight.to - this.flight.from) * easeOut(progress);
      this.azimuth = ((value % 360) + 360) % 360;
      if (progress >= 1) this.flight = null;
      this.options.onChange();
    }

    this.updateWall();
    this.updateAmbient(now);
    this.updateCamera();
    this.renderer.render(this.scene, this.camera);
    this.updateGridLabels();
    this.placePins();
  };

  private updateWall(): void {
    if (!this.net || !this.collar) return;
    const attribute = this.net.geometry.getAttribute("position") as BufferAttribute;
    const array = attribute.array as Float32Array;
    const point = new Vector3();
    for (let i = 0; i < this.netU.length; i += 1) {
      this.wallPosition(this.netU[i], this.netV[i], this.morph, point);
      array[i * 3] = point.x;
      array[i * 3 + 1] = point.y;
      array[i * 3 + 2] = point.z;
    }
    attribute.needsUpdate = true;

    const collarAttribute = this.collar.geometry.getAttribute("position") as BufferAttribute;
    const collarArray = collarAttribute.array as Float32Array;
    for (let i = 0; i < this.collarU.length; i += 1) {
      this.wallPosition(this.collarU[i], 0, this.morph, point);
      collarArray[i * 3] = point.x;
      collarArray[i * 3 + 1] = point.y;
      collarArray[i * 3 + 2] = point.z;
    }
    collarAttribute.needsUpdate = true;

    const fade = 1 - this.morph;
    for (const line of this.moorings.children) {
      ((line as Line).material as LineBasicMaterial).opacity = 0.5 * fade;
    }
    this.moorings.visible = fade > 0.01;
    this.fish.visible = fade > 0.01;
    for (const body of this.fish.children) {
      ((body as Mesh).material as MeshBasicMaterial).opacity = fade;
    }
    this.gridLines.visible = this.morph > 0.98;
    this.shafts.visible = fade > 0.01;
  }

  private updateAmbient(now: number): void {
    if (reducedMotion()) return;
    const seconds = now / 1000;
    const radius = this.radius();
    for (const body of this.fish.children) {
      const offset = body.userData["offset"] as number;
      const ring = body.userData["ring"] as number;
      const angle = offset + (seconds / 45) * Math.PI * 2;
      body.position.set(
        -radius * ring * Math.sin(angle),
        body.userData["depth"] as number,
        radius * ring * Math.cos(angle),
      );
      body.rotation.set(Math.PI / 2, 0, -angle);
    }
    if (this.particles) {
      const attribute = this.particles.geometry.getAttribute("position") as BufferAttribute;
      const array = attribute.array as Float32Array;
      const span = this.pen.net_depth_m * 1.4;
      const rise = (span / 30) * (1 / 60);
      for (let i = 0; i < array.length / 3; i += 1) {
        array[i * 3 + 1] += rise;
        if (array[i * 3 + 1] > 0.5) array[i * 3 + 1] = -span;
      }
      attribute.needsUpdate = true;
    }
    let shaftIndex = 0;
    for (const shaft of this.shafts.children) {
      shaft.rotation.z = Math.sin(seconds / 10 + shaftIndex) * 0.06;
      shaftIndex += 1;
    }
  }

  private updateCamera(): void {
    const radius = this.radius();
    if (this.morph >= 0.5) {
      const distance =
        this.visibleWidth() /
        (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect);
      this.camera.position.set(this.panX, -this.pen.net_depth_m / 2 + this.panY, distance);
      this.camera.lookAt(this.panX, -this.pen.net_depth_m / 2 + this.panY, 0);
      this.applyFog(distance);
      return;
    }
    const radians = (this.azimuth * Math.PI) / 180;
    const elevation = (this.elevation * Math.PI) / 180;
    const tan = Math.tan((this.camera.fov * Math.PI) / 360);
    const halfWidth = radius * 1.3;
    const halfHeight = this.pen.net_depth_m * 0.62 + radius * 0.4;
    const distance =
      Math.max(halfHeight / tan, halfWidth / (tan * this.camera.aspect)) / this.zoom;
    const centre = -this.pen.net_depth_m * 0.5;
    this.camera.position.set(
      -Math.sin(radians) * distance * Math.cos(elevation),
      Math.sin(elevation) * distance + centre,
      Math.cos(radians) * distance * Math.cos(elevation),
    );
    this.camera.lookAt(0, centre, 0);
    this.applyFog(distance);
    this.positionRov();
  }

  /// The deep-water fog fades into exactly the page ground, and follows the
  /// camera so the flat chart is never fogged away.
  private applyFog(distance: number): void {
    const fog = this.scene.fog;
    if (!(fog instanceof Fog)) return;
    fog.near = distance * (0.55 + 0.52 * this.morph);
    fog.far = distance * (1.9 + 1.3 * this.morph);
  }

  /// The panel grid's column letters and row numbers fade in last.
  private updateGridLabels(): void {
    const opacity = Math.max(0, (this.morph - 0.9) / 0.1);
    this.labelLayer.style.opacity = String(opacity);
    if (opacity <= 0) return;
    const wanted = this.pen.columns + this.pen.rows;
    if (this.labelLayer.childElementCount !== wanted) {
      this.labelLayer.replaceChildren();
      for (let column = 0; column < this.pen.columns; column += 1) {
        this.labelLayer.appendChild(h("span", {}, columnLetter(column)));
      }
      for (let row = 0; row < this.pen.rows; row += 1) {
        this.labelLayer.appendChild(h("span", {}, String(row + 1)));
      }
    }
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const point = new Vector3();
    const nodes = [...this.labelLayer.children] as HTMLElement[];
    const place = (node: HTMLElement) => {
      point.project(this.camera);
      node.style.left = `${((point.x + 1) / 2) * width}px`;
      node.style.top = `${((1 - point.y) / 2) * height}px`;
    };
    for (let column = 0; column < this.pen.columns; column += 1) {
      this.wallPosition((column + 0.5) / this.pen.columns, 0, this.morph, point);
      point.y += this.pen.net_depth_m * 0.06;
      place(nodes[column]);
    }
    for (let row = 0; row < this.pen.rows; row += 1) {
      this.wallPosition(0, (row + 0.5) / this.pen.rows, this.morph, point);
      point.x += this.pen.circumference_m * 0.02;
      place(nodes[this.pen.columns + row]);
    }
  }

  private positionRov(): void {
    const defect = this.defects.find((entry) => entry.id === this.selected);
    const bearing = ((defect?.bearing_deg ?? this.azimuth) * Math.PI) / 180;
    const depth = defect?.depth_m ?? this.pen.net_depth_m * 0.3;
    const radius = this.radius() * 1.22;
    this.rov.position.set(-radius * Math.sin(bearing), -depth, radius * Math.cos(bearing));
    this.rov.lookAt(0, -depth, 0);
  }

  private defectPosition(defect: SceneDefect, out: Vector3): Vector3 {
    const u = (((defect.bearing_deg % 360) + 360) % 360) / 360;
    const v = this.pen.net_depth_m === 0 ? 0 : defect.depth_m / this.pen.net_depth_m;
    return this.wallPosition(u, v, this.morph, out);
  }

  /// Each pin button sits over the stage at its projected position.
  private placePins(): void {
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const point = new Vector3();
    for (const defect of this.defects) {
      const pin = this.pins.get(defect.id);
      if (!pin) continue;
      if (!this.webgl) {
        const chartX = defect.chart_x_m / this.pen.circumference_m;
        const chartY =
          this.pen.net_depth_m === 0 ? 0 : defect.chart_y_m / this.pen.net_depth_m;
        pin.style.left = `${(0.06 + chartX * 0.88) * width}px`;
        pin.style.top = `${(0.12 + chartY * 0.76) * height}px`;
        continue;
      }
      this.defectPosition(defect, point);
      point.project(this.camera);
      pin.style.left = `${((point.x + 1) / 2) * width}px`;
      pin.style.top = `${((1 - point.y) / 2) * height}px`;
      pin.style.visibility = point.z < 1 ? "visible" : "hidden";
    }
  }

  /// Without WebGL the stage shows a still, two-dimensional flat chart with the
  /// panel grid and the same pin buttons.
  drawFallback(): void {
    const context = this.canvas.getContext("2d");
    if (!context) return;
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    const ratio = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#060708";
    context.fillRect(0, 0, width, height);
    const left = width * 0.06;
    const top = height * 0.12;
    const chartWidth = width * 0.88;
    const chartHeight = height * 0.76;
    context.strokeStyle = "rgba(255,255,255,0.22)";
    context.lineWidth = 1;
    for (let column = 0; column <= this.pen.columns; column += 1) {
      const x = left + (column / this.pen.columns) * chartWidth;
      context.beginPath();
      context.moveTo(x, top);
      context.lineTo(x, top + chartHeight);
      context.stroke();
    }
    for (let row = 0; row <= this.pen.rows; row += 1) {
      const y = top + (row / this.pen.rows) * chartHeight;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(left + chartWidth, y);
      context.stroke();
    }
    context.fillStyle = "rgba(255,255,255,0.65)";
    context.font = '11px "Inter", sans-serif';
    for (let column = 0; column < this.pen.columns; column += 1) {
      const x = left + ((column + 0.5) / this.pen.columns) * chartWidth;
      context.fillText(String.fromCharCode(65 + column), x - 3, top - 6);
    }
    for (let row = 0; row < this.pen.rows; row += 1) {
      const y = top + ((row + 0.5) / this.pen.rows) * chartHeight;
      context.fillText(String(row + 1), left - 14, y + 4);
    }
    this.placePins();
  }
}
