// The 3D stage: real meshes through WebGL, bundled three.js, no idle motion.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Camera, WorkingPart } from '../shared/working';

export interface StageHooks {
  step: number;
  explode: number;
  yaw: number;
  pitch: number;
  zoom: number;
  state: 'loading' | 'ready' | 'preview' | 'error' | 'still';
}

export interface FocusStyle {
  /** Field text colour for non-focus silhouettes. */
  silhouetteColor: THREE.Color;
  /** Focus parts keep their own materials with this outline colour. */
  outlineColor: THREE.Color;
}

export interface StageOptions {
  onAttributes?: (hooks: StageHooks) => void;
}

export class Stage {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private root: HTMLElement;
  private canvas: HTMLCanvasElement | null = null;
  private nodesByPath = new Map<string, THREE.Object3D>();
  private originalPositions = new Map<THREE.Object3D, THREE.Vector3>();
  private partPaths: WorkingPart[] = [];
  private focusIds = new Set<string>();
  private silhouetteColor = new THREE.Color('#241a12');
  private outlineColor = new THREE.Color('#ffffff');
  private savedMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private outlineMeshes = new Map<string, THREE.Mesh>();
  private modelRoot: THREE.Object3D | null = null;
  private modelScale = 1;
  private disposed = false;
  private drawCalls = 0;
  private vertexBytes = 0;

  // View state.
  yaw = 30;
  pitch = 15;
  zoom = 1;
  explode = 0;
  step = 0;
  state: StageHooks['state'] = 'loading';
  private distance = 3;

  constructor(root: HTMLElement, options: StageOptions = {}) {
    this.root = root;
    root.setAttribute('data-step', '0');
    root.setAttribute('data-explode', '0.000');
    root.setAttribute('data-yaw', '30');
    root.setAttribute('data-pitch', '15');
    root.setAttribute('data-zoom', '1.00');
    root.setAttribute('data-state', 'loading');
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
    this.camera.matrixAutoUpdate = true;
    this.options = options;
    void options;
  }

  private options: StageOptions;

