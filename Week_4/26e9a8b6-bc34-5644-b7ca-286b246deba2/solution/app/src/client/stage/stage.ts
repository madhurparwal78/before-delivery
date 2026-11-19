import {
  AmbientLight, BackSide, Box3, BufferGeometry, Color, DirectionalLight, DoubleSide, Group, Material, Matrix3, Mesh, Object3D,
  PerspectiveCamera, Raycaster, Scene, ShaderMaterial, Vector3, WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cameraDistance, eyeOffset, FOV_DEGREES, framingRadius, partOffset } from '../../shared/camera';
import type { Bounds } from '../../shared/glb';
import type { Axis } from '../../shared/types';
import { wake, register } from '../frame-loop';
import { h } from '../dom';

interface StagePose { explode: number; yaw: number; pitch: number; zoom: number }
export interface StagePart { id: string; nodePath: string; axis: Axis; apart_mm: number }
interface Ink { above: string; below: string; edge: number }

type StageState = 'loading' | 'ready' | 'preview' | 'error' | 'still';

const PITCH_LIMIT = 60;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const DEGREES_PER_PIXEL = 0.5;
const OUTLINE_PX = 3;
const DARK_OUTLINE = [0x1f / 255, 0x15 / 255, 0x0c / 255] as const;
const LIGHT_OUTLINE = [1, 1, 1] as const;

const wrap = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const silhouetteVertex = 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const silhouetteFragment = `
uniform vec3 uInkAbove; uniform vec3 uInkBelow; uniform float uEdge; uniform float uHeight;
void main() { gl_FragColor = vec4((uHeight - gl_FragCoord.y) < uEdge ? uInkAbove : uInkBelow, 1.0); }`;
const outlineVertex = `
uniform vec2 uViewport; uniform float uThickness;
void main() {
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec3 normalView = normalize(normalMatrix * normal);
  vec2 push = normalize((projectionMatrix * vec4(normalView, 0.0)).xy + vec2(1e-6));
  clip.xy += push * uThickness * 2.0 / uViewport * clip.w;
  gl_Position = clip;
}`;
const outlineFragment = 'uniform vec3 uColour; void main() { gl_FragColor = vec4(uColour, 1.0); }';

interface Owned { mesh: Mesh; owner: string | null; original: Material | Material[]; outline: Mesh | null }

