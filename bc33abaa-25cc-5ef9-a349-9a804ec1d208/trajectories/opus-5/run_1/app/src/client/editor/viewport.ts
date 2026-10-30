import * as THREE from 'three';
import {
  Graph,
  REST_STATE_ID,
  SceneNode,
  SceneState,
  Vec3,
  resolveNodeInState,
} from '../../shared/graph';

export interface ViewportOptions {
  canvas: HTMLCanvasElement;
  onPick?: (nodeId: string | null) => void;
  onYaw?: (yaw: number) => void;
}

interface NodeView {
  object: THREE.Object3D;
  nodeId: string;
}

const DEG = Math.PI / 180;

function geometryFor(node: SceneNode): THREE.BufferGeometry {
  switch (node.primitive) {
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 24);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    default:
      return new THREE.BoxGeometry(0.4, 0.4, 0.4);
  }
}

function materialFor(node: SceneNode): THREE.Material {
  const base = node.materialLayers.find((layer) => layer.type === 'base') ?? node.materialLayers[0];
  const clearcoat = node.materialLayers.find((layer) => layer.type === 'clearcoat');
  const emission = node.materialLayers.find((layer) => layer.type === 'emission');
  const sheen = node.materialLayers.find((layer) => layer.type === 'sheen');
  const colour = base ? new THREE.Color(base.color[0], base.color[1], base.color[2]) : new THREE.Color(0.62, 0.6, 0.56);
  const material = new THREE.MeshPhysicalMaterial({
    color: colour,
    roughness: base ? base.roughness : 0.7,
    metalness: base ? base.metalness : 0.05,
  });
  if (clearcoat) {
    material.clearcoat = 1 - clearcoat.roughness;
    material.clearcoatRoughness = clearcoat.roughness;
  }
  if (sheen) {
    material.sheen = 1;
    material.sheenColor = new THREE.Color(sheen.color[0], sheen.color[1], sheen.color[2]);
    material.sheenRoughness = sheen.roughness;
  }
  if (emission) {
    material.emissive = new THREE.Color(emission.color[0], emission.color[1], emission.color[2]);
    material.emissiveIntensity = 1 - emission.roughness;
  }
  return material;
}

