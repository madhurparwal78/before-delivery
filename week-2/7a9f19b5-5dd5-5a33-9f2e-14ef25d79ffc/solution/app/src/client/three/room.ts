// The light-pool room: a 3D room with a ceiling grid; each placed fitting drops a cone of light to a tinted pool on
// the floor. Plan coordinates are millimetres from the back-left corner seen from above (x right, y towards you).
import * as THREE from "three";
import type { LightState } from "../../shared/dial";
import type { FittingKind } from "../lib/format";
import { AMBIENCE } from "./ambience";
import { buildFitting, lightCone, lightPool, poolRadiusM } from "./fittings";
import { SETTLED, type SequenceProgress } from "./sequence";

const RESIZE_MS = 400;
const REMOVE_MS = 250;

interface RoomSpot {
  id: string;
  x: number;
  y: number;
  beam: number;
  cct: number;
  kind: FittingKind;
  finish: string;
}

interface Fixture {
  spot: RoomSpot;
  holder: THREE.Group;
  cone: ReturnType<typeof lightCone>;
  pool: ReturnType<typeof lightPool>;
  progress: SequenceProgress;
  removing: number | null;
}

interface RoomSize {
  width: number;
  depth: number;
  ceiling: number;
}

export class RoomScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private readonly ambient = new THREE.AmbientLight("#ffffff", 0.3);
  private readonly key = new THREE.DirectionalLight("#ffffff", 0.5);
  private readonly floorMaterial = new THREE.MeshStandardMaterial({ roughness: 0.92 });
  private readonly wallMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95, side: THREE.DoubleSide });
  private readonly shell = new THREE.Group();
  private readonly fixtures = new Map<string, Fixture>();
  private size: RoomSize;
  private shownCeiling: number;
  private resize: { from: number; started: number } | null = null;
  private frame = 0;
  private readonly resizer: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    context: WebGL2RenderingContext,
    size: RoomSize,
    light: LightState,
    private readonly reducedMotion: boolean,
    private readonly onLayout: () => void,
  ) {
    this.size = size;
    this.shownCeiling = size.ceiling;
    this.renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.key.position.set(-2, 6, 5);
    this.scene.add(this.ambient, this.key, this.shell);
    this.setLight(light);
    this.buildShell();
    this.resizer = new ResizeObserver(() => {
      this.fitCanvas();
      this.onLayout();
    });
    this.resizer.observe(canvas);
    this.fitCanvas();
    this.draw();
  }

  private metres(): { w: number; d: number; h: number } {
    return { w: this.size.width / 1000, d: this.size.depth / 1000, h: this.shownCeiling / 1000 };
  }

  private buildShell(): void {
    for (const child of this.shell.children) if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose();
    this.shell.clear();
    const { w, d, h } = this.metres();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), this.wallMaterial);
    back.position.set(0, h / 2, -d / 2);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(d, h), this.wallMaterial);
    left.rotation.y = Math.PI / 2;
    left.position.set(-w / 2, h / 2, 0);
    const right = left.clone();
    right.position.x = w / 2;
    const grid: number[] = [];
    for (let x = 0; x <= this.size.width; x += 500) grid.push(x / 1000 - w / 2, h, -d / 2, x / 1000 - w / 2, h, d / 2);
    for (let y = 0; y <= this.size.depth; y += 500) grid.push(-w / 2, h, y / 1000 - d / 2, w / 2, h, y / 1000 - d / 2);
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(grid, 3)),
      new THREE.LineBasicMaterial({ color: "#5d6878", transparent: true, opacity: 0.55 }),
    );
    this.shell.add(floor, back, left, right, lines);
  }

  /** Camera looks into the room from the front and above, far enough back that every corner is in view. */
  private frameCamera(): void {
    const { w, d, h } = this.metres();
    const target = new THREE.Vector3(0, h * 0.42, 0.15 * d);
    const direction = new THREE.Vector3(0, 1.25, 1).normalize();
    const corners = [-1, 1].flatMap((sx) =>
      [-1, 1].flatMap((sz) => [0, h].map((y) => new THREE.Vector3((sx * w) / 2, y, (sz * d) / 2))),
    );
    let distance = Math.max(w, d) * 0.6;
    for (let i = 0; i < 60; i++) {
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.lookAt(target);
      this.camera.updateMatrixWorld();
      const fits = corners.every((corner) => {
        const p = corner.clone().project(this.camera);
        return Math.abs(p.x) <= 0.9 && Math.abs(p.y) <= 0.88;
      });
      if (fits) break;
      distance *= 1.06;
    }
  }

  private fitCanvas(): void {
    const { clientWidth, clientHeight } = this.canvas;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
    this.frameCamera();
    this.draw();
  }

  setLight(light: LightState): void {
    const ambience = AMBIENCE[light];
    this.scene.background = new THREE.Color("#10141b");
    this.ambient.color.set(ambience.ambient);
    this.ambient.intensity = 0.25 + ambience.intensity;
    this.floorMaterial.color.set(ambience.floor);
    this.wallMaterial.color.set(ambience.floor).multiplyScalar(0.8);
    this.invalidate();
  }

  setSize(size: RoomSize): void {
    const ceilingChanged = size.ceiling !== this.size.ceiling;
    const roomChanged = size.width !== this.size.width || size.depth !== this.size.depth;
    const from = this.shownCeiling;
    this.size = size;
    if (ceilingChanged && !this.reducedMotion) this.resize = { from, started: performance.now() };
    else this.shownCeiling = size.ceiling;
    if (roomChanged || ceilingChanged) {
      this.buildShell();
      this.frameCamera();
      this.onLayout();
    }
    this.invalidate();
  }

  /** Adds, moves and removes fixtures to match `spots`; `progress` drives fixtures still playing their sequence. */
  sync(spots: RoomSpot[], progress: ReadonlyMap<string, SequenceProgress>): void {
    const ids = new Set(spots.map((spot) => spot.id));
    for (const spot of spots) {
      let fixture = this.fixtures.get(spot.id);
      if (!fixture) {
        const holder = buildFitting(spot.kind, spot.finish, spot.cct).group;
        holder.scale.setScalar(1.6);
        const cone = lightCone(spot.cct, 0.14);
        const pool = lightPool(spot.cct, 0.55);
        fixture = { spot, holder, cone, pool, progress: SETTLED, removing: null };
        this.scene.add(holder, cone, pool);
        this.fixtures.set(spot.id, fixture);
      }
      fixture.spot = spot;
      fixture.progress = progress.get(spot.id) ?? SETTLED;
    }
    for (const [id, fixture] of this.fixtures) {
      if (!ids.has(id) && fixture.removing === null) fixture.removing = this.reducedMotion ? -Infinity : performance.now();
    }
    this.invalidate();
  }

  private place(fixture: Fixture, now: number): boolean {
    const { w, d, h } = this.metres();
    const x = fixture.spot.x / 1000 - w / 2;
    const z = fixture.spot.y / 1000 - d / 2;
    const radius = poolRadiusM(h, fixture.spot.beam);
    let { cone, pool, tint } = fixture.progress;
    if (fixture.removing !== null) {
      // Removal is the reverse of placement: pool and cone shrink to nothing in a quarter of a second.
      const left = 1 - Math.min(1, (now - fixture.removing) / REMOVE_MS);
      cone = left;
      pool = left;
      if (left <= 0) {
        this.scene.remove(fixture.holder, fixture.cone, fixture.pool);
        this.fixtures.delete(fixture.spot.id);
        return false;
      }
    }
    fixture.holder.position.set(x, h, z);
    fixture.cone.position.set(x, h, z);
    fixture.cone.scale.set(Math.max(0.001, radius * cone), Math.max(0.001, h * cone), Math.max(0.001, radius * cone));
    fixture.cone.visible = cone > 0;
    fixture.pool.position.set(x, 0.003, z);
    fixture.pool.scale.set(Math.max(0.001, radius * pool), 1, Math.max(0.001, radius * pool));
    fixture.pool.visible = pool > 0;
    fixture.pool.material.uniforms.tint!.value = tint;
    return fixture.removing !== null;
  }

  private invalidate(): void {
    if (!this.frame) this.frame = requestAnimationFrame(() => this.draw());
  }

  /** Draws now; keeps drawing while a resize or a removal is in flight. */
  draw(): void {
    this.frame = 0;
    const now = performance.now();
    let animating = false;
    if (this.resize) {
      const t = Math.min(1, (now - this.resize.started) / RESIZE_MS);
      const eased = 1 - (1 - t) ** 3;
      this.shownCeiling = THREE.MathUtils.lerp(this.resize.from, this.size.ceiling, eased);
      this.buildShell();
      if (t >= 1) this.resize = null;
      else animating = true;
    }
    for (const fixture of [...this.fixtures.values()]) animating = this.place(fixture, now) || animating;
    this.renderer.render(this.scene, this.camera);
    if (animating) this.invalidate();
  }

  /** Screen position (px from the canvas's top-left) of a fitting on the ceiling. */
  project(xMm: number, yMm: number): { left: number; top: number } {
    const { w, d } = this.metres();
    const point = new THREE.Vector3(xMm / 1000 - w / 2, this.size.ceiling / 1000, yMm / 1000 - d / 2).project(this.camera);
    return {
      left: ((point.x + 1) / 2) * this.canvas.clientWidth,
      top: ((1 - point.y) / 2) * this.canvas.clientHeight,
    };
  }

  /** The ceiling point under a pointer, in plan millimetres, or null when the pointer misses the ceiling plane. */
  planAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.size.ceiling / 1000), new THREE.Vector3());
    if (!hit) return null;
    const { w, d } = this.metres();
    return { x: (hit.x + w / 2) * 1000, y: (hit.z + d / 2) * 1000 };
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizer.disconnect();
    this.renderer.dispose();
  }
}
