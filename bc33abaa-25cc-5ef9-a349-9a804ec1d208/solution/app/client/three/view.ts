// Draws a scene graph with WebGL (three.js): one object per node, material layers as PBR materials,
// state poses with eased transitions, an orbit camera, picking and outlines.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { resolvedNode, type CameraView, type Graph, type Layer, type SceneNode } from "../../shared/graph.js";

const PAPER = 0xf4f0e6;
const INK = 0x1c1e17;
const COBALT = 0x1f4fd8;
const PUTTY = 0xcfc6b4;
const DEG = Math.PI / 180;

interface ViewOptions {
  /** Editor gizmos for cameras and lights, and the drafting floor. */
  drafting: boolean;
  /** Where a model asset's bytes come from, or null when this view cannot load them. */
  assetUrl: (assetId: string) => string | null;
}

interface Pose { position: THREE.Vector3; rotation: THREE.Euler; scale: THREE.Vector3; visible: boolean }

const GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 48, 32),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;

// The physical shader is several times the standard one to compile on software WebGL, so a node gets it only
// when one of its layers needs clearcoat or sheen.
function material(layers: Layer[]): THREE.MeshStandardMaterial {
  const physical = layers.some((l) => l.type === "clearcoat" || l.type === "sheen");
  const m = physical ? new THREE.MeshPhysicalMaterial() : new THREE.MeshStandardMaterial();
  m.color.set(0xd9d2c3);
  m.roughness = 0.55;
  m.metalness = 0.05;
  for (const layer of layers) {
    const color = new THREE.Color().setRGB(layer.color[0], layer.color[1], layer.color[2], THREE.SRGBColorSpace);
    if (layer.type === "base") { m.color = color; m.roughness = layer.roughness; m.metalness = layer.metalness; }
    if (layer.type === "emission") { m.emissive = color; m.emissiveIntensity = 1 - layer.roughness * 0.5; }
    if (m instanceof THREE.MeshPhysicalMaterial) {
      if (layer.type === "clearcoat") { m.clearcoat = 1; m.clearcoatRoughness = layer.roughness; }
      if (layer.type === "sheen") { m.sheen = 1; m.sheenColor = color; m.sheenRoughness = layer.roughness; }
    }
  }
  return m;
}

function gizmo(kind: SceneNode["kind"]): THREE.Object3D | null {
  const lines = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 });
  if (kind === "camera") {
    const frustum = new THREE.ConeGeometry(0.18, 0.3, 4, 1, true).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4);
    return new THREE.LineSegments(new THREE.EdgesGeometry(frustum), lines);
  }
  if (kind === "light") return new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.12)), lines);
  return null;
}