export class Stage {
  readonly element: HTMLElement;
  freeLook = false;
  /** Called after any input moves the view, so the page can react (the editor records it). */
  onViewChange: (() => void) | null = null;

  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(FOV_DEGREES, 1, 0.01, 100);
  private readonly pivot = new Group();
  private readonly canvasHost = h('div', { class: 'stage-canvas' });
  private owned: Owned[] = [];
  private offsets: { id: string; node: Object3D; base: Vector3; part: StagePart; toLocal: Matrix3 }[] = [];
  private focus = new Set<string>();
  private ownMaterials = false;
  private radius = 1;
  private mapped: StagePose = { explode: 0, yaw: 0, pitch: 0, zoom: 1 };
  private manual: { yaw: number; pitch: number; userZoom: number } | null = null;
  private dirty = true;
  private step = 0;
  private ink: Ink = { above: '#1F150C', below: '#1F150C', edge: -1 };
  private readonly silhouette: ShaderMaterial;
  private readonly outlines: { dark: ShaderMaterial; light: ShaderMaterial };
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number } | null = null;
  private readonly raycaster = new Raycaster();

  constructor(private readonly onState: (state: StageState) => void = () => undefined) {
    this.element = h('div', {
      class: 'stage', role: 'application', 'aria-label': 'Model stage', 'aria-roledescription': 'interactive 3D view', tabindex: 0,
      'data-state': 'loading', 'data-step': '0', 'data-explode': '0.000', 'data-yaw': '0', 'data-pitch': '0', 'data-zoom': '1.00',
    }, this.canvasHost);
    this.silhouette = new ShaderMaterial({
      vertexShader: silhouetteVertex, fragmentShader: silhouetteFragment, side: DoubleSide,
      uniforms: { uInkAbove: { value: rgb('#1F150C') }, uInkBelow: { value: rgb('#1F150C') }, uEdge: { value: -1 }, uHeight: { value: 1 } },
    });
    const outline = (colour: readonly number[]) => new ShaderMaterial({
      vertexShader: outlineVertex, fragmentShader: outlineFragment, side: BackSide,
      uniforms: { uColour: { value: new Vector3(...colour) }, uViewport: { value: [1, 1] }, uThickness: { value: OUTLINE_PX } },
    });
    this.outlines = { dark: outline(DARK_OUTLINE), light: outline(LIGHT_OUTLINE) };
    this.scene.add(this.camera, this.pivot, new AmbientLight(0xffffff, 1.6));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.6, 0.9, 1);
    this.camera.add(key);
    this.setupRenderer();
    this.bindInput();
    register(() => this.frame());
  }

  get webgl(): boolean {
    return this.renderer !== null;
  }

  private setupRenderer(): void {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { alpha: true, antialias: true }) ?? canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!context) return;
    this.renderer = new WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.canvasHost.append(canvas);
    new ResizeObserver(() => this.resize()).observe(this.element);
    this.resize();
  }

  private resize(): void {
    if (!this.renderer) return;
    const { clientWidth: width, clientHeight: height } = this.element;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  state(): StageState {
    return this.element.dataset.state as StageState;
  }

  setState(state: StageState): void {
    this.element.dataset.state = state;
    this.onState(state);
  }

  setStep(step: number): void {
    this.step = step;
    this.syncHooks();
  }

  /** Parses a binary glTF in the browser (no request) and returns its scene. */
  static parse(bytes: ArrayBuffer): Promise<Group> {
    return new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', (gltf) => resolve(gltf.scene), reject));
  }

  /** Shows a parsed model; `parts` bind to nodes by node path, `ownMaterials` keeps every part's own colours (a drop preview). */
  setModel(scene: Group, parts: readonly StagePart[], scale: number, bounds: Bounds, maxExplode: number, ownMaterials: boolean): void {
    this.pivot.clear();
    this.owned = [];
    this.offsets = [];
    this.ownMaterials = ownMaterials;
    scene.updateMatrixWorld(true);
    const box = new Box3().setFromObject(scene);
    const centre = box.getCenter(new Vector3());
    this.pivot.scale.setScalar(scale);
    this.pivot.position.copy(centre).multiplyScalar(-scale);
    this.pivot.add(scene);
    this.radius = framingRadius(bounds, parts, [{ explode: maxExplode }], scale);
    const byPath = new Map(parts.map((p) => [p.nodePath, p]));
    const visit = (node: Object3D, prefix: string, owner: string | null): void => {
      const counts = new Map<string, number>();
      for (const child of node.children) {
        const name = typeof child.userData.name === 'string' && child.userData.name !== '' ? child.userData.name : 'node';
        const k = counts.get(name) ?? 0;
        counts.set(name, k + 1);
        const path = `${prefix}${name}[${k}]`;
        const part = byPath.get(path);
        if (part) {
          const toLocal = new Matrix3().setFromMatrix4(child.parent!.matrixWorld.clone().invert());
          this.offsets.push({ id: part.id, node: child, base: child.position.clone(), part, toLocal });
        }
        const next = part?.id ?? owner;
        if (child instanceof Mesh) this.owned.push({ mesh: child, owner: next, original: child.material, outline: null });
        visit(child, `${path}/`, next);
      }
    };
    visit(scene, '', null);
    for (const entry of this.owned) {
      for (const material of Array.isArray(entry.original) ? entry.original : [entry.original]) material.side = DoubleSide;
    }
    this.applyOffsets();
    this.applyAppearance();
    this.invalidate();
  }

  setPose(pose: StagePose): void {
    const was = this.mapped;
    if (was.explode === pose.explode && was.yaw === pose.yaw && was.pitch === pose.pitch && was.zoom === pose.zoom) return;
    this.mapped = pose;
    this.applyOffsets();
    this.syncHooks();
    this.invalidate();
  }

  setFocus(ids: readonly string[]): void {
    if (ids.length === this.focus.size && ids.every((id) => this.focus.has(id))) return;
    this.focus = new Set(ids);
    this.applyAppearance();
    this.invalidate();
  }

  setInk(ink: Ink): void {
    const was = this.ink;
    if (was.above === ink.above && was.below === ink.below && was.edge === ink.edge) return;
    this.ink = ink;
    this.invalidate();
  }

  clearManual(): void {
    if (!this.manual) return;
    this.manual = null;
    this.syncHooks();
    this.invalidate();
  }

  hasManual(): boolean {
    return this.manual !== null;
  }

  /** The view as shown: absolute yaw and pitch, zoom relative to the step's saved distance. */
  view(): { yaw: number; pitch: number; userZoom: number } {
    return { yaw: this.manual?.yaw ?? this.mapped.yaw, pitch: this.manual?.pitch ?? this.mapped.pitch, userZoom: this.manual?.userZoom ?? 1 };
  }

  /** Screen position of a part's centre inside the stage element, and whether other parts hide it. */
  project(id: string): { x: number; y: number; hidden: boolean } | null {
    const meshes = this.owned.filter((o) => o.owner === id).map((o) => o.mesh);
    if (!meshes.length || !this.renderer) return null;
    const box = new Box3();
    for (const mesh of meshes) box.expandByObject(mesh);
    const centre = box.getCenter(new Vector3());
    const projected = centre.clone().project(this.camera);
    const hits = this.raycaster;
    hits.set(this.camera.position, centre.clone().sub(this.camera.position).normalize());
    const first = hits.intersectObjects(this.owned.map((o) => o.mesh), false)[0];
    const hidden = !!first && first.distance < this.camera.position.distanceTo(centre) - 1e-4 && !meshes.includes(first.object as Mesh);
    const width = this.element.clientWidth;
    const height = this.element.clientHeight;
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height, hidden };
  }

  invalidate(): void {
    this.dirty = true;
    wake();
  }

  private applyOffsets(): void {
    for (const entry of this.offsets) {
      const local = new Vector3(...partOffset(entry.part, this.mapped.explode)).applyMatrix3(entry.toLocal);
      entry.node.position.copy(entry.base).add(local);
    }
    this.pivot.updateMatrixWorld(true);
  }

  private outlineFor(entry: Owned): Mesh {
    if (entry.outline) return entry.outline;
    const source = entry.mesh.geometry as BufferGeometry;
    const smooth = source.clone();
    for (const name of Object.keys(smooth.attributes)) if (name !== 'position') smooth.deleteAttribute(name);
    const merged = mergeVertices(smooth, 1e-5);
    merged.computeVertexNormals();
    const colour = (Array.isArray(entry.original) ? entry.original[0] : entry.original) as { color?: Color } | undefined;
    const luminance = colour?.color ? 0.2126 * colour.color.r + 0.7152 * colour.color.g + 0.0722 * colour.color.b : 0.5;
    entry.outline = new Mesh(merged, luminance > 0.25 ? this.outlines.dark : this.outlines.light);
    entry.mesh.add(entry.outline);
    return entry.outline;
  }

  private applyAppearance(): void {
    for (const entry of this.owned) {
      const focused = this.ownMaterials || (entry.owner !== null && this.focus.has(entry.owner));
      entry.mesh.material = focused ? entry.original : this.silhouette;
      if (focused && !this.ownMaterials) this.outlineFor(entry).visible = true;
      else if (entry.outline) entry.outline.visible = false;
    }
  }

  private syncHooks(): void {
    const view = this.view();
    const d = this.element.dataset;
    d.step = String(this.step);
    d.explode = this.mapped.explode.toFixed(3);
    d.yaw = String(Math.round(wrap(view.yaw)));
    d.pitch = String(Math.round(view.pitch));
    d.zoom = view.userZoom.toFixed(2);
  }

  private frame(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    this.syncHooks();
    const renderer = this.renderer;
    if (!renderer || this.pivot.children.length === 0) return false;
    const view = this.view();
    const distance = cameraDistance(this.radius, this.mapped.zoom * view.userZoom);
    const [x, y, z] = eyeOffset(view.yaw, view.pitch, distance);
    this.camera.position.set(x, y, z);
    this.camera.near = distance / 60;
    this.camera.far = distance * 12;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    const ratio = renderer.getPixelRatio();
    const edge = this.ink.edge < 0 ? -1 : (this.ink.edge - this.element.getBoundingClientRect().top) * ratio;
    const uniforms = this.silhouette.uniforms as Record<string, { value: unknown }>;
    uniforms.uInkAbove!.value = rgb(this.ink.above);
    uniforms.uInkBelow!.value = rgb(this.ink.below);
    uniforms.uEdge!.value = this.ink.edge < 0 ? -1 : edge;
    uniforms.uHeight!.value = this.element.clientHeight * ratio;
    for (const material of Object.values(this.outlines)) {
      (material.uniforms.uViewport!.value as number[]) = [this.element.clientWidth * ratio, this.element.clientHeight * ratio];
      material.uniforms.uThickness!.value = OUTLINE_PX * ratio;
    }
    renderer.render(this.scene, this.camera);
    return false;
  }

  private nudge(change: (view: { yaw: number; pitch: number; userZoom: number }) => void): void {
    const next = this.view();
    change(next);
    this.manual = { yaw: wrap(next.yaw), pitch: clamp(next.pitch, -PITCH_LIMIT, PITCH_LIMIT), userZoom: clamp(next.userZoom, ZOOM_MIN, ZOOM_MAX) };
    this.syncHooks();
    this.invalidate();
    this.onViewChange?.();
  }

  private bindInput(): void {
    this.element.addEventListener('keydown', (event) => {
      const steps: Record<string, (v: { yaw: number; pitch: number; userZoom: number }) => void> = {
        ArrowLeft: (v) => { v.yaw -= 15; },
        ArrowRight: (v) => { v.yaw += 15; },
        ArrowUp: (v) => { v.pitch += 15; },
        ArrowDown: (v) => { v.pitch -= 15; },
        '+': (v) => { v.userZoom *= 1.25; },
        '=': (v) => { v.userZoom *= 1.25; },
        '-': (v) => { v.userZoom *= 0.8; },
      };
      if (event.key === 'Home') {
        event.preventDefault();
        this.clearManual();
        this.onViewChange?.();
        return;
      }
      const change = steps[event.key];
      if (!change || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      this.nudge(change);
    });
    const orbits = (event: PointerEvent) => event.pointerType === 'mouse' || this.freeLook;
    this.element.addEventListener('pointerdown', (event) => {
      if (!orbits(event) || (event.pointerType === 'mouse' && event.button !== 0)) return;
      this.element.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.view().userZoom };
      }
    });
    this.element.addEventListener('pointermove', (event) => {
      const last = this.pointers.get(event.pointerId);
      if (!last) return;
      const here = { x: event.clientX, y: event.clientY };
      if (this.pointers.size === 2 && this.pinch) {
        this.pointers.set(event.pointerId, here);
        const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const pinch = this.pinch;
        this.nudge((v) => { v.userZoom = pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance); });
        return;
      }
      this.pointers.set(event.pointerId, here);
      this.nudge((v) => {
        v.yaw -= (here.x - last.x) * DEGREES_PER_PIXEL;
        v.pitch += (here.y - last.y) * DEGREES_PER_PIXEL;
      });
    });
    const release = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
    };
    this.element.addEventListener('pointerup', release);
    this.element.addEventListener('pointercancel', release);
  }
}
