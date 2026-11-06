import * as THREE from "three";

/**
 * The procedural 3D lab: 24 extruded benches in four rows of six facing an
 * instructor's demo station, with a soft cone of light under each bench's
 * curing lamp. The scene never moves on its own: no idle rotation, no loop.
 * Drag orbits it inside the published range and springs back on release.
 */

export type BenchSceneState = "open" | "atelier_only" | "sold_out" | "held" | "held_by_you" | "offered_to_you" | "sold" | "yours";

export interface SceneBench {
  label: string;
  state: BenchSceneState;
}

const AZ_MIN = -35;
const AZ_MAX = 35;
const EL_MIN = 20;
const EL_MAX = 62;
const OVERSHOOT_MAX = 8;

export class LabScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private center = new THREE.Vector3(0, 0.9, 0);
  private radius = 15;
  private azimuth = 0;
  private elevation = 62;
  private dragAzimuth = 0;
  private dragElevation = 0;
  private springing = false;
  private springStart = 0;
  private scrollProgress = 0;
  private benches = new Map<string, { box: THREE.Mesh; edges: THREE.LineSegments; ring: THREE.Mesh; lift: number; state: BenchSceneState }>();
  private selected: string | null = null;
  private ringMode: "none" | "depleting" | "band" = "none";
  private ringRemaining = 1;
  private raf = 0;
  private running = false;
  private destroyed = false;
  private liftAnimating = new Map<string, number>();
  private reducedMotion = false;

  constructor(
    private container: HTMLElement,
    private region: HTMLElement,
    private onSelect: (label: string) => void
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 100);

    const ambient = new THREE.AmbientLight(0xf0e9df, 0.55);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xfff3e0, 0.85);
    key.position.set(6, 12, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x58c6ff, 0.25);
    rim.position.set(-8, 6, -6);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshStandardMaterial({ color: 0x1b1512, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Instructor demo station at one end; row A is nearest to it.
    const demo = new THREE.Mesh(
      new THREE.BoxGeometry(7, 2.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x2c2320, roughness: 0.6 })
    );
    demo.position.set(0, 1.2, -8.6);
    this.scene.add(demo);
    const demoEdge = new THREE.LineSegments(
      new THREE.EdgesGeometry(demo.geometry),
      new THREE.LineBasicMaterial({ color: 0xd9a441 })
    );
    demoEdge.position.copy(demo.position);
    this.scene.add(demoEdge);

    for (const rowLetter of ["A", "B", "C", "D"]) {
      const z = -6 + (["A", "B", "C", "D"].indexOf(rowLetter) + 1) * 3.4;
      for (let n = 1; n <= 6; n++) {
        this.addBench(`${rowLetter}${n}`, (n - 3.5) * 3.2, z);
      }
    }

    this.region.setAttribute("data-azimuth", "0.0");
    this.region.setAttribute("data-elevation", "62.0");
    this.region.setAttribute("data-scroll-progress", "0.00");
    this.region.setAttribute("data-selected-bench", "");
    this.region.setAttribute("data-ready", "false");
    this.region.setAttribute("data-lift", "0.00");
    this.region.setAttribute("data-ring", "none");

    this.bindPointer();
    this.bindResize();
    this.updateCamera();
    this.render();
  }

  private addBench(label: string, x: number, z: number): void {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.5, 1.4),
      new THREE.MeshStandardMaterial({ color: 0x241c18, roughness: 0.8 })
    );
    box.position.set(x, 0.25, z);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(box.geometry),
      new THREE.LineBasicMaterial({ color: 0xf0e9df })
    );
    edges.position.copy(box.position);

    // The curing lamp above each bench, with its soft cone of light.
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x58c6ff, emissive: 0x2f9fd8 })
    );
    lamp.position.set(x, 2.1, z);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.0, 1.8, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x58c6ff,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    cone.position.set(x, 1.15, z);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.055, 12, 64),
      new THREE.MeshBasicMaterial({ color: 0x58c6ff, transparent: true, opacity: 0 })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.62, z);

    this.scene.add(box, edges, lamp, cone, ring);
    this.benches.set(label, { box, edges, ring, lift: 0, state: "open" });
  }

  setBenchStates(states: SceneBench[], mySelection: string[] = []): void {
    for (const b of states) {
      const entry = this.benches.get(b.label);
      if (!entry) continue;
      entry.state = b.state;
      const selected = mySelection.includes(b.label);
      this.styleBench(entry, b.state, selected);
      if (selected && entry.lift < 1) {
        this.startLiftFor([b.label]);
      } else if (!selected && b.state !== "held_by_you" && entry.lift > 0) {
        this.reverseLift(b.label);
      }
    }
  }

  private styleBench(entry: { box: THREE.Mesh; edges: THREE.LineSegments; ring: THREE.Mesh }, state: BenchSceneState, selected: boolean): void {
    const edge = entry.edges.material as THREE.LineBasicMaterial;
    const body = entry.box.material as THREE.MeshStandardMaterial;
    switch (state) {
      case "open":
        edge.color.setHex(0xf0e9df);
        body.color.setHex(0x241c18);
        break;
      case "atelier_only":
      case "sold_out":
        edge.color.setHex(0xd9a441);
        body.color.setHex(0x2a2016);
        break;
      case "held":
        edge.color.setHex(0x4a3f39);
        body.color.setHex(0x2c2320);
        break;
      case "held_by_you":
      case "offered_to_you":
        edge.color.setHex(0x58c6ff);
        body.color.setHex(0x17394d);
        break;
      case "sold":
        edge.color.setHex(0x4a3f39);
        body.color.setHex(0x352a24);
        break;
      case "yours":
        edge.color.setHex(0x58c6ff);
        body.color.setHex(0x58c6ff);
        break;
    }
    if (selected && state === "open") {
      edge.color.setHex(0x58c6ff);
    }
    (entry.ring.material as THREE.MeshBasicMaterial).opacity = 0;
  }

  /** The lift on the server's answer: the bench rises on a spring. */
  startLiftFor(labels: string[]): void {
    for (const label of labels) {
      this.liftAnimating.set(label, performance.now());
    }
    this.ensureRunning();
  }

  private reverseLift(label: string): void {
    const entry = this.benches.get(label);
    if (!entry) return;
    entry.lift = 0;
    this.benches.get(label)!.box.position.y = 0.25;
    this.region.setAttribute("data-lift", "0.00");
  }

  setSelectedBench(label: string | null): void {
    this.selected = label;
    this.region.setAttribute("data-selected-bench", label ?? "");
  }

  setRing(mode: "none" | "depleting" | "band", remaining = 1): void {
    this.ringMode = mode;
    this.ringRemaining = remaining;
    this.region.setAttribute("data-ring", mode);
    if (mode === "depleting") {
      this.region.setAttribute("data-ring-remaining", remaining.toFixed(2));
    } else {
      this.region.removeAttribute("data-ring-remaining");
    }
    if (mode !== "none") this.ensureRunning();
  }

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
  }

  private bindPointer(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = 0;
    let lastMoveTime = 0;

    const isTouch = (e: PointerEvent) => e.pointerType === "touch";

    this.container.addEventListener("pointerdown", (e) => {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveTime = performance.now();
      this.container.setPointerCapture(e.pointerId);
    });

    this.container.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const now = performance.now();
      if (now - lastMoveTime < 8) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      lastMoveTime = now;
      moved += Math.abs(dx) + Math.abs(dy);
      if (isTouch(e) && Math.abs(dx) < Math.abs(dy) && moved < 24) {
        // A mostly vertical touch drag scrolls the page instead.
        return;
      }
      const perPixel = 0.14;
      this.dragAzimuth += dx * perPixel;
      this.dragElevation -= dy * perPixel;
      this.clampDrag();
      this.springing = false;
      this.updateCamera();
      this.render();
    });

    const release = () => {
      if (!dragging) return;
      dragging = false;
      this.springing = true;
      this.springStart = performance.now();
      this.ensureRunning();
    };
    this.container.addEventListener("pointerup", release);
    this.container.addEventListener("pointercancel", release);

    // Clicking or tapping a bench in the scene acts like Enter on its button.
    this.renderer.domElement.addEventListener("click", (e: MouseEvent) => {
      if (moved > 8) return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, this.camera);
      const meshes: THREE.Object3D[] = [];
      for (const [label, entry] of this.benches) meshes.push(entry.box);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length > 0) {
        for (const [label, entry] of this.benches) {
          if (entry.box === hits[0]!.object) {
            this.onSelect(label);
            return;
          }
        }
      }
    });
  }

  private clampDrag(): void {
    const az = this.azimuth + this.dragAzimuth;
    if (this.dragAzimuth > 0 && az > AZ_MAX + OVERSHOOT_MAX) this.dragAzimuth = AZ_MAX + OVERSHOOT_MAX - this.azimuth;
    if (this.dragAzimuth < 0 && az < AZ_MIN - OVERSHOOT_MAX) this.dragAzimuth = AZ_MIN - OVERSHOOT_MAX - this.azimuth;
    const el = this.scrollElevation() + this.dragElevation;
    if (el > EL_MAX + OVERSHOOT_MAX) this.dragElevation = EL_MAX + OVERSHOOT_MAX - this.scrollElevation();
    if (el < EL_MIN - OVERSHOOT_MAX) this.dragElevation = EL_MIN - OVERSHOOT_MAX - this.scrollElevation();
  }

  private scrollElevation(): number {
    return EL_MAX - (EL_MAX - EL_MIN) * this.scrollProgress;
  }

  setScrollProgress(progress: number): void {
    this.scrollProgress = Math.max(0, Math.min(1, progress));
    this.region.setAttribute("data-scroll-progress", this.scrollProgress.toFixed(2));
    this.updateCamera();
    this.render();
  }

  private updateCamera(): void {
    const azimuth = THREE.MathUtils.degToRad(this.azimuth + this.dragAzimuth);
    const elevation = THREE.MathUtils.degToRad(this.scrollElevation() + this.dragElevation);
    const r = this.radius;
    this.camera.position.set(
      this.center.x + r * Math.cos(elevation) * Math.sin(azimuth),
      this.center.y + r * Math.sin(elevation),
      this.center.z + r * Math.cos(elevation) * Math.cos(azimuth)
    );
    this.camera.lookAt(this.center);
    this.region.setAttribute("data-azimuth", (this.azimuth + this.dragAzimuth).toFixed(1));
    this.region.setAttribute("data-elevation", (this.scrollElevation() + this.dragElevation).toFixed(1));
  }

  private bindResize(): void {
    const onResize = () => {
      if (this.destroyed) return;
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w === 0 || h === 0) return;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.render();
    };
    window.addEventListener("resize", onResize);
  }

  private ensureRunning(): void {
    if (this.running || this.destroyed) return;
    this.running = true;
    const loop = (now: number) => {
      if (this.destroyed) {
        this.running = false;
        return;
      }
      let active = false;

      if (this.springing) {
        const t = Math.min(1, (now - this.springStart) / 600);
        // An underdamped spring: it overshoots at most once and settles.
        const decay = Math.exp(-5 * t);
        const wobble = Math.cos(11 * t) * decay;
        this.dragAzimuth *= decay;
        this.dragElevation *= decay;
        const az = this.azimuth + this.dragAzimuth;
        const el = this.scrollElevation() + this.dragElevation;
        if (az > AZ_MAX) this.dragAzimuth = Math.min(this.dragAzimuth, (AZ_MAX - this.azimuth)) ;
        if (t >= 1 || (Math.abs(this.dragAzimuth) < 0.05 && Math.abs(this.dragElevation) < 0.05)) {
          this.dragAzimuth = 0;
          this.dragElevation = 0;
          this.springing = false;
        }
        this.updateCamera();
        active = true;
      }

      for (const [label, start] of this.liftAnimating) {
        const entry = this.benches.get(label);
        if (!entry) continue;
        const t = Math.min(1, (now - start) / 600);
        // A spring ease with a single small overshoot.
        const spring = t < 1 ? 1 - Math.exp(-6 * t) * Math.cos(9 * t) : 1;
        entry.lift = Math.max(0, Math.min(1.15, spring));
        entry.box.position.y = 0.25 + entry.lift * 0.9;
        if (t >= 1) {
          entry.lift = 1;
          this.liftAnimating.delete(label);
          this.region.setAttribute("data-lift", "1.00");
        } else {
          this.region.setAttribute("data-lift", entry.lift.toFixed(2));
        }
        active = true;
      }

      if (this.ringMode !== "none" && this.selected) {
        const entry = this.benches.get(this.selected);
        if (entry) {
          const mat = entry.ring.material as THREE.MeshBasicMaterial;
          if (this.ringMode === "depleting") {
            mat.opacity = 0.9;
            const frac = Math.max(0.02, this.ringRemaining);
            entry.ring.scale.setScalar(Math.max(0.35, frac));
            mat.opacity = 0.9 * Math.max(0.15, frac);
          } else {
            mat.opacity = 0.95;
            entry.ring.scale.setScalar(1);
          }
          entry.ring.rotation.z += 0.0;
          active = true;
        }
      }

      this.renderer.render(this.scene, this.camera);
      if (active || this.springing) {
        this.raf = requestAnimationFrame(loop);
      } else {
        this.running = false;
        this.raf = 0;
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** Renders one frame; the scene never animates on its own. */
  render(): void {
    if (this.destroyed) return;
    this.renderer.render(this.scene, this.camera);
    this.ensureRunning();
  }

  updateRing(remaining: number): void {
    this.ringRemaining = remaining;
    this.region.setAttribute("data-ring-remaining", remaining.toFixed(2));
    this.ensureRunning();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
