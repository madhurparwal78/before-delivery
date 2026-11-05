// Bench Lift: the procedural lab. 24 extruded benches in four rows of six facing the demo
// station, a soft cone under each curing lamp, a camera driven by scroll and drag, the held
// bench lifting on a spring inside a depleting curing-blue ring. Nothing moves on its own: the
// scene renders only when an input, a lift, the ring or a spring changes it.
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  ExtrudeGeometry,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

export type Look = "open" | "atelier" | "held" | "mine" | "sold" | "yours";
export type RingMode = "none" | "depleting" | "band";

const AZIMUTH = { min: -35, max: 35 };
const ELEVATION = { min: 20, max: 62 };
const OVERPULL = 8;
const SPRING_MS = 450;
const LIFT_MS = 520;
const BAND_MS = 600;
const DISTANCE = 15.5;
const TARGET = new Vector3(0, 0.2, 0.2);

const COLOR = {
  ground: 0x14100d,
  floor: 0x1a1410,
  umber: 0x2c231c,
  umberTop: 0x3b2f26,
  dim: 0x231c17,
  bone: 0xede4d3,
  gold: 0xd6a64b,
  curing: 0x62c9ff,
  sold: 0x4a3a2e,
  lamp: 0xf3e6cf,
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Past the range the camera follows with growing resistance, never more than OVERPULL degrees out. */
function resist(value: number, lo: number, hi: number): number {
  if (value > hi) return hi + OVERPULL * (1 - Math.exp(-(value - hi) / OVERPULL));
  if (value < lo) return lo - OVERPULL * (1 - Math.exp(-(lo - value) / OVERPULL));
  return value;
}

interface BenchMesh {
  label: string;
  group: Group;
  body: Mesh;
  top: Mesh;
  edges: LineSegments;
  cone: Mesh;
  dot: Mesh;
  look: Look | null;
}

interface Tween {
  from: number;
  to: number;
  start: number;
  ms: number;
}

function roundedSlab(width: number, depth: number, radius: number): Shape {
  const shape = new Shape();
  const w = width / 2;
  const d = depth / 2;
  shape.moveTo(-w + radius, -d);
  shape.lineTo(w - radius, -d);
  shape.quadraticCurveTo(w, -d, w, -d + radius);
  shape.lineTo(w, d - radius);
  shape.quadraticCurveTo(w, d, w - radius, d);
  shape.lineTo(-w + radius, d);
  shape.quadraticCurveTo(-w, d, -w, d - radius);
  shape.lineTo(-w, -d + radius);
  shape.quadraticCurveTo(-w, -d, -w + radius, -d);
  return shape;
}

// A dental arch seen from above: a horseshoe whose curve (the incisors) faces the seated dentist.
function archShape(outer: number, inner: number, legs: number): Shape {
  const shape = new Shape();
  shape.moveTo(-outer, legs);
  shape.lineTo(-outer, 0);
  shape.absarc(0, 0, outer, Math.PI, 2 * Math.PI, false);
  shape.lineTo(outer, legs);
  shape.lineTo(inner, legs);
  shape.lineTo(inner, 0);
  shape.absarc(0, 0, inner, 2 * Math.PI, Math.PI, true);
  shape.lineTo(-inner, legs);
  shape.lineTo(-outer, legs);
  return shape;
}

export class LabScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(34, 1, 0.1, 80);
  private benches = new Map<string, BenchMesh>();
  private ring: Mesh;
  private raycaster = new Raycaster();
  private frame = 0;
  private resizeObserver: ResizeObserver;

  private scrollProgress = 0;
  private azimuth = 0;
  private elevationOffset = 0;
  private drag: { id: number; x: number; y: number; az: number; el: number; touch: boolean; moved: number } | null = null;
  private azSpring: Tween | null = null;
  private elSpring: Tween | null = null;

  private selected: string | null = null;
  private lift: Tween = { from: 0, to: 0, start: 0, ms: LIFT_MS };
  private ringMode: RingMode = "none";
  private ringRemaining: () => number | null = () => null;
  private bandStart = 0;
  private lastRingShare = -1;

  constructor(
    private region: HTMLElement,
    canvas: HTMLCanvasElement,
    private onPick: (label: string) => void,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(COLOR.ground, 1);
    this.scene.fog = new Fog(COLOR.ground, 16, 34);
    this.scene.background = new Color(COLOR.ground);
    this.buildRoom();
    this.ring = new Mesh(new RingGeometry(1.0, 1.14, 96), new MeshBasicMaterial({ color: COLOR.curing, side: DoubleSide, transparent: true }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(region);
    region.addEventListener("pointerdown", this.onDown);
    region.addEventListener("pointermove", this.onMove);
    region.addEventListener("pointerup", this.onUp);
    region.addEventListener("pointercancel", this.onCancel);
    this.resize();
    this.publish();
  }

  private buildRoom(): void {
    this.scene.add(new AmbientLight(0xfff4e6, 0.55));
    this.scene.add(new HemisphereLight(0xf6ecdc, 0x0c0907, 0.5));
    const key = new DirectionalLight(0xfff1dc, 1.6);
    key.position.set(-4, 12, 7);
    this.scene.add(key);

    const floor = new Mesh(new PlaneGeometry(60, 60), new MeshStandardMaterial({ color: COLOR.floor, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const lines = new MeshBasicMaterial({ color: 0x33281f });
    for (let i = -6; i <= 6; i++) {
      const lineX = new Mesh(new PlaneGeometry(0.012, 15), lines);
      lineX.rotation.x = -Math.PI / 2;
      lineX.position.set(i * 1.6, 0.002, 0);
      this.scene.add(lineX);
    }

    // The instructor's demo station, nearest row A.
    const station = new Group();
    const desk = new Mesh(new BoxGeometry(5.2, 0.95, 1.3), new MeshStandardMaterial({ color: 0x33281f, roughness: 0.6 }));
    desk.position.y = 0.475;
    const screen = new Mesh(new BoxGeometry(3.6, 1.7, 0.08), new MeshStandardMaterial({ color: 0x0f0c0a, emissive: 0x2a2018, roughness: 0.3 }));
    screen.position.set(0, 2.1, -0.4);
    const screenEdge = new LineSegments(new EdgesGeometry(screen.geometry), new LineBasicMaterial({ color: COLOR.bone, transparent: true, opacity: 0.35 }));
    screenEdge.position.copy(screen.position);
    const scope = new Mesh(new CylinderGeometry(0.08, 0.14, 1.1, 16), new MeshStandardMaterial({ color: 0x8c7c68, metalness: 0.4, roughness: 0.4 }));
    scope.position.set(1.4, 1.5, 0);
    station.add(desk, screen, screenEdge, scope);
    station.position.set(0, 0, -5.1);
    this.scene.add(station);

    const slab = new ExtrudeGeometry(roundedSlab(1.22, 0.86, 0.14), { depth: 0.62, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 });
    slab.rotateX(-Math.PI / 2);
    const top = new BoxGeometry(1.08, 0.04, 0.72);
    const post = new CylinderGeometry(0.02, 0.02, 0.62, 8);
    const head = new BoxGeometry(0.16, 0.06, 0.1);
    const cone = new ConeGeometry(0.46, 0.62, 32, 1, true);
    const typodontBase = new BoxGeometry(0.5, 0.05, 0.42);
    const typodont = new ExtrudeGeometry(archShape(0.2, 0.11, 0.1), { depth: 0.1, bevelEnabled: false, curveSegments: 12 });
    typodont.rotateX(-Math.PI / 2);
    const dot = new SphereGeometry(0.08, 16, 12);
    const postMaterial = new MeshStandardMaterial({ color: 0x6f6252, metalness: 0.5, roughness: 0.4 });
    const toothMaterial = new MeshStandardMaterial({ color: 0xe9dfcd, roughness: 0.5 });
    const baseMaterial = new MeshStandardMaterial({ color: 0x1c1611, roughness: 0.8 });

    ["A", "B", "C", "D"].forEach((row, r) => {
      for (let n = 1; n <= 6; n++) {
        const label = `${row}${n}`;
        const group = new Group();
        group.position.set((n - 3.5) * 1.6, 0, -2.6 + r * 1.75);
        const body = new Mesh(slab, new MeshStandardMaterial({ color: COLOR.umber, roughness: 0.7 }));
        body.userData.label = label;
        const surface = new Mesh(top, new MeshStandardMaterial({ color: COLOR.umberTop, roughness: 0.55 }));
        surface.position.y = 0.67;
        surface.userData.label = label;
        const edges = new LineSegments(new EdgesGeometry(slab, 30), new LineBasicMaterial({ color: COLOR.bone, transparent: true, opacity: 0.9 }));
        const lampPost = new Mesh(post, postMaterial);
        lampPost.position.set(0.42, 0.98, -0.3);
        const lampHead = new Mesh(head, postMaterial);
        lampHead.position.set(0.32, 1.3, -0.3);
        const light = new Mesh(
          cone,
          new MeshBasicMaterial({ color: COLOR.lamp, transparent: true, opacity: 0.08, blending: AdditiveBlending, depthWrite: false, side: DoubleSide }),
        );
        light.position.set(0.2, 0.98, -0.18);
        const base = new Mesh(typodontBase, baseMaterial);
        base.position.set(-0.12, 0.715, 0.05);
        const arch = new Mesh(typodont, toothMaterial);
        arch.position.set(-0.12, 0.755, 0.03);
        const marker = new Mesh(dot, new MeshStandardMaterial({ color: COLOR.bone, roughness: 0.4 }));
        marker.position.set(-0.4, 0.77, 0.24);
        marker.visible = false;
        group.add(body, surface, edges, lampPost, lampHead, light, base, arch, marker);
        this.scene.add(group);
        this.benches.set(label, { label, group, body, top: surface, edges, cone: light, dot: marker, look: null });
      }
    });
  }

  setLooks(looks: ReadonlyMap<string, Look>): void {
    let changed = false;
    for (const bench of this.benches.values()) {
      const look = looks.get(bench.label) ?? "open";
      if (bench.look === look) continue;
      bench.look = look;
      changed = true;
      const body = bench.body.material as MeshStandardMaterial;
      const top = bench.top.material as MeshStandardMaterial;
      const edges = bench.edges.material as LineBasicMaterial;
      const cone = bench.cone.material as MeshBasicMaterial;
      body.emissive.setHex(0x000000);
      cone.color.setHex(COLOR.lamp);
      cone.opacity = 0.08;
      bench.dot.visible = false;
      edges.opacity = 0.9;
      switch (look) {
        case "open":
          body.color.setHex(COLOR.umber);
          top.color.setHex(COLOR.umberTop);
          edges.color.setHex(COLOR.bone);
          break;
        case "atelier":
          body.color.setHex(COLOR.umber);
          top.color.setHex(COLOR.umberTop);
          edges.color.setHex(COLOR.gold);
          break;
        case "held":
          body.color.setHex(COLOR.dim);
          top.color.setHex(COLOR.dim);
          edges.color.setHex(0x5b4b3e);
          edges.opacity = 0.6;
          cone.opacity = 0.03;
          break;
        case "sold":
          body.color.setHex(COLOR.sold);
          top.color.setHex(COLOR.sold);
          edges.color.setHex(0x6a5646);
          bench.dot.visible = true;
          cone.opacity = 0.04;
          break;
        case "mine":
          body.color.setHex(0x1d3a4a);
          body.emissive.setHex(COLOR.curing);
          body.emissiveIntensity = 0.35;
          top.color.setHex(COLOR.curing);
          edges.color.setHex(COLOR.curing);
          cone.color.setHex(COLOR.curing);
          cone.opacity = 0.16;
          break;
        case "yours":
          body.color.setHex(COLOR.curing);
          body.emissive.setHex(COLOR.curing);
          body.emissiveIntensity = 0.5;
          top.color.setHex(COLOR.curing);
          edges.color.setHex(COLOR.bone);
          cone.color.setHex(COLOR.curing);
          cone.opacity = 0.14;
          break;
      }
    }
    if (changed) this.invalidate();
  }

  /** The selected bench, its ring mode, and the share of hold left (server seconds on page time). */
  setSelection(label: string | null, mode: RingMode, remaining: () => number | null): void {
    const now = performance.now();
    if (label !== this.selected) {
      if (this.selected) this.benchOf(this.selected)?.group.position.setY(0);
      if (this.lowering) this.benchOf(this.lowering)?.group.position.setY(0);
      this.lowering = label ? null : this.selected;
      this.lift = label
        ? { from: 0, to: 1, start: now, ms: LIFT_MS }
        : { from: clamp(this.liftValue(now), 0, 1), to: 0, start: now, ms: LIFT_MS * 0.7 };
      this.selected = label;
    }
    if (mode === "band" && this.ringMode !== "band") this.bandStart = now;
    const changed = label !== this.shownSelection || mode !== this.ringMode;
    this.shownSelection = label;
    this.ringMode = mode;
    this.ringRemaining = remaining;
    this.publish();
    if (changed) this.invalidate();
    else this.schedule();
  }

  private shownSelection: string | null = null;

  private lowering: string | null = null;

  setScroll(progress: number): void {
    const next = clamp(progress, 0, 1);
    if (next === this.scrollProgress) return;
    this.scrollProgress = next;
    this.publish();
    this.invalidate();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.region.removeEventListener("pointerdown", this.onDown);
    this.region.removeEventListener("pointermove", this.onMove);
    this.region.removeEventListener("pointerup", this.onUp);
    this.region.removeEventListener("pointercancel", this.onCancel);
    this.renderer.dispose();
  }

  // ---- Camera ---------------------------------------------------------------------------------

  private baseElevation(): number {
    return ELEVATION.max - (ELEVATION.max - ELEVATION.min) * this.scrollProgress;
  }

  private tweenValue(tween: Tween, now: number, ease = easeOut): number {
    const t = clamp((now - tween.start) / tween.ms, 0, 1);
    return tween.from + (tween.to - tween.from) * ease(t);
  }

  private shownAzimuth(now: number): number {
    if (this.azSpring) return this.tweenValue(this.azSpring, now);
    return resist(this.azimuth, AZIMUTH.min, AZIMUTH.max);
  }

  private shownElevation(now: number): number {
    const base = this.baseElevation();
    if (this.elSpring) return base + this.tweenValue(this.elSpring, now);
    if (this.drag) return resist(base + this.elevationOffset, ELEVATION.min, ELEVATION.max);
    return clamp(base + this.elevationOffset, ELEVATION.min, ELEVATION.max);
  }

  private onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const now = performance.now();
    const az = this.shownAzimuth(now);
    const el = this.shownElevation(now) - this.baseElevation();
    this.azSpring = null;
    this.elSpring = null;
    this.azimuth = az;
    this.elevationOffset = el;
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, az, el, touch: event.pointerType !== "mouse", moved: 0 };
    this.region.setPointerCapture?.(event.pointerId);
  };

  private onMove = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(dy));
    this.azimuth = drag.az + dx * 0.16;
    if (!drag.touch) this.elevationOffset = drag.el + dy * 0.1;
    this.invalidate();
    this.publish();
  };

  private onUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.moved < 6) this.pick(event);
    this.release();
  };

  private onCancel = (event: PointerEvent) => {
    if (this.drag?.id === event.pointerId) this.release();
  };

  /** Springs back inside the published range and settles within six tenths of a second. */
  private release(): void {
    const now = performance.now();
    const az = this.shownAzimuth(now);
    const base = this.baseElevation();
    const el = resist(base + this.elevationOffset, ELEVATION.min, ELEVATION.max);
    this.drag = null;
    const azTarget = clamp(az, AZIMUTH.min, AZIMUTH.max);
    const elTarget = clamp(el, ELEVATION.min, ELEVATION.max);
    this.azimuth = azTarget;
    this.elevationOffset = elTarget - base;
    this.azSpring = az === azTarget ? null : { from: az, to: azTarget, start: now, ms: SPRING_MS };
    this.elSpring = el === elTarget ? null : { from: el - base, to: elTarget - base, start: now, ms: SPRING_MS };
    this.invalidate();
  }

  private pick(event: PointerEvent): void {
    const rect = this.region.getBoundingClientRect();
    const pointer = new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const targets = [...this.benches.values()].flatMap((b) => [b.body, b.top]);
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const label = hit?.object.userData.label;
    if (typeof label === "string") this.onPick(label);
  }

  // ---- Frames -----------------------------------------------------------------------------------

  private benchOf(label: string): BenchMesh | undefined {
    return this.benches.get(label);
  }

  private liftValue(now: number): number {
    return this.tweenValue(this.lift, now, this.lift.to === 1 ? easeOutBack : easeOut);
  }

  private springing(now: number): boolean {
    const tweening = [this.azSpring, this.elSpring, this.lift].some((tween) => tween && now - tween.start < tween.ms + 32);
    return tweening || (this.ringMode === "band" && now - this.bandStart < BAND_MS + 32);
  }

  private animating(now: number): boolean {
    return this.springing(now) || this.ringMode === "depleting";
  }

  invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(this.draw);
  }

  private draw = () => {
    this.frame = 0;
    const now = performance.now();
    if (this.azSpring && now - this.azSpring.start >= this.azSpring.ms) this.azSpring = null;
    if (this.elSpring && now - this.elSpring.start >= this.elSpring.ms) this.elSpring = null;
    const az = (this.shownAzimuth(now) * Math.PI) / 180;
    const el = (this.shownElevation(now) * Math.PI) / 180;
    this.camera.position.set(
      TARGET.x + DISTANCE * Math.cos(el) * Math.sin(az),
      TARGET.y + DISTANCE * Math.sin(el),
      TARGET.z + DISTANCE * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(TARGET);

    const lifted = this.selected ?? this.lowering;
    const bench = lifted ? this.benchOf(lifted) : undefined;
    if (bench) bench.group.position.y = Math.max(0, this.liftValue(now)) * 0.5;
    const ringChanged = this.drawRing(now, this.selected ? bench : undefined);
    const moving = this.springing(now) || this.dirty;
    if (moving || ringChanged) this.renderer.render(this.scene, this.camera);
    this.dirty = false;
    this.publish();
    if (this.animating(now)) this.schedule();
  };

  /** Set by inputs and state changes; a depleting ring alone redraws only when its visible arc changes. */
  private dirty = true;

  /** Updates the ring around the selected bench; returns whether its drawn shape changed. */
  private drawRing(now: number, bench: BenchMesh | undefined): boolean {
    if (!bench || this.ringMode === "none") {
      const was = this.ring.visible;
      this.ring.visible = false;
      return was;
    }
    this.ring.visible = true;
    this.ring.position.set(bench.group.position.x, 0.01, bench.group.position.z);
    const share = this.ringMode === "depleting" ? clamp(this.ringRemaining() ?? 0, 0, 1) : 1;
    const width = this.ringMode === "band" ? 0.14 + 0.18 * easeOut(clamp((now - this.bandStart) / BAND_MS, 0, 1)) : 0.14;
    const key = Math.round(share * 400) + width * 1000;
    if (key === this.lastRingShare) return false;
    this.lastRingShare = key;
    this.ring.geometry.dispose();
    this.ring.geometry = new RingGeometry(1.0, 1.0 + width, 96, 1, Math.PI / 2, Math.max(0.0001, share * Math.PI * 2));
    return true;
  }

  private resize(): void {
    const { width, height } = this.region.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.85 ? 60 : aspect < 1.1 ? 46 : 34;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private publish(): void {
    const now = performance.now();
    const set = (name: string, value: string) => {
      if (this.region.getAttribute(name) !== value) this.region.setAttribute(name, value);
    };
    set("data-azimuth", this.shownAzimuth(now).toFixed(1));
    set("data-elevation", this.shownElevation(now).toFixed(1));
    set("data-scroll-progress", this.scrollProgress.toFixed(2));
    set("data-selected-bench", this.selected ?? "");
    set("data-lift", (this.selected ? clamp(this.liftValue(now), 0, 1) : 0).toFixed(2));
    set("data-ring", this.selected ? this.ringMode : "none");
    const share = this.ringRemaining();
    set("data-ring-remaining", this.selected && this.ringMode === "depleting" && share !== null ? clamp(share, 0, 1).toFixed(2) : "");
  }
}
