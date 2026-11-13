import {
  AmbientLight,
  Box3,
  Box3Helper,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Plane,
  Quaternion,
  Ray,
  Raycaster,
  Scene,
  TorusGeometry,
  BoxGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneDocument, SceneObject } from "../../shared/doc";
import type { Collider } from "../../shared/sim";
import type { LoadedModel } from "./models";
import { STAGE, buildRig, poseRig, type RigView } from "./rigs";

export type Tool = "move" | "rotate" | "scale";
export type CameraViewName = "Top" | "Bottom" | "Front" | "Back" | "Right" | "Left" | "Iso";

export interface Pose {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface GizmoCommit {
  kind: Tool;
  objectId: string;
  position?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface StageEvents {
  onPick?: (id: string | null) => void;
  onGizmo?: (commit: GizmoCommit) => void;
  onGround?: (point: [number, number, number] | null) => void;
  onCamera?: () => void;
  /** Runs inside the animation frame, before drawing; return true to keep drawing every frame. */
  onFrame?: (now: number) => boolean;
}

const VIEW_DIRECTIONS: Record<CameraViewName, [number, number, number]> = {
  Top: [0, 1, 0.0001],
  Bottom: [0, -1, 0.0001],
  Front: [0, 0.18, 1],
  Back: [0, 0.18, -1],
  Right: [1, 0.18, 0],
  Left: [-1, 0.18, 0],
  Iso: [1, 0.8, 1],
};

const AXIS_COLORS = [0xf38ba8, 0xa6e3a1, 0x89b4fa];
const AXES = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const CAMERA_TURN_MS = 250;
const ROUND = 1e6;
const round6 = (n: number): number => Math.round(n * ROUND) / ROUND;

/** True when this browser can give a WebGL context; the editor and lab show the no-WebGL copy otherwise. */
export function createStage(container: HTMLElement, interactive: boolean, reducedMotion: boolean): SceneView | null {
  try {
    return new SceneView(container, interactive, reducedMotion);
  } catch {
    return null;
  }
}

export class SceneView {
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(50, 1, 0.05, 600);
  readonly controls: OrbitControls;
  events: StageEvents = {};
  private readonly scene = new Scene();
  private readonly canvas: HTMLCanvasElement;
  private readonly rigs = new Map<string, { object: SceneObject; view: RigView }>();
  private readonly colliderBoxes = new Group();
  private readonly gizmo = new Group();
  private readonly raycaster = new Raycaster();
  private readonly grid: GridHelper;
  private selectionBox: Box3Helper | null = null;
  private colliderHelpers: Box3Helper[] = [];
  private models: ReadonlyMap<string, LoadedModel> = new Map();
  private doc: SceneDocument | null = null;
  private selected: string | null = null;
  private hidden: ReadonlySet<string> = new Set();
  private tool: Tool = "move";
  private snap = false;
  private showColliders = false;
  private dirty = false;
  private continuous = false;
  private raf = 0;
  private animation: { from: Vector3; to: Vector3; fromTarget: Vector3; toTarget: Vector3; start: number } | null = null;
  private drag: { handle: number; start: Vector3; object: SceneObject; origin: Vector3; screen: Vector2; preview: GizmoCommit } | null = null;
  private press: { x: number; y: number } | null = null;
  private readonly observer: ResizeObserver;
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    interactive: boolean,
    private readonly reducedMotion: boolean,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: "default" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(new Color(STAGE.sky));
    this.canvas = this.renderer.domElement;
    this.canvas.className = "stage-canvas";
    container.appendChild(this.canvas);
    this.scene.background = new Color(STAGE.sky);
    this.scene.add(new AmbientLight(0xffffff, 1.5));
    const sun = new DirectionalLight(0xffffff, 2.2);
    sun.position.set(4, 9, 5);
    this.scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(600, 600), new MeshBasicMaterial({ color: STAGE.grass }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.002;
    this.scene.add(ground);
    this.grid = new GridHelper(100, 100, 0x1e1e2e, 0x1e1e2e);
    const gridMaterial = this.grid.material as LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    this.scene.add(this.grid, this.colliderBoxes, this.gizmo);
    this.camera.position.set(6, 5, 8);
    if (interactive) {
      this.canvas.addEventListener("pointerdown", this.onPointerDown);
      window.addEventListener("pointermove", this.onPointerMove);
      window.addEventListener("pointerup", this.onPointerUp);
    }
    this.canvas.addEventListener("pointermove", this.onGroundMove);
    this.canvas.addEventListener("pointerleave", () => this.events.onGround?.(null));
    // Touch drags on the stage orbit the camera; consuming them keeps the browser from starting a fling that would swallow the next tap.
    this.canvas.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 1, 0);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.addEventListener("change", () => {
      this.markDirty();
      this.events.onCamera?.();
    });
    this.controls.update();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.controls.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.markDirty();
    this.events.onCamera?.();
  }