  /** WebGL support probe; the reader falls back to stills without it. */
  static hasWebGL(): boolean {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      return false;
    }
  }

  attach(): boolean {
    if (this.disposed) return false;
    if (!Stage.hasWebGL()) return false;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    this.renderer = renderer;
    this.canvas = canvas;
    this.root.appendChild(canvas);
    // The stage resizes whenever its box changes, now that it is attached.
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.resize();
    this.startFrameLoop();
    return true;
  }

  private resizeObserver: ResizeObserver | null = null;

  resize(): void {
    const width = this.root.clientWidth || 1;
    const height = this.root.clientHeight || 1;
    this.renderer?.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private frameStop: (() => void) | null = null;

  private startFrameLoop(): void {
    let running = true;
    const loop = (): void => {
      if (!running || this.disposed) return;
      this.renderOnce();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    this.frameStop = () => {
      running = false;
    };
  }

  /** Applies the apart amount and pose, draws one frame, updates the hooks. */
  renderOnce(): void {
    if (!this.renderer) return;
    this.applyOffsets();
    const radius = this.distance / this.zoom;
    const yawRad = (this.yaw * Math.PI) / 180;
    const pitchRad = (this.pitch * Math.PI) / 180;
    this.camera.position.set(
      radius * Math.cos(pitchRad) * Math.sin(yawRad),
      radius * Math.sin(pitchRad),
      radius * Math.cos(pitchRad) * Math.cos(yawRad),
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.drawCalls = this.renderer.info.render.calls;
    this.vertexBytes = this.renderer.info.memory.geometries;
    this.publish();
  }

  private publish(): void {
    const hooks: StageHooks = {
      step: this.step,
      explode: this.explode,
      yaw: this.yaw,
      pitch: this.pitch,
      zoom: this.zoom,
      state: this.state,
    };
    this.root.setAttribute('data-step', String(hooks.step));
    this.root.setAttribute('data-explode', hooks.explode.toFixed(3));
    let yaw = Math.round(hooks.yaw);
    yaw = ((yaw + 180) % 360 + 360) % 360 - 180;
    this.root.setAttribute('data-yaw', String(yaw));
    this.root.setAttribute('data-pitch', String(Math.round(hooks.pitch)));
    this.root.setAttribute('data-zoom', hooks.zoom.toFixed(2));
    this.root.setAttribute('data-state', hooks.state);
    this.options.onAttributes?.(hooks);
  }

  setState(state: StageHooks['state']): void {
    this.state = state;
    this.publish();
  }

  setStep(step: number): void {
    this.step = step;
    this.publish();
  }

  setPose(pose: Camera): void {
    this.yaw = pose.yaw;
    this.pitch = pose.pitch;
    this.zoom = pose.zoom;
    this.publish();
  }

  setExplode(value: number): void {
    this.explode = Math.max(0, Math.min(1, value));
    this.publish();
  }

  setStyle(silhouette: string, outline: string): void {
    this.silhouetteColor = new THREE.Color(silhouette);
    this.outlineColor = new THREE.Color(outline);
    this.applyStyle();
  }

  /** Focus parts keep materials; everything else renders as a flat silhouette. */
  setFocusParts(partIds: string[]): void {
    this.focusIds = new Set(partIds);
    this.applyStyle();
  }

  private applyStyle(): void {
    const partByPath = new Map(this.partPaths.map((part) => [part.node_path, part]));
    // A node's own meshes only: descendant parts style themselves.
    const ownMeshes = (node: THREE.Object3D): THREE.Mesh[] => {
      const out: THREE.Mesh[] = [];
      if ((node as THREE.Mesh).isMesh) out.push(node as THREE.Mesh);
      for (const child of node.children) {
        const childPath = child.userData.pwPath as string | undefined;
        if (childPath !== undefined && partByPath.has(childPath)) continue;
        out.push(...ownMeshes(child));
      }
      return out;
    };
    for (const [path, node] of this.nodesByPath) {
      const part = partByPath.get(path);
      if (!part) continue;
      const focused = this.focusIds.has(part.id);
      const silhouette = new THREE.MeshBasicMaterial({ color: this.silhouetteColor });
      for (const mesh of ownMeshes(node)) {
        const saved = this.savedMaterials.get(mesh);
        if (!saved) continue;
        mesh.material = focused ? saved : silhouette;
      }
    }
  }

  private applyOffsets(): void {
    for (const part of this.partPaths) {
      const node = this.nodesByPath.get(part.node_path);
      if (!node) continue;
      const original = this.originalPositions.get(node);
      if (!original) continue;
      const offsetMm = part.apart_mm * this.explode * this.modelScale / 1000;
      const axis = part.axis;
      node.position.copy(original);
      if (axis === 'x') node.position.x += offsetMm;
      if (axis === 'y') node.position.y += offsetMm;
      if (axis === 'z') node.position.z += offsetMm;
    }
  }

  async loadModelUrl(url: string): Promise<{ ok: boolean; error?: string }> {
    this.setState('loading');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(url);
      this.setModel(gltf.scene);
      this.setState('ready');
      return { ok: true };
    } catch (error) {
      this.setState('error');
      return { ok: false, error: String(error) };
    }
  }

  async loadModelBytes(data: ArrayBuffer): Promise<{ ok: boolean; error?: string }> {
    this.setState('loading');
    try {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(data, '');
      this.setModel(gltf.scene);
      this.setState('preview');
      return { ok: true };
    } catch (error) {
      this.setState('error');
      return { ok: false, error: String(error) };
    }
  }

  private setModel(root: THREE.Object3D): void {
    this.clearModel();
    this.modelRoot = root;
    this.scene.add(root);
    this.buildNodePaths(root);
    // Centre and frame the model; compute camera distance from the bounding sphere.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    root.position.sub(center);
    const radius = Math.max(size.x, size.y, size.z) || 1;
    this.distance = radius * 1.8;
    // Store original positions after centring.
    this.originalPositions.clear();
    for (const node of this.nodesByPath.values()) {
      this.originalPositions.set(node, node.position.clone());
    }
  }

  private clearModel(): void {
    if (this.modelRoot) {
      this.scene.remove(this.modelRoot);
      this.modelRoot.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        }
      });
    }
    this.modelRoot = null;
    this.nodesByPath.clear();
    this.savedMaterials.clear();
    this.originalPositions.clear();
    this.outlineMeshes.clear();
  }

  /** Builds the strict node paths, numbering segments among same-named siblings. */
  private buildNodePaths(root: THREE.Object3D): void {
    const walk = (node: THREE.Object3D, prefix: string): void => {
      const counts = new Map<string, number>();
      const segments = new Map<THREE.Object3D, string>();
      for (const child of node.children) {
        const name = child.name.length > 0 ? child.name : 'node';
        const k = counts.get(name) ?? 0;
        counts.set(name, k + 1);
        segments.set(child, `${name}[${k}]`);
      }
      for (const child of node.children) {
        const segment = segments.get(child);
        if (segment === undefined) continue;
        const path = prefix.length === 0 ? segment : `${prefix}/${segment}`;
        if ((child as THREE.Mesh).isMesh) {
          this.nodesByPath.set(path, child);
        }
        child.userData.pwPath = path;
        walk(child, path);
      }
    };
    const counts = new Map<string, number>();
    const segments = new Map<THREE.Object3D, string>();
    for (const child of root.children) {
      const name = child.name.length > 0 ? child.name : 'node';
      const k = counts.get(name) ?? 0;
      counts.set(name, k + 1);
      segments.set(child, `${name}[${k}]`);
    }
    for (const child of root.children) {
      const segment = segments.get(child);
      if (segment === undefined) continue;
      if ((child as THREE.Mesh).isMesh) {
        this.nodesByPath.set(segment, child);
      }
      child.userData.pwPath = segment;
      walk(child, segment);
    }
    // Remember every material so silhouettes and focus can swap cleanly.
    for (const node of this.nodesByPath.values()) {
      node.traverse((child) => {
        if (child instanceof THREE.Mesh) this.savedMaterials.set(child, child.material);
      });
    }
  }

  /** Projects a part's centre to screen coordinates, or null when hidden. */
  projectPart(nodePath: string): { x: number; y: number } | null {
    const node = this.nodesByPath.get(nodePath);
    if (!node || !this.renderer) return null;
    const box = new THREE.Box3().setFromObject(node);
    const center = box.getCenter(new THREE.Vector3());
    const projected = center.clone().project(this.camera);
    if (projected.z > 1) return null;
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    return {
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
    };
  }

  /** The node paths of the loaded model, used by Bind to node. */
  nodePaths(): string[] {
    return [...this.nodesByPath.keys()];
  }

  setParts(parts: WorkingPart[], scale: number): void {
    this.partPaths = parts;
    this.modelScale = scale;
    this.applyStyle();
  }

  stats(): { drawCalls: number; vertexBytes: number } {
    return { drawCalls: this.drawCalls, vertexBytes: this.vertexBytes };
  }

  dispose(): void {
    this.disposed = true;
    this.frameStop?.();
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
    this.canvas?.remove();
    this.renderer = null;
  }
}
