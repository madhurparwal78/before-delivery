import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { nodePathsByIndex, type GltfDocument } from '../shared/glb.js';
import { addFrameTask } from './motion.js';
import {
  clampPitch,
  clampZoom,
  wrapYaw,
  PITCH_KEY_STEP,
  YAW_KEY_STEP,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  DRAG_PX_PER_DEGREE,
} from '../shared/scrollmap.js';
import type { Part } from '../shared/types.js';

export interface StagePose {
  explode: number;
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface FieldColours {
  field: string;
  text: string;
}

/** The silhouette shader changes ink per pixel exactly on a passing field edge. */
const SILHOUETTE_VERTEX = `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SILHOUETTE_FRAGMENT = `
uniform vec3 inkAbove;
uniform vec3 inkBelow;
uniform float edge;
void main() {
  gl_FragColor = vec4(gl_FragCoord.y > edge ? inkAbove : inkBelow, 1.0);
}`;

interface StagePart {
  part: Part;
  node: Object3D;
  /** The node's own position before any apart offset. */
  restPosition: Vector3;
  meshes: Mesh[];
  ownMaterials: Map<Mesh, Mesh['material']>;
  outline: LineSegments | null;
}

export interface StageOptions {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
}

export class Stage {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly root = new Group();
  private readonly silhouette: ShaderMaterial;
  private readonly outlineMaterial = new LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
  private parts: StagePart[] = [];
  private focus = new Set<string>();
  private modelScale = 1;
  private baseDistance = 1;
  private centre = new Vector3();
  private pose: StagePose = { explode: 0, yaw: 30, pitch: 15, zoom: 1 };
  private colours: FieldColours = { field: '#F4EDE2', text: '#1A1310' };
  private nextColours: FieldColours | null = null;
  private edgeViewportY: number | null = null;
  private needsDraw = true;
  private drawn = false;

  constructor(options: StageOptions) {
    this.element = options.element;
    this.canvas = options.canvas;
    this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearAlpha(0);
    this.camera = new PerspectiveCamera(38, 1, 0.01, 100);
    this.scene.add(this.root);
    this.scene.add(new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xffffff, 1.5);
    key.position.set(2, 3, 4);
    this.scene.add(key);
    this.silhouette = new ShaderMaterial({
      vertexShader: SILHOUETTE_VERTEX,
      fragmentShader: SILHOUETTE_FRAGMENT,
      uniforms: {
        inkAbove: { value: new Color(this.colours.text) },
        inkBelow: { value: new Color(this.colours.text) },
        edge: { value: -1 },
      },
    });
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.invalidate();
    });
    addFrameTask(() => {
      if (this.needsDraw) this.draw();
      return true;
    });
  }

  invalidate(): void {
    this.needsDraw = true;
  }

  get hasDrawn(): boolean {
    return this.drawn;
  }

  setState(state: string): void {
    this.element.setAttribute('data-state', state);
  }

  async load(url: string, parts: readonly Part[], scale: number): Promise<void> {
    this.adopt(await new GLTFLoader().loadAsync(url), parts, scale);
  }

  /** Draws a dropped file without sending anything to the server. */
  async loadBuffer(bytes: ArrayBuffer, parts: readonly Part[], scale: number): Promise<void> {
    this.adopt(await new GLTFLoader().parseAsync(bytes, ''), parts, scale);
  }

  private adopt(gltf: GLTF, parts: readonly Part[], scale: number): void {
    this.root.clear();
    this.root.add(gltf.scene);
    this.modelScale = scale;
    this.bind(gltf, parts);
    this.frameModel();
    this.applyPose(this.pose);
    this.invalidate();
  }

  /**
   * Binds parts to their nodes by node path, read from the glTF node indices
   * so a loader's node renaming cannot break the binding.
   */
  private bind(gltf: GLTF, parts: readonly Part[]): void {
    const parser = gltf.parser;
    const pathByIndex = nodePathsByIndex(parser.json as GltfDocument);
    const byPath = new Map<string, Object3D>();
    for (const [object, association] of parser.associations) {
      const index = (association as { nodes?: number }).nodes;
      if (index === undefined) continue;
      const path = pathByIndex.get(index);
      if (path !== undefined) byPath.set(path, object as Object3D);
    }

    this.parts = [];
    for (const part of parts) {
      if (part.node_path === null) continue;
      const node = byPath.get(part.node_path);
      if (node === undefined) continue;
      const meshes: Mesh[] = [];
      node.traverse((child) => {
        if ((child as Mesh).isMesh) meshes.push(child as Mesh);
      });
      const ownMaterials = new Map<Mesh, Mesh['material']>();
      for (const mesh of meshes) ownMaterials.set(mesh, mesh.material);
      const first = meshes[0];
      let outline: LineSegments | null = null;
      if (first !== undefined) {
        outline = new LineSegments(new EdgesGeometry(first.geometry), this.outlineMaterial);
        outline.visible = false;
        first.add(outline);
      }
      this.parts.push({
        part,
        node,
        restPosition: node.position.clone(),
        meshes,
        ownMaterials,
        outline,
      });
    }
  }

  /** Frames the model at full apart, so an exploded step still fits the stage. */
  private frameModel(): void {
    const box = new Box3().setFromObject(this.root);
    box.getCenter(this.centre);
    const size = new Vector3();
    box.getSize(size);
    let widest = 0;
    for (const entry of this.parts) {
      widest = Math.max(widest, Math.abs(entry.part.apart_mm) / 1000) * 1;
    }
    const spread = widest * this.modelScale * 2;
    const radius = Math.max(size.x + spread, size.y + spread, size.z + spread, 0.01) * 0.5;
    this.baseDistance = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.5;
  }

  setFocus(partIds: readonly string[]): void {
    this.focus = new Set(partIds);
    this.applyMaterials();
    this.invalidate();
  }

  setColours(current: FieldColours, next: FieldColours | null, edgeViewportY: number | null): void {
    this.colours = current;
    this.nextColours = next;
    this.edgeViewportY = edgeViewportY;
    this.applyMaterials();
    this.invalidate();
  }

  setModelScale(scale: number): void {
    this.modelScale = scale;
    this.applyPose(this.pose);
  }

  /**
   * Non-focus parts render as flat silhouettes in the field's text colour;
   * focus parts keep their own materials with an opposing outline.
   */
  private applyMaterials(): void {
    this.outlineMaterial.color.set(this.colours.text);
    for (const entry of this.parts) {
      const isFocus = this.focus.has(entry.part.id);
      for (const mesh of entry.meshes) {
        const own = entry.ownMaterials.get(mesh);
        mesh.material = isFocus && own !== undefined ? own : this.silhouette;
      }
      if (entry.outline !== null) entry.outline.visible = isFocus;
    }
  }

  /** A part's offset is its apart distance along its axis times the amount times the scale. */
  applyPose(pose: StagePose): void {
    this.pose = pose;
    for (const entry of this.parts) {
      const metres = (entry.part.apart_mm / 1000) * pose.explode * this.modelScale;
      const worldOffset = new Vector3(
        entry.part.axis === 'x' ? metres : 0,
        entry.part.axis === 'y' ? metres : 0,
        entry.part.axis === 'z' ? metres : 0,
      );
      const parent = entry.node.parent;
      if (parent !== null) {
        parent.updateWorldMatrix(true, false);
        const toParent = new Matrix4().copy(parent.matrixWorld).invert();
        toParent.setPosition(0, 0, 0);
        worldOffset.applyMatrix4(toParent);
      }
      entry.node.position.copy(entry.restPosition).add(worldOffset);
    }
    this.writeHooks();
    this.invalidate();
  }

  get currentPose(): StagePose {
    return { ...this.pose };
  }

  private writeHooks(): void {
    this.element.setAttribute('data-explode', this.pose.explode.toFixed(3));
    this.element.setAttribute('data-yaw', String(Math.round(wrapYaw(this.pose.yaw))));
    this.element.setAttribute('data-pitch', String(Math.round(this.pose.pitch)));
    this.element.setAttribute('data-zoom', this.pose.zoom.toFixed(2));
  }

  private resize(): void {
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private draw(): void {
    this.needsDraw = false;
    if (this.canvas.width !== Math.round(this.element.clientWidth * this.renderer.getPixelRatio())) {
      this.resize();
    }
    const yaw = (wrapYaw(this.pose.yaw) * Math.PI) / 180;
    const pitch = (this.pose.pitch * Math.PI) / 180;
    const distance = this.baseDistance / this.pose.zoom;
    this.camera.position.set(
      this.centre.x + distance * Math.cos(pitch) * Math.sin(yaw),
      this.centre.y + distance * Math.sin(pitch),
      this.centre.z + distance * Math.cos(pitch) * Math.cos(yaw),
    );
    this.camera.lookAt(this.centre);

    const ratio = this.renderer.getPixelRatio();
    const above = this.silhouette.uniforms['inkAbove']?.value as Color | undefined;
    const below = this.silhouette.uniforms['inkBelow']?.value as Color | undefined;
    const edge = this.silhouette.uniforms['edge'];
    if (this.edgeViewportY === null || this.nextColours === null) {
      above?.set(this.colours.text);
      below?.set(this.colours.text);
      if (edge !== undefined) edge.value = -1;
    } else {
      const bounds = this.element.getBoundingClientRect();
      const localY = this.edgeViewportY - bounds.top;
      above?.set(this.colours.text);
      below?.set(this.nextColours.text);
      if (edge !== undefined) edge.value = (bounds.height - localY) * ratio;
    }

    this.renderer.render(this.scene, this.camera);
    this.drawn = true;
    this.writeHooks();
  }

  /** The projected anchor of a focus part, in viewport coordinates. */
  anchorOf(partId: string): { x: number; y: number; hidden: boolean } | null {
    const entry = this.parts.find((candidate) => candidate.part.id === partId);
    if (entry === undefined) return null;
    const anchor = new Vector3();
    new Box3().setFromObject(entry.node).getCenter(anchor);
    const projected = anchor.clone().project(this.camera);
    const bounds = this.element.getBoundingClientRect();
    const depth = anchor.distanceTo(this.camera.position);
    let hidden = false;
    for (const other of this.parts) {
      if (other === entry || this.focus.has(other.part.id)) continue;
      const box = new Box3().setFromObject(other.node);
      const centre = new Vector3();
      box.getCenter(centre);
      if (centre.distanceTo(this.camera.position) < depth) {
        const theirs = centre.clone().project(this.camera);
        if (Math.abs(theirs.x - projected.x) < 0.06 && Math.abs(theirs.y - projected.y) < 0.06) {
          hidden = true;
          break;
        }
      }
    }
    return {
      x: bounds.left + ((projected.x + 1) / 2) * bounds.width,
      y: bounds.top + ((1 - projected.y) / 2) * bounds.height,
      hidden,
    };
  }

  orbitBy(yawDelta: number, pitchDelta: number): void {
    this.applyPose({
      ...this.pose,
      yaw: wrapYaw(this.pose.yaw + yawDelta),
      pitch: clampPitch(this.pose.pitch + pitchDelta),
    });
  }

  zoomBy(factor: number): void {
    this.applyPose({ ...this.pose, zoom: clampZoom(this.pose.zoom * factor) });
  }
}

export interface StageInputHooks {
  /** Called when the person moves the stage by hand. */
  onManualMove: () => void;
  /** Returns the pose saved for the current step, for Home. */
  savedPose: () => StagePose;
  freeLookOn: () => boolean;
}

/** The published keys, mouse drag and phone touch behaviour for a stage. */
export function attachStageInput(stage: Stage, hooks: StageInputHooks): void {
  stage.element.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case 'ArrowLeft':
        stage.orbitBy(-YAW_KEY_STEP, 0);
        break;
      case 'ArrowRight':
        stage.orbitBy(YAW_KEY_STEP, 0);
        break;
      case 'ArrowUp':
        stage.orbitBy(0, PITCH_KEY_STEP);
        break;
      case 'ArrowDown':
        stage.orbitBy(0, -PITCH_KEY_STEP);
        break;
      case '+':
      case '=':
        stage.zoomBy(ZOOM_IN_FACTOR);
        break;
      case '-':
        stage.zoomBy(ZOOM_OUT_FACTOR);
        break;
      case 'Home':
        stage.applyPose(hooks.savedPose());
        break;
      default:
        return;
    }
    event.preventDefault();
    hooks.onManualMove();
  });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  stage.element.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.pointerType === 'touch' && !hooks.freeLookOn()) return;
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    stage.element.setPointerCapture(event.pointerId);
  });
  stage.element.addEventListener('pointermove', (event: PointerEvent) => {
    if (!dragging) return;
    event.preventDefault();
    stage.orbitBy(
      (event.clientX - lastX) / DRAG_PX_PER_DEGREE,
      -(event.clientY - lastY) / DRAG_PX_PER_DEGREE,
    );
    lastX = event.clientX;
    lastY = event.clientY;
    hooks.onManualMove();
  });
  const endDrag = (): void => {
    dragging = false;
  };
  stage.element.addEventListener('pointerup', endDrag);
  stage.element.addEventListener('pointercancel', endDrag);

  let pinchStart: number | null = null;
  let pinchZoom = 1;
  stage.element.addEventListener(
    'touchstart',
    (event: TouchEvent) => {
      if (event.touches.length !== 2 || !hooks.freeLookOn()) return;
      pinchStart = touchDistance(event);
      pinchZoom = stage.currentPose.zoom;
    },
    { passive: true },
  );
  stage.element.addEventListener(
    'touchmove',
    (event: TouchEvent) => {
      if (pinchStart === null || event.touches.length !== 2) return;
      event.preventDefault();
      const ratio = touchDistance(event) / pinchStart;
      stage.applyPose({ ...stage.currentPose, zoom: clampZoom(pinchZoom * ratio) });
      hooks.onManualMove();
    },
    { passive: false },
  );
  stage.element.addEventListener('touchend', () => {
    pinchStart = null;
  });

  /* The wheel always scrolls the page and never zooms the stage. */
}

function touchDistance(event: TouchEvent): number {
  const a = event.touches[0];
  const b = event.touches[1];
  if (a === undefined || b === undefined) return 1;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

export function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return (
      probe.getContext('webgl2') !== null ||
      probe.getContext('webgl') !== null
    );
  } catch {
    return false;
  }
}