  requestRender(): void {
    this.markDirty();
  }

  /** Draws on the next microtask, so a change is visible at once even when animation frames are throttled. */
  private markDirty(): void {
    if (this.dirty) return;
    this.dirty = true;
    queueMicrotask(() => {
      if (this.dirty && !this.disposed) this.draw();
    });
  }

  private draw(): void {
    this.dirty = false;
    this.updateOverlays();
    this.renderer.render(this.scene, this.camera);
  }

  private readonly frame = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    if (this.animation) this.stepAnimation(now);
    this.continuous = this.events.onFrame?.(now) ?? false;
    if (this.dirty || this.continuous) this.draw();
  };

  setDocument(doc: SceneDocument, models: ReadonlyMap<string, LoadedModel>): void {
    this.doc = doc;
    this.models = models;
    const seen = new Set<string>();
    for (const object of doc.objects) {
      seen.add(object.id);
      const known = this.rigs.get(object.id);
      if (known && known.object === object && (object.kind !== "model" || this.models.get(object.assetId ?? "") !== undefined)) continue;
      if (known) this.removeRig(object.id);
      const view = buildRig(object, models);
      this.scene.add(view.group);
      if (view.body) this.scene.add(view.body);
      if (view.rod) this.scene.add(view.rod);
      this.rigs.set(object.id, { object, view });
    }
    for (const id of [...this.rigs.keys()]) if (!seen.has(id)) this.removeRig(id);
    this.applyHidden();
    this.markDirty();
  }

  private removeRig(id: string): void {
    const rig = this.rigs.get(id);
    if (!rig) return;
    this.scene.remove(rig.view.group);
    if (rig.view.body) this.scene.remove(rig.view.body);
    if (rig.view.rod) this.scene.remove(rig.view.rod);
    this.rigs.delete(id);
  }

  setPoses(poses: ReadonlyMap<string, Pose>): void {
    for (const [id, rig] of this.rigs) {
      const pose = poses.get(id);
      if (pose) poseRig(rig.view, rig.object, pose.position, pose.rotation);
    }
    this.markDirty();
  }

  setHidden(hidden: ReadonlySet<string>): void {
    this.hidden = hidden;
    this.applyHidden();
  }

  private applyHidden(): void {
    for (const [id, rig] of this.rigs) {
      const visible = !this.hidden.has(id);
      rig.view.group.visible = visible;
      if (rig.view.body) rig.view.body.visible = visible;
      if (rig.view.rod) rig.view.rod.visible = visible;
    }
    this.markDirty();
  }

  setOptions(options: { grid: boolean; colliders: boolean; tool: Tool; snap: boolean }, colliders: readonly Collider[]): void {
    this.grid.visible = options.grid;
    this.tool = options.tool;
    this.snap = options.snap;
    this.showColliders = options.colliders;
    for (const helper of this.colliderHelpers) this.colliderBoxes.remove(helper);
    this.colliderHelpers = [];
    if (options.colliders) {
      for (const c of colliders) {
        const helper = new Box3Helper(new Box3(new Vector3(...c.min), new Vector3(...c.max)), 0xf9e2af);
        this.colliderBoxes.add(helper);
        this.colliderHelpers.push(helper);
      }
    }
    this.buildGizmo();
    this.markDirty();
  }

  setSelection(id: string | null, editable: boolean): void {
    this.selected = id;
    this.gizmo.userData.enabled = editable;
    this.buildGizmo();
    this.markDirty();
  }

  private objectBox(id: string): Box3 | null {
    const rig = this.rigs.get(id);
    if (!rig) return null;
    const box = new Box3().setFromObject(rig.view.group);
    if (rig.view.body) box.union(new Box3().setFromObject(rig.view.body));
    return box.isEmpty() ? null : box;
  }