export class Viewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly root = new THREE.Group();
  private readonly views = new Map<string, NodeView>();
  private readonly outlines = new Map<string, THREE.LineSegments>();
  private readonly raycaster = new THREE.Raycaster();
  private graph: Graph | null = null;
  private stateId: string = REST_STATE_ID;
  private orbit = { yaw: 0.6, pitch: 0.25, distance: 5 };
  private target = new THREE.Vector3(0, 0.4, 0);
  private disposed = false;

  constructor(private readonly options: ViewportOptions) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setClearColor(0xf6f3ea, 1);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 400);
    this.scene.add(this.root);
    const ambient = new THREE.HemisphereLight(0xfdfaf2, 0x8d8a7f, 1.1);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(2.4, 3.2, 2.4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe4ff, 0.5);
    fill.position.set(-2.5, 1.5, -2);
    this.scene.add(fill);
    this.bindPointer();
    this.resize();
    this.renderFrame();
  }

  private bindPointer(): void {
    const canvas = this.options.canvas;
    const active = new Map<number, { x: number; y: number }>();
    let moved = false;
    let last = { x: 0, y: 0 };
    let pinch: { distance: number; midpoint: { x: number; y: number } } | null = null;

    const gesture = (): { distance: number; midpoint: { x: number; y: number } } | null => {
      if (active.size < 2) return null;
      const [first, second] = [...active.values()];
      if (!first || !second) return null;
      return {
        distance: Math.hypot(first.x - second.x, first.y - second.y),
        midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
      };
    };

    canvas.addEventListener('pointerdown', (event) => {
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      moved = false;
      last = { x: event.clientX, y: event.clientY };
      pinch = gesture();
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener('pointermove', (event) => {
      if (!active.has(event.pointerId)) return;
      active.set(event.pointerId, { x: event.clientX, y: event.clientY });
      // Two pointers pan and pinch; one pointer orbits.
      const current = gesture();
      if (current && pinch) {
        moved = true;
        this.target.x -= (current.midpoint.x - pinch.midpoint.x) * 0.01;
        this.target.y += (current.midpoint.y - pinch.midpoint.y) * 0.01;
        this.orbit.distance = Math.max(
          0.6,
          Math.min(40, this.orbit.distance - (current.distance - pinch.distance) * 0.01),
        );
        pinch = current;
        this.renderFrame();
        return;
      }
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      last = { x: event.clientX, y: event.clientY };
      if (event.shiftKey) {
        this.target.x -= dx * 0.01;
        this.target.y += dy * 0.01;
      } else {
        this.orbit.yaw -= dx * 0.01;
        this.orbit.pitch = Math.max(-1.3, Math.min(1.3, this.orbit.pitch + dy * 0.01));
      }
      this.renderFrame();
    });

    const release = (event: PointerEvent): void => {
      if (!active.has(event.pointerId)) return;
      const wasPinching = active.size > 1;
      active.delete(event.pointerId);
      pinch = gesture();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (!moved && !wasPinching) this.pick(event);
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.orbit.distance = Math.max(0.6, Math.min(40, this.orbit.distance + event.deltaY * 0.004));
        this.renderFrame();
      },
      { passive: false },
    );
  }

  private pick(event: PointerEvent): void {
    if (!this.options.onPick) return;
    const rect = this.options.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.root.children, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        const nodeId = object.userData.nodeId as string | undefined;
        if (nodeId) {
          this.options.onPick(nodeId);
          return;
        }
        object = object.parent;
      }
    }
    this.options.onPick(null);
  }

  orbitBy(yawDegrees: number, pitchDegrees: number): void {
    this.orbit.yaw += yawDegrees * DEG;
    this.orbit.pitch = Math.max(-1.3, Math.min(1.3, this.orbit.pitch + pitchDegrees * DEG));
    this.renderFrame();
  }

  setYaw(yawDegrees: number): void {
    this.orbit.yaw = yawDegrees * DEG;
    this.renderFrame();
  }

  get yawDegrees(): number {
    const degrees = (this.orbit.yaw / DEG) % 360;
    return degrees < 0 ? degrees + 360 : degrees;
  }

  setGraph(graph: Graph, stateId: string = REST_STATE_ID): void {
    this.graph = graph;
    this.stateId = stateId;
    this.rebuild();
  }

  setState(stateId: string): void {
    this.stateId = stateId;
    this.rebuild();
  }

  /** Blends between two states, used by the embed's transitions. */
  setBlend(fromStateId: string, toStateId: string, progress: number): void {
    if (!this.graph) return;
    const from = this.graph.states.find((state) => state.id === fromStateId);
    const to = this.graph.states.find((state) => state.id === toStateId);
    for (const node of this.graph.nodes) {
      const view = this.views.get(node.id);
      if (!view) continue;
      const a = resolveNodeInState(node, from);
      const b = resolveNodeInState(node, to);
      const mix = (left: Vec3, right: Vec3): Vec3 => [
        left[0] + (right[0] - left[0]) * progress,
        left[1] + (right[1] - left[1]) * progress,
        left[2] + (right[2] - left[2]) * progress,
      ];
      this.placeObject(view.object, {
        ...a,
        position: mix(a.position, b.position),
        rotation: mix(a.rotation, b.rotation),
        scale: mix(a.scale, b.scale),
        visible: progress >= 0.5 ? b.visible : a.visible,
      });
    }
    this.renderFrame();
  }

  private placeObject(object: THREE.Object3D, node: SceneNode): void {
    object.position.set(node.position[0], node.position[1], node.position[2]);
    object.rotation.set(node.rotation[0] * DEG, node.rotation[1] * DEG, node.rotation[2] * DEG);
    object.scale.set(node.scale[0], node.scale[1], node.scale[2]);
    object.visible = node.visible;
  }

  private rebuild(): void {
    for (const child of [...this.root.children]) this.root.remove(child);
    this.views.clear();
    this.outlines.clear();
    if (!this.graph) {
      this.renderFrame();
      return;
    }
    const state: SceneState | undefined = this.graph.states.find(
      (candidate) => candidate.id === this.stateId,
    );
    const objects = new Map<string, THREE.Object3D>();
    for (const node of this.graph.nodes) {
      const resolved = resolveNodeInState(node, state);
      let object: THREE.Object3D;
      if (node.kind === 'mesh') {
        object = new THREE.Mesh(geometryFor(node), materialFor(node));
      } else if (node.kind === 'light') {
        object = new THREE.Group();
        const bulb = new THREE.Mesh(
          new THREE.SphereGeometry(0.08, 12, 8),
          new THREE.MeshBasicMaterial({ color: 0xffe9a8 }),
        );
        object.add(bulb);
      } else if (node.kind === 'camera') {
        object = new THREE.Group();
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.18, 0.12, 0.3),
          new THREE.MeshBasicMaterial({ color: 0x1b4fd8, wireframe: true }),
        );
        object.add(body);
      } else {
        object = new THREE.Group();
      }
      object.userData.nodeId = node.id;
      this.placeObject(object, resolved);
      objects.set(node.id, object);
      this.views.set(node.id, { object, nodeId: node.id });
    }
    for (const node of this.graph.nodes) {
      const object = objects.get(node.id);
      if (!object) continue;
      const parent = node.parentId === null ? this.root : objects.get(node.parentId) ?? this.root;
      parent.add(object);
    }
    this.renderFrame();
  }

  highlight(nodeIds: string[]): void {
    for (const [nodeId, outline] of this.outlines) {
      outline.removeFromParent();
      this.outlines.delete(nodeId);
    }
    for (const nodeId of nodeIds) {
      const view = this.views.get(nodeId);
      if (!view) continue;
      const box = new THREE.Box3().setFromObject(view.object);
      if (box.isEmpty()) continue;
      const size = new THREE.Vector3();
      const centre = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(centre);
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x * 1.08, size.y * 1.08, size.z * 1.08)),
        new THREE.LineBasicMaterial({ color: 0x1b4fd8 }),
      );
      outline.position.copy(centre);
      this.root.add(outline);
      this.outlines.set(nodeId, outline);
    }
    this.renderFrame();
  }

  /** The camera as a named view would store it. */
  cameraState(): { position: Vec3; target: Vec3; fov: number } {
    return {
      position: [
        Number(this.camera.position.x.toFixed(4)),
        Number(this.camera.position.y.toFixed(4)),
        Number(this.camera.position.z.toFixed(4)),
      ],
      target: [
        Number(this.target.x.toFixed(4)),
        Number(this.target.y.toFixed(4)),
        Number(this.target.z.toFixed(4)),
      ],
      fov: Math.round(this.camera.fov),
    };
  }

  /** A PNG of the current frame, used as a version thumbnail. */
  async snapshot(): Promise<Blob | null> {
    this.renderFrame();
    return new Promise((resolve) => {
      this.options.canvas.toBlob((blob) => resolve(blob), 'image/png');
    });
  }

  /** Screen position of a node, as a fraction of the canvas, for comment pins. */
  project(nodeId: string): { x: number; y: number } | null {
    const view = this.views.get(nodeId);
    if (!view) return null;
    const position = new THREE.Vector3();
    view.object.getWorldPosition(position);
    position.project(this.camera);
    if (position.z > 1) return null;
    return { x: (position.x + 1) / 2, y: (1 - position.y) / 2 };
  }

  resize(): void {
    const canvas = this.options.canvas;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderFrame();
  }

  renderFrame(): void {
    if (this.disposed) return;
    const { yaw, pitch, distance } = this.orbit;
    this.camera.position.set(
      this.target.x + distance * Math.cos(pitch) * Math.sin(yaw),
      this.target.y + distance * Math.sin(pitch),
      this.target.z + distance * Math.cos(pitch) * Math.cos(yaw),
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
    this.options.onYaw?.(this.yawDegrees);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.dispose();
  }
}

export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ??
        canvas.getContext('webgl') ??
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}