export class SceneView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 200);
  readonly content = new THREE.Group();
  private objects = new Map<string, THREE.Object3D>();
  private signatures = new Map<string, string>();
  private outlines: THREE.BoxHelper[] = [];
  private selection: THREE.BoxHelper | null = null;
  private graph: Graph | null = null;
  private poses = new Map<string, Pose>();
  private tween: number | null = null;
  private loader = new GLTFLoader();
  private pendingFrame: number | null = null;
  readonly orbit = { yaw: 0.55, pitch: 0.32, distance: 5, target: new THREE.Vector3() };
  onRender: (() => void) | null = null;

  private constructor(readonly canvas: HTMLCanvasElement, private options: ViewOptions, renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.background = new THREE.Color(PAPER);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0bf, 1.1));
    // Lights only, no baked environment: a prefiltered environment costs seconds of shader compilation on
    // software WebGL before the first frame. The rim light from behind gives metals and clearcoat an edge.
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0xdfe6ff, 1.1);
    rim.position.set(-4, 2.5, -3);
    this.scene.add(sun, rim, this.content);
    if (options.drafting) {
      const grid = new THREE.GridHelper(12, 48, PUTTY, PUTTY);
      grid.position.y = -1;
      this.scene.add(grid);
    }
  }

  /** A view on the canvas, or null when WebGL is unavailable. */
  static create(canvas: HTMLCanvasElement, options: ViewOptions): SceneView | null {
    try {
      const context = canvas.getContext("webgl2", { antialias: true });
      if (!context) return null;
      return new SceneView(canvas, options, new THREE.WebGLRenderer({ canvas, context, antialias: true }));
    } catch {
      return null;
    }
  }

  // --- Graph ---------------------------------------------------------------------------------------------------

  private objectFor(node: SceneNode): THREE.Object3D {
    const signature = JSON.stringify([node.kind, node.primitive, node.assetId, node.materialLayers]);
    const existing = this.objects.get(node.id);
    if (existing && this.signatures.get(node.id) === signature) return existing;
    if (existing) existing.removeFromParent();
    let object: THREE.Object3D;
    if (node.kind === "mesh" && node.assetId) {
      object = new THREE.Group();
      const proxy = new THREE.Mesh(GEOMETRIES.box, material(node.materialLayers));
      object.add(proxy);
      const url = this.options.assetUrl(node.assetId);
      if (url) {
        this.loader.load(url, (gltf) => {
          object.remove(proxy);
          object.add(gltf.scene);
          this.requestRender();
        }, undefined, () => undefined);
      }
    } else if (node.kind === "mesh") {
      object = new THREE.Mesh(GEOMETRIES[node.primitive ?? "box"], material(node.materialLayers));
    } else {
      object = new THREE.Group();
      if (node.kind === "light") object.add(new THREE.PointLight(0xfff4e0, 6, 0, 2));
      const helper = this.options.drafting ? gizmo(node.kind) : null;
      if (helper) object.add(helper);
    }
    object.userData.nodeId = node.id;
    for (const child of existing ? [...existing.children].filter((c) => typeof c.userData.nodeId === "string") : []) object.add(child);
    this.objects.set(node.id, object);
    this.signatures.set(node.id, signature);
    return object;
  }

  private posesOf(graph: Graph, stateId: string): Map<string, Pose> {
    const poses = new Map<string, Pose>();
    for (const node of graph.nodes) {
      const r = resolvedNode(graph, node, stateId);
      poses.set(node.id, {
        position: new THREE.Vector3(...r.position), rotation: new THREE.Euler(r.rotation[0] * DEG, r.rotation[1] * DEG, r.rotation[2] * DEG),
        scale: new THREE.Vector3(...r.scale), visible: r.visible,
      });
    }
    return poses;
  }

  private applyPoses(poses: Map<string, Pose>): void {
    for (const [id, pose] of poses) {
      const object = this.objects.get(id);
      if (!object) continue;
      object.position.copy(pose.position);
      object.rotation.copy(pose.rotation);
      object.scale.copy(pose.scale);
      object.visible = pose.visible;
    }
    this.poses = poses;
  }

  /** Builds or updates objects for the graph and shows it in the given state at once. */
  setGraph(graph: Graph, stateId: string): void {
    this.cancelTween();
    this.graph = graph;
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const [id, object] of this.objects) {
      if (!ids.has(id)) { object.removeFromParent(); this.objects.delete(id); this.signatures.delete(id); }
    }
    for (const node of graph.nodes) this.objectFor(node);
    for (const node of graph.nodes) {
      const object = this.objects.get(node.id);
      const parent = node.parentId ? this.objects.get(node.parentId) : this.content;
      if (object && parent && object.parent !== parent) parent.add(object);
    }
    this.applyPoses(this.posesOf(graph, stateId));
    this.refreshHelpers();
  }

  /** Moves every object to the state's pose over the duration (eased, no overshoot), or at once. */
  animateToState(stateId: string, durationMs: number, onDone?: () => void): void {
    if (!this.graph) return;
    const target = this.posesOf(this.graph, stateId);
    this.cancelTween();
    if (durationMs <= 0) { this.applyPoses(target); this.renderNow(); onDone?.(); return; }
    const from = this.poses;
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      this.applyPoses(this.blend(from, target, easeOut(t)));
      this.renderNow();
      if (t < 1) this.tween = requestAnimationFrame(step);
      else { this.tween = null; onDone?.(); }
    };
    this.tween = requestAnimationFrame(step);
  }

  /** Shows a blend between two states' poses, in proportion (0 is the first, 1 the second). */
  showBlend(fromState: string, toState: string, amount: number): void {
    if (!this.graph) return;
    this.cancelTween();
    this.applyPoses(this.blend(this.posesOf(this.graph, fromState), this.posesOf(this.graph, toState), amount));
    this.renderNow();
  }

  private blend(a: Map<string, Pose>, b: Map<string, Pose>, t: number): Map<string, Pose> {
    const out = new Map<string, Pose>();
    for (const [id, to] of b) {
      const from = a.get(id) ?? to;
      const qa = new THREE.Quaternion().setFromEuler(from.rotation), qb = new THREE.Quaternion().setFromEuler(to.rotation);
      out.set(id, {
        position: from.position.clone().lerp(to.position, t), rotation: new THREE.Euler().setFromQuaternion(qa.slerp(qb, t)),
        scale: from.scale.clone().lerp(to.scale, t), visible: t < 0.5 ? from.visible : to.visible,
      });
    }
    return out;
  }

  private cancelTween(): void {
    if (this.tween !== null) cancelAnimationFrame(this.tween);
    this.tween = null;
  }

  // --- Outlines --------------------------------------------------------------------------------------------------

  setHighlight(ids: string[]): void {
    for (const helper of this.outlines) { helper.removeFromParent(); helper.dispose(); }
    this.outlines = ids.flatMap((id) => {
      const object = this.objects.get(id);
      if (!object) return [];
      const helper = new THREE.BoxHelper(object, COBALT);
      this.scene.add(helper);
      return [helper];
    });
  }

  setSelection(id: string | null): void {
    if (this.selection) { this.selection.removeFromParent(); this.selection.dispose(); this.selection = null; }
    const object = id ? this.objects.get(id) : undefined;
    if (!object) return;
    this.selection = new THREE.BoxHelper(object, INK);
    this.scene.add(this.selection);
  }

  private refreshHelpers(): void {
    for (const helper of [...this.outlines, ...(this.selection ? [this.selection] : [])]) helper.update();
  }

  // --- Camera --------------------------------------------------------------------------------------------------

  /** Points the orbit camera at the drawn objects. */
  frame(): void {
    const box = new THREE.Box3();
    this.content.traverse((o) => { if (o instanceof THREE.Mesh) box.expandByObject(o); });
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(2, 2, 2));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.orbit.target.copy(sphere.center);
    this.orbit.distance = Math.max(1.5, (sphere.radius / Math.sin((this.camera.fov * DEG) / 2)) * 1.25);
  }

  orbitBy(dYaw: number, dPitch: number): void {
    this.orbit.yaw += dYaw;
    this.orbit.pitch = Math.max(-1.45, Math.min(1.45, this.orbit.pitch + dPitch));
    this.requestRender();
  }

  zoomBy(factor: number): void {
    this.orbit.distance = Math.max(0.5, Math.min(80, this.orbit.distance * factor));
    this.requestRender();
  }

  panBy(dx: number, dy: number): void {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const scale = this.orbit.distance * 0.0015;
    this.orbit.target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
    this.requestRender();
  }

  setCameraView(view: CameraView): void {
    const offset = new THREE.Vector3(...view.position).sub(new THREE.Vector3(...view.target));
    this.orbit.target.set(...view.target);
    this.orbit.distance = Math.max(0.5, offset.length());
    this.orbit.yaw = Math.atan2(offset.x, offset.z);
    this.orbit.pitch = Math.asin(Math.max(-1, Math.min(1, offset.y / this.orbit.distance)));
    this.camera.fov = view.fov;
    this.camera.updateProjectionMatrix();
    this.renderNow();
  }

  private placeCamera(): void {
    const { yaw, pitch, distance, target } = this.orbit;
    this.camera.position.set(
      target.x + distance * Math.cos(pitch) * Math.sin(yaw), target.y + distance * Math.sin(pitch), target.z + distance * Math.cos(pitch) * Math.cos(yaw));
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
  }

  // --- Rendering -----------------------------------------------------------------------------------------------

  resize(): void {
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.floor(width * this.renderer.getPixelRatio()) || this.camera.aspect !== width / height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  renderNow(): void {
    this.resize();
    this.placeCamera();
    this.refreshHelpers();
    this.renderer.render(this.scene, this.camera);
    this.onRender?.();
  }

  requestRender(): void {
    if (this.pendingFrame !== null) return;
    this.pendingFrame = requestAnimationFrame(() => { this.pendingFrame = null; this.renderNow(); });
  }

  /** The node's centre on screen, in CSS pixels from the canvas's top left, or null when behind the camera. */
  project(id: string): { x: number; y: number } | null {
    const object = this.objects.get(id);
    if (!object || !object.visible) return null;
    const box = new THREE.Box3().setFromObject(object);
    const point = (box.isEmpty() ? object.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3())).project(this.camera);
    if (point.z > 1) return null;
    return { x: ((point.x + 1) / 2) * this.canvas.clientWidth, y: ((1 - point.y) / 2) * this.canvas.clientHeight };
  }

  pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(pointer, this.camera);
    for (const hit of ray.intersectObject(this.content, true)) {
      let object: THREE.Object3D | null = hit.object;
      while (object && typeof object.userData.nodeId !== "string") object = object.parent;
      if (object && object.visible) return String(object.userData.nodeId);
    }
    return null;
  }

  /** Drag orbits, the wheel or a pinch zooms, a two-finger drag pans; a click without a drag picks. */
  attachPointer(onPick: ((id: string | null) => void) | null, onUserMove: () => void = () => undefined): () => void {
    const canvas = this.canvas;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let lastPinch = 0;
    const down = (e: PointerEvent) => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; canvas.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 1) this.orbitBy(-dx * 0.008, dy * 0.008);
      else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const pinch = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) this.zoomBy(lastPinch / pinch);
        lastPinch = pinch;
        this.panBy(dx / 2, dy / 2);
      }
      onUserMove();
      this.renderNow();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      lastPinch = 0;
      if (moved < 4 && onPick) onPick(this.pick(e.clientX, e.clientY));
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); this.zoomBy(1 + Math.sign(e.deltaY) * 0.08); onUserMove(); };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }

  /** A still of the current view as PNG bytes. */
  snapshot(): Promise<Blob | null> {
    this.renderNow();
    return new Promise((resolve) => this.canvas.toBlob(resolve, "image/png"));
  }

  dispose(): void {
    this.cancelTween();
    if (this.pendingFrame !== null) cancelAnimationFrame(this.pendingFrame);
    this.renderer.dispose();
  }
}