  private updateOverlays(): void {
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox = null;
    }
    const rig = this.selected ? this.rigs.get(this.selected) : undefined;
    if (rig && rig.view.group.visible) {
      const box = this.objectBox(rig.object.id);
      if (box) {
        this.selectionBox = new Box3Helper(box, STAGE.accent);
        this.scene.add(this.selectionBox);
      }
    }
    if (this.gizmo.children.length > 0 && rig) {
      const position = this.drag?.preview.position ?? rig.object.position;
      this.gizmo.position.set(...position);
      const distance = this.camera.position.distanceTo(this.gizmo.position);
      this.gizmo.scale.setScalar(Math.max(distance * 0.12, 0.2));
    }
  }

  private buildGizmo(): void {
    this.gizmo.clear();
    const rig = this.selected ? this.rigs.get(this.selected) : undefined;
    if (!rig || !this.gizmo.userData.enabled) return;
    if (this.tool === "rotate") {
      const ring = new Mesh(new TorusGeometry(1, 0.045, 8, 48), new MeshBasicMaterial({ color: AXIS_COLORS[1], depthTest: false }));
      ring.rotation.x = Math.PI / 2;
      ring.renderOrder = 10;
      ring.userData.handle = 1;
      this.gizmo.add(ring);
      return;
    }
    AXES.forEach((axis, index) => {
      const holder = new Group();
      const material = new MeshBasicMaterial({ color: AXIS_COLORS[index], depthTest: false });
      const shaft = new Mesh(new CylinderGeometry(0.035, 0.035, 1, 8), material);
      shaft.position.y = 0.5;
      const tip =
        this.tool === "move"
          ? new Mesh(new ConeGeometry(0.11, 0.3, 12), material)
          : new Mesh(new BoxGeometry(0.2, 0.2, 0.2), material);
      tip.position.y = 1.1;
      for (const part of [shaft, tip]) {
        part.renderOrder = 10;
        part.userData.handle = index;
        holder.add(part);
      }
      holder.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), axis);
      this.gizmo.add(holder);
    });
  }

  private screenPoint(event: { clientX: number; clientY: number }): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -(((event.clientY - rect.top) / rect.height) * 2 - 1));
  }

  private rayFor(event: { clientX: number; clientY: number }): Ray {
    this.raycaster.setFromCamera(this.screenPoint(event), this.camera);
    return this.raycaster.ray.clone();
  }

  groundPoint(event: { clientX: number; clientY: number }): [number, number, number] | null {
    const hit = this.rayFor(event).intersectPlane(new Plane(new Vector3(0, 1, 0), 0), new Vector3());
    return hit ? [round6(hit.x), 0, round6(hit.z)] : null;
  }

  project(point: readonly [number, number, number]): { x: number; y: number; visible: boolean } {
    const projected = new Vector3(...point).project(this.camera);
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height, visible: projected.z < 1 && Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1 };
  }

  private pickObjectId(event: { clientX: number; clientY: number }): string | null {
    this.raycaster.setFromCamera(this.screenPoint(event), this.camera);
    const targets: Object3D[] = [];
    for (const [id, rig] of this.rigs) {
      if (this.hidden.has(id)) continue;
      targets.push(rig.view.group);
      if (rig.view.body) targets.push(rig.view.body);
    }
    const hit = this.raycaster.intersectObjects(targets, true).find((h) => typeof h.object.userData.objectId === "string");
    return hit ? (hit.object.userData.objectId as string) : null;
  }

  private pickHandle(event: { clientX: number; clientY: number }): number | null {
    if (this.gizmo.children.length === 0) return null;
    this.raycaster.setFromCamera(this.screenPoint(event), this.camera);
    this.gizmo.updateMatrixWorld(true);
    const hit = this.raycaster.intersectObjects(this.gizmo.children, true).find((h) => typeof h.object.userData.handle === "number");
    return hit ? (hit.object.userData.handle as number) : null;
  }

  private readonly onGroundMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") return;
    this.events.onGround?.(this.groundPoint(event));
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.press = { x: event.clientX, y: event.clientY };
    const handle = this.selected && this.gizmo.userData.enabled ? this.pickHandle(event) : null;
    const rig = this.selected ? this.rigs.get(this.selected) : undefined;
    if (handle !== null && rig) {
      event.stopImmediatePropagation();
      this.press = null;
      this.controls.enabled = false;
      const origin = new Vector3(...rig.object.position);
      this.drag = {
        handle,
        start: this.axisParameter(this.rayFor(event), origin, handle),
        object: rig.object,
        origin,
        screen: new Vector2(event.clientX, event.clientY),
        preview: { kind: this.tool, objectId: rig.object.id },
      };
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private axisParameter(ray: Ray, origin: Vector3, handle: number): Vector3 {
    const axis = AXES[handle];
    const w0 = origin.clone().sub(ray.origin);
    const b = ray.direction.dot(axis);
    const d = ray.direction.dot(w0);
    const e = axis.dot(w0);
    const denominator = 1 - b * b;
    const t = denominator < 1e-6 ? 0 : (b * d - e) / denominator;
    return new Vector3(t, 0, 0);
  }

  private snapped(value: number, step: number): number {
    return this.snap ? Math.round(value / step) * step : value;
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.drag) return;
    const drag = this.drag;
    const object = drag.object;
    if (this.tool === "move") {
      const t = this.axisParameter(this.rayFor(event), drag.origin, drag.handle).x - drag.start.x;
      const next = [...object.position] as [number, number, number];
      next[drag.handle] = round6(this.snapped(object.position[drag.handle] + t, 0.25));
      drag.preview.position = next;
      this.rigs.get(object.id)?.view.group.position.set(...next);
    } else if (this.tool === "rotate") {
      const degrees = this.snapped((event.clientX - drag.screen.x) * 0.5, 15);
      const q = new Quaternion().setFromAxisAngle(AXES[1], (degrees * Math.PI) / 180).multiply(new Quaternion(...object.rotation));
      drag.preview.rotation = [round6(q.x), round6(q.y), round6(q.z), round6(q.w)];
      this.rigs.get(object.id)?.view.group.quaternion.copy(q);
    } else {
      const delta = (drag.screen.y - event.clientY) * 0.01;
      const factor = Math.min(100, Math.max(0.01, round6(this.snapped(object.scale[0] + delta, 0.1))));
      drag.preview.scale = [factor, factor, factor];
      this.rigs.get(object.id)?.view.group.scale.set(factor, factor, factor);
    }
    this.markDirty();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.drag) {
      const commit = this.drag.preview;
      this.drag = null;
      this.controls.enabled = true;
      this.events.onGizmo?.(commit);
      this.markDirty();
      return;
    }
    const press = this.press;
    this.press = null;
    if (!press || event.target !== this.canvas) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < 5) this.events.onPick?.(this.pickObjectId(event));
  };

  /** Turns the camera to a named view in a quarter of a second (at once under reduced motion). */
  viewTo(name: CameraViewName): void {
    const target = this.controls.target.clone();
    const distance = Math.max(this.camera.position.distanceTo(target), 6);
    const direction = new Vector3(...VIEW_DIRECTIONS[name]).normalize();
    this.moveCamera(target.clone().addScaledVector(direction, distance), target);
  }

  frameObject(id: string): void {
    const box = this.objectBox(id);
    if (!box) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).length();
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.moveCamera(center.clone().addScaledVector(direction, Math.max(size * 2.2, 2.5)), center);
  }

  private moveCamera(position: Vector3, target: Vector3): void {
    if (this.reducedMotion) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    this.animation = { from: this.camera.position.clone(), to: position, fromTarget: this.controls.target.clone(), toTarget: target, start: performance.now() };
    this.markDirty();
  }

  private stepAnimation(now: number): void {
    const a = this.animation as NonNullable<typeof this.animation>;
    const t = Math.min((now - a.start) / CAMERA_TURN_MS, 1);
    const eased = 1 - (1 - t) * (1 - t);
    this.camera.position.lerpVectors(a.from, a.to, eased);
    this.controls.target.lerpVectors(a.fromTarget, a.toTarget, eased);
    this.controls.update();
    if (t >= 1) this.animation = null;
  }

  /** The editor draws every frame while a run is going; otherwise only when something changed. */
  currentDocument(): SceneDocument | null {
    return this.doc;
  }

  hasColliders(): boolean {
    return this.showColliders;
  }
}
