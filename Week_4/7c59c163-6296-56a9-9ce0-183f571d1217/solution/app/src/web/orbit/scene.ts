import {
  AmbientLight,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";

// The Orderbook Orbit: one torus ring per price level around a vertical spindle, drawn from the
// live book. Bids sit below the middle in sage, asks above in blush; height grows with distance
// from the mid price and radius is proportional to resting quantity.

export interface RingLevel {
  key: string; // "ask:<p>" or "bid:<p>", YES scale on events
  side: "bid" | "ask";
  price: number;
  quantity: number;
}

const COLORS = { bid: new Color("#5F7F54"), ask: new Color("#B0624F"), spindle: new Color("#46521F"), clear: new Color("#E6ECF2") };
const RADIUS_MAX = 1.55;
const RADIUS_MIN = 0.14;
const TUBE = 0.075;
const DISTANCE = 9;
const RING_OMEGA = 14;
const YAW_OMEGA = 12;
const YAW_PER_PX = 1 / 6;
const YAW_MAX = 20;

/** Camera elevation from the page scroll: 90° at 0 px → 35° at 600 px → 0° at 1200 px, linear. */
function elevationAt(scrollY: number): number {
  const y = Math.max(0, scrollY);
  if (y <= 600) return 90 - (55 * y) / 600;
  if (y <= 1200) return 35 - (35 * (y - 600)) / 600;
  return 0;
}

interface Spring {
  value: number;
  velocity: number;
  target: number;
}

/** Exact critically damped step: approaches the target without overshoot. */
function step(spring: Spring, omega: number, dt: number): void {
  const offset = spring.value - spring.target;
  const decay = Math.exp(-omega * dt);
  const c = spring.velocity + omega * offset;
  spring.value = spring.target + (offset + c * dt) * decay;
  spring.velocity = (spring.velocity - omega * c * dt) * decay;
}

interface Ring {
  key: string;
  side: "bid" | "ask";
  index: number;
  radius: Spring;
  height: Spring;
  mesh: Mesh<TorusGeometry, MeshLambertMaterial>;
  builtRadius: number;
  leaving: boolean;
}

interface OrbitCallbacks {
  onPick: (key: string) => void;
  onSettled: (settled: boolean) => void;
}

export class OrbitScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(34, 1, 0.1, 100);
  private readonly world = new Group();
  private readonly spindle: Mesh;
  private readonly rings = new Map<string, Ring>();
  private highlight: string | null = null;
  private elevation: number;
  private yaw: Spring = { value: 0, velocity: 0, target: 0 };
  private dragging: { x: number; startX: number; startY: number; moved: boolean } | null = null;
  private frame = 0;
  private lastTime = 0;
  private settled = true;
  private loaded = false;
  private nextIndex = 0;
  private readonly resize: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    mode: "scroll" | "fixed",
    private readonly callbacks: OrbitCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLORS.clear, 1);
    this.scene.fog = new Fog(COLORS.clear, DISTANCE - 2.5, DISTANCE + 6);
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 7, 5);
    this.scene.add(key);
    this.spindle = new Mesh(new CylinderGeometry(0.06, 0.06, 1, 20), new MeshLambertMaterial({ color: COLORS.spindle }));
    this.world.add(this.spindle);
    this.scene.add(this.world);
    this.elevation = mode === "fixed" ? 35 : elevationAt(window.scrollY);
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(canvas);
    if (mode === "scroll") window.addEventListener("scroll", this.onScroll, { passive: true });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.fit();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    window.removeEventListener("scroll", this.onScroll);
    for (const ring of this.rings.values()) this.disposeRing(ring);
    this.renderer.dispose();
  }

  setLevels(levels: RingLevel[]): void {
    const maxQuantity = Math.max(1, ...levels.map((l) => l.quantity));
    const perSide = Math.max(1, levels.filter((l) => l.side === "bid").length, levels.filter((l) => l.side === "ask").length);
    const spacing = Math.min(0.42, 2.3 / perSide);
    const ranked = (side: "bid" | "ask") =>
      levels.filter((l) => l.side === side).sort((a, b) => (side === "ask" ? a.price - b.price : b.price - a.price));
    const targets = new Map<string, { side: "bid" | "ask"; radius: number; height: number }>();
    for (const side of ["bid", "ask"] as const) {
      ranked(side).forEach((level, rank) => {
        const height = (side === "ask" ? 1 : -1) * (0.38 + spacing * rank);
        targets.set(level.key, { side, radius: Math.max(RADIUS_MIN, (RADIUS_MAX * level.quantity) / maxQuantity), height });
      });
    }
    for (const [key, target] of targets) {
      const ring = this.rings.get(key);
      if (ring) {
        ring.radius.target = target.radius;
        ring.height.target = target.height;
        ring.leaving = false;
      } else {
        const start = this.loaded ? 0.001 : target.radius;
        this.rings.set(key, this.createRing(key, target.side, start, target.radius, target.height));
      }
    }
    for (const ring of this.rings.values()) {
      if (!targets.has(ring.key)) {
        ring.leaving = true;
        ring.radius.target = 0;
      }
    }
    const extent = Math.max(0.6, ...[...targets.values()].map((t) => Math.abs(t.height))) + 0.45;
    this.spindle.scale.y = extent * 2;
    this.loaded = true;
    this.setSettled(false);
    this.kick();
  }

  setHighlight(key: string | null): void {
    this.highlight = key;
    for (const ring of this.rings.values()) this.paint(ring);
    this.renderOnce();
  }

  private createRing(key: string, side: "bid" | "ask", start: number, radius: number, height: number): Ring {
    const material = new MeshLambertMaterial({ color: COLORS[side].clone() });
    const mesh = new Mesh(new TorusGeometry(Math.max(start, 0.001), TUBE, 14, 96), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = height;
    this.world.add(mesh);
    const ring: Ring = {
      key,
      side,
      index: this.nextIndex++,
      radius: { value: start, velocity: 0, target: radius },
      height: { value: height, velocity: 0, target: height },
      mesh,
      builtRadius: start,
      leaving: false,
    };
    this.paint(ring);
    return ring;
  }

  private paint(ring: Ring): void {
    const base = COLORS[ring.side];
    const lit = ring.key === this.highlight;
    ring.mesh.material.color.copy(base).lerp(new Color("#ffffff"), lit ? 0.35 : 0);
    ring.mesh.material.emissive.copy(base).multiplyScalar(lit ? 0.45 : 0);
  }

  private disposeRing(ring: Ring): void {
    this.world.remove(ring.mesh);
    ring.mesh.geometry.dispose();
    ring.mesh.material.dispose();
  }

  private fit(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep 34° across the narrower side so the rings fit portrait canvases too.
    this.camera.fov = width >= height ? 34 : (2 * Math.atan(Math.tan((34 * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    this.camera.updateProjectionMatrix();
    this.renderOnce();
  }

  /** The pick point of a ring: a point on its circle, spread in azimuth so rings never share one. */
  private pickPoint(ring: Ring, radius: number, height: number): Vector3 {
    const theta = Math.PI / 2 + ((ring.index % 5) - 2) * 0.5;
    const point = new Vector3(radius * Math.cos(theta), height, radius * Math.sin(theta));
    return point.applyAxisAngle(new Vector3(0, 1, 0), (this.yaw.value * Math.PI) / 180);
  }

  private toScreen(point: Vector3): { x: number; y: number } {
    const projected = point.clone().project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * this.canvas.clientWidth,
      y: ((1 - projected.y) / 2) * this.canvas.clientHeight,
    };
  }

  private placeCamera(): void {
    const e = (this.elevation * Math.PI) / 180;
    this.camera.position.set(0, DISTANCE * Math.sin(e), DISTANCE * Math.cos(e));
    this.camera.up.set(0, Math.cos(e), -Math.sin(e));
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.world.rotation.y = (this.yaw.value * Math.PI) / 180;
  }

  private render(): void {
    this.placeCamera();
    for (const ring of this.rings.values()) {
      if (Math.abs(ring.radius.value - ring.builtRadius) > 0.0005) {
        ring.mesh.geometry.dispose();
        ring.mesh.geometry = new TorusGeometry(Math.max(ring.radius.value, 0.001), TUBE, 14, 96);
        ring.builtRadius = ring.radius.value;
      }
      ring.mesh.position.y = ring.height.value;
    }
    this.renderer.render(this.scene, this.camera);
    const drawn = [...this.rings.values()].filter((ring) => !ring.leaving);
    const rings = drawn.map((ring) => {
      const at = this.toScreen(this.pickPoint(ring, ring.radius.value, ring.height.value));
      return { level: ring.key, x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 };
    });
    this.canvas.dataset.rings = JSON.stringify(rings);
    this.canvas.dataset.elevation = this.elevation.toFixed(1);
    this.canvas.dataset.yaw = (Math.abs(this.yaw.value) < 0.05 ? 0 : this.yaw.value).toFixed(1);
    this.canvas.dataset.highlight = this.highlight ?? "";
  }

  private renderOnce(): void {
    if (this.frame === 0) this.render();
  }

  private setSettled(settled: boolean): void {
    this.canvas.dataset.settled = String(settled);
    if (settled !== this.settled) {
      this.settled = settled;
      this.callbacks.onSettled(settled);
    }
  }

  /** Starts the frame loop; it stops on its own once every ring and the yaw are at rest. */
  private kick(): void {
    if (this.frame !== 0) return;
    this.lastTime = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  }

  private readonly tick = (now: number) => {
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), 0.1);
    this.lastTime = now;
    for (const ring of this.rings.values()) {
      step(ring.radius, RING_OMEGA, dt);
      step(ring.height, RING_OMEGA, dt);
    }
    if (!this.dragging) {
      step(this.yaw, YAW_OMEGA, dt);
      if (Math.abs(this.yaw.value) < 0.05 && Math.abs(this.yaw.velocity) < 0.5) this.yaw = { value: 0, velocity: 0, target: 0 };
    }
    this.placeCamera();
    let resting = true;
    for (const ring of [...this.rings.values()]) {
      const now2d = this.toScreen(this.pickPoint(ring, ring.radius.value, ring.height.value));
      const target2d = this.toScreen(this.pickPoint(ring, ring.radius.target, ring.height.target));
      const close = Math.hypot(now2d.x - target2d.x, now2d.y - target2d.y) < 0.5;
      if (close) {
        ring.radius.value = ring.radius.target;
        ring.height.value = ring.height.target;
        ring.radius.velocity = ring.height.velocity = 0;
        if (ring.leaving) {
          this.disposeRing(ring);
          this.rings.delete(ring.key);
        }
      } else {
        resting = false;
      }
    }
    this.render();
    const yawResting = !this.dragging && this.yaw.value === 0;
    if (resting) this.setSettled(true);
    if (resting && yawResting) {
      this.frame = 0;
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private readonly onScroll = () => {
    this.elevation = elevationAt(window.scrollY);
    this.canvas.dataset.elevation = this.elevation.toFixed(1);
    this.renderOnce();
  };

  private readonly onPointerDown = (event: PointerEvent) => {
    this.dragging = { x: event.clientX, startX: event.clientX, startY: event.clientY, moved: false };
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (!this.dragging) return;
    const dx = event.clientX - this.dragging.startX;
    if (Math.abs(dx) > 4 || Math.abs(event.clientY - this.dragging.startY) > 4) this.dragging.moved = true;
    this.yaw = { value: Math.max(-YAW_MAX, Math.min(YAW_MAX, dx * YAW_PER_PX)), velocity: 0, target: 0 };
    this.render();
  };

  private readonly onPointerUp = (event: PointerEvent) => {
    const drag = this.dragging;
    this.dragging = null;
    if (drag && !drag.moved) this.pick(event);
    this.kick();
  };

  private readonly onPointerCancel = () => {
    this.dragging = null;
    this.kick();
  };

  private pick(event: PointerEvent): void {
    const box = this.canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best: { key: string; distance: number } | null = null;
    for (const ring of this.rings.values()) {
      if (ring.leaving) continue;
      const at = this.toScreen(this.pickPoint(ring, ring.radius.value, ring.height.value));
      const distance = Math.hypot(at.x - x, at.y - y);
      if (distance < 32 && (!best || distance < best.distance)) best = { key: ring.key, distance };
    }
    if (best) this.callbacks.onPick(best.key);
  }
}
