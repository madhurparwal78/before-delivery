/**
 * The moped scene.
 *
 * Real WebGL through Three.js when it is available, and a still drawing from
 * the same parts and geometry tables when it is not. Both publish the same
 * attributes and both draw the fouling edge in the flat fill of the primary
 * action buttons.
 *
 * The scene holds still at idle: there is no animation loop and no idle turn,
 * so two screenshots taken with no input are identical. Frames are drawn only
 * when the rider acts or a published motion is running.
 */

import {
  BoxGeometry,
  ColorManagement,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';

import { MOTION, el, prefersReducedMotion, setAttrIfChanged } from '../dom.js';
import {
  halfExtentAlong,
  storyOffset,
  toScene,
  type Axis,
  type Primitive,
  type ScenePart,
} from './geometry.js';

// Colour management off and a linear output space, so a flat fill reaches the
// framebuffer as the exact sRGB bytes the stylesheet uses.
ColorManagement.enabled = false;

export const INK = 0x14110e;
export const PAPER = 0xf6f2ea;
/** The single burnt-orange red accent, the same value as the CSS `--accent`. */
export const ACCENT = 0xc2451e;

const FILLS: Record<string, number> = {
  frame: 0xd9d2c4,
  footboard: 0xc9c1b1,
  'leg-shield': 0xe3ddd1,
  'front-panel': 0xe3ddd1,
  seat: 0xb9b1a1,
  'side-panel-left': 0xe9e3d8,
  'side-panel-right': 0xe9e3d8,
  'fuel-tank': 0xcfc7b7,
  'engine-exhaust': 0xbdb5a5,
  'hub-motor': 0xa9a192,
  'traction-pack': 0xcdd6d2,
  controller: 0xd3ccbd,
  'front-fork': 0xc3bbab,
  'front-wheel': 0x8f887a,
  'rear-wheel': 0x8f887a,
  swingarm: 0xb3ab9b,
};

const PANEL_FADE = 0.25;
const CAMERA_TARGET = new Vector3(620, 400, 0);
const CAMERA_RADIUS = 4000;
const BASE_HALF_WIDTH = 950;
const MAX_PIXEL_RATIO = 2;

export const CAMERA_HOME = { azimuthDeg: 30, elevationDeg: 15, zoom: 1 };
export const ELEVATION_LIMITS = { min: -15, max: 75 };
export const ZOOM_LIMITS = { min: 0.5, max: 2 };

export interface RailStation {
  id: string;
  name: string;
  travelMm: number;
  gapMm: number | null;
}

export interface RailSpec {
  name: 'pack' | 'hub';
  partId: string;
  railMm: number;
  stopTravelMm: number;
  foulingFeature: string | null;
  stations: RailStation[];
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface ViewCallbacks {
  onPartClick(partId: string): void;
  /** Travel changed, in millimetres. */
  onTravel(travelMm: number): void;
  /** The part reached its stop: first contact or full seat. */
  onStop(): void;
  onCameraChange(): void;
}

interface PartNode {
  part: ScenePart;
  group: Group;
  meshes: Mesh[];
  fills: MeshBasicMaterial[];
  lines: LineBasicMaterial[];
  label: HTMLElement;
  /** Where the part sits now, after story and rail movement. */
  dynamicPosition?: [number, number, number];
}

export class SceneView {
  readonly element: HTMLElement;
  readonly handle: HTMLButtonElement;

  private readonly overlay: HTMLElement;
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly still: SVGSVGElement | null = null;
  private readonly renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, -10000, 10000);

  private nodes: PartNode[] = [];
  private parts: ScenePart[] = [];
  private foulingBar: Mesh | null = null;

  private azimuthDeg = CAMERA_HOME.azimuthDeg;
  private elevationDeg = CAMERA_HOME.elevationDeg;
  private zoom = CAMERA_HOME.zoom;

  private rail: RailSpec | null = null;
  private travelMm = 0;
  private storyProgress = 0;
  private flight: number | null = null;
  private meshCount = 0;

  constructor(
    private readonly callbacks: ViewCallbacks,
    private readonly mode: 'configure' | 'story',
  ) {
    this.overlay = el('div', { class: 'scene-overlay', 'aria-hidden': 'true' });

    const canvas = createCanvas();
    if (canvas) {
      this.canvas = canvas.canvas;
      this.renderer = canvas.renderer;
      this.element = el(
        'div',
        {
          class: 'scene',
          role: 'application',
          'aria-label': 'Moped scene',
          tabindex: 0,
          'data-renderer': 'webgl',
        },
        [this.canvas, this.overlay],
      );
    } else {
      this.still = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.still.setAttribute('class', 'scene-still');
      this.element = el(
        'div',
        {
          class: 'scene',
          role: 'img',
          'aria-label': 'Moped drawing',
          tabindex: 0,
          'data-renderer': 'still',
        },
        [this.still, this.overlay],
      );
    }

    this.handle = el('button', {
      type: 'button',
      class: 'rail-handle',
      'aria-label': 'Rail handle',
      // The scene is one Tab stop; keyboard travel uses the insertion slider.
      tabindex: -1,
      hidden: true,
    });

    this.bindPointer();
    this.bindKeys();
  }

  get rendererKind(): 'webgl' | 'still' {
    return this.renderer ? 'webgl' : 'still';
  }

  setParts(parts: ScenePart[]): void {
    this.parts = parts;
    this.rebuild();
  }

  private rebuild(): void {
    for (const node of this.nodes) {
      this.scene.remove(node.group);
      node.label.remove();
    }
    this.nodes = [];
    this.meshCount = 0;

    for (const part of this.parts) {
      const group = new Group();
      const meshes: Mesh[] = [];
      const fills: MeshBasicMaterial[] = [];
      const lines: LineBasicMaterial[] = [];

      for (const primitive of part.primitives) {
        const geometry = geometryFor(primitive);
        // Flat fills with hard edge lines: no gradients, glows or shadows.
        const fill = new MeshBasicMaterial({ color: FILLS[part.id] ?? 0xd0c9ba });
        const mesh = new Mesh(geometry, fill);
        const local = toScene(primitive.centre).sub(toScene(part.position));
        mesh.position.copy(local);
        if (primitive.kind === 'cylinder') orientCylinder(mesh, primitive.along ?? 'y');

        const edgeMaterial = new LineBasicMaterial({ color: INK });
        const edges = new LineSegments(new EdgesGeometry(geometry), edgeMaterial);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);

        group.add(mesh, edges);
        meshes.push(mesh);
        fills.push(fill);
        lines.push(edgeMaterial);
        this.meshCount += 1;
      }

      group.position.copy(toScene(part.position));
      this.scene.add(group);

      const label = el('span', { class: 'dim-label', 'data-part-label': part.id });
      label.textContent = `${part.dimensionMm.toFixed(1)} mm`;
      this.overlay.append(label);

      this.nodes.push({ part, group, meshes, fills, lines, label });
    }

    setAttrIfChanged(this.element, 'data-mesh-count', String(this.meshCount));
    this.resize();
  }

  /** Selecting the pack or hub starts the Feeler Sweep. */
  setSelected(partId: string | null, options: { fly?: boolean } = {}): void {
    setAttrIfChanged(this.element, 'data-selected-part', partId ?? '');

    if (options.fly && this.rail) {
      this.travelMm = 0;
      this.runFlight();
    }
    this.applyFade();
    this.draw();
  }

  setRail(rail: RailSpec | null): void {
    this.rail = rail;
    this.travelMm = rail ? 0 : 0;
    this.handle.hidden = rail === null;
    this.applyFade();
    this.draw();
  }

  get travel(): number {
    return this.travelMm;
  }

  /** Travel never passes the first-contact stop, and steps clamp to it. */
  setTravel(mm: number, announce = true): void {
    const rail = this.rail;
    if (!rail) return;
    const clamped = Math.max(0, Math.min(rail.stopTravelMm, mm));
    const reachedStop = clamped >= rail.stopTravelMm && this.travelMm < rail.stopTravelMm;
    this.travelMm = clamped;
    this.draw();
    if (announce) this.callbacks.onTravel(clamped);
    if (reachedStop) this.callbacks.onStop();
  }

  /** Releasing a drag short of contact springs the part back to the rail start. */
  springBack(): void {
    const rail = this.rail;
    if (!rail) return;
    if (prefersReducedMotion()) {
      this.setTravel(0);
      return;
    }
    const from = this.travelMm;
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / MOTION.spring);
      // A firm spring with no overshoot.
      const eased = 1 - (1 - progress) ** 3;
      this.travelMm = from * (1 - eased);
      this.draw();
      this.callbacks.onTravel(this.travelMm);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  setStoryProgress(progress: number): void {
    this.storyProgress = progress;
    this.draw();
  }

  get camera3(): { azimuthDeg: number; elevationDeg: number; zoom: number } {
    return { azimuthDeg: this.azimuthDeg, elevationDeg: this.elevationDeg, zoom: this.zoom };
  }

  orbit(deltaAzimuth: number, deltaElevation: number): void {
    this.azimuthDeg = (this.azimuthDeg + deltaAzimuth) % 360;
    this.elevationDeg = Math.max(
      ELEVATION_LIMITS.min,
      Math.min(ELEVATION_LIMITS.max, this.elevationDeg + deltaElevation),
    );
    this.draw();
    this.callbacks.onCameraChange();
  }

  changeZoom(delta: number): void {
    this.zoom = Math.max(ZOOM_LIMITS.min, Math.min(ZOOM_LIMITS.max, roundTo(this.zoom + delta, 2)));
    this.draw();
    this.callbacks.onCameraChange();
  }

  resetCamera(): void {
    this.azimuthDeg = CAMERA_HOME.azimuthDeg;
    this.elevationDeg = CAMERA_HOME.elevationDeg;
    this.zoom = CAMERA_HOME.zoom;
    this.draw();
    this.callbacks.onCameraChange();
  }

  /**
   * The drawing buffer matches the displayed size in CSS pixels times the
   * device pixel ratio, capped at 2.
   */
  resize(): void {
    const width = Math.max(1, Math.round(this.element.clientWidth));
    const height = Math.max(1, Math.round(this.element.clientHeight));
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);

    if (this.renderer) {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(width, height, false);
    }
    if (this.still) {
      this.still.setAttribute('viewBox', `0 0 ${width} ${height}`);
      this.still.setAttribute('width', String(width));
      this.still.setAttribute('height', String(height));
    }
    this.draw();
  }

  /** Project a brief-coordinate point to viewport CSS pixels. */
  project(point: readonly [number, number, number]): ScreenPoint {
    const rect = this.element.getBoundingClientRect();
    const ndc = toScene(point).project(this.camera);
    return {
      x: rect.left + ((ndc.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - ndc.y) / 2) * rect.height,
    };
  }

  /** The selected rail part's projected leading edge. */
  leadingEdge(): ScreenPoint | null {
    const point = this.leadingEdgePoint();
    return point ? this.project(point) : null;
  }

  private leadingEdgePoint(): [number, number, number] | null {
    const rail = this.rail;
    if (!rail) return null;
    const node = this.nodes.find((row) => row.part.id === rail.partId);
    if (!node?.part.storyAxis) return null;

    const insertion = node.part.storyAxis.map((value) => -value) as [number, number, number];
    const centre = this.railPosition(node.part, rail);
    const half = halfExtentAlong(node.part, insertion);
    return [
      centre[0] + insertion[0] * half,
      centre[1] + insertion[1] * half,
      centre[2] + insertion[2] * half,
    ];
  }

  /**
   * Where a rail part sits for the current travel. Travel 0 is the rail start,
   * one rail length out along the part's assembly axis; full travel is seated.
   */
  private railPosition(part: ScenePart, rail: RailSpec): [number, number, number] {
    const axis = part.storyAxis ?? [0, 0, 0];
    const out = rail.railMm - this.travelMm;
    return [
      part.position[0] + axis[0] * out,
      part.position[1] + axis[1] * out,
      part.position[2] + axis[2] * out,
    ];
  }

  private runFlight(): void {
    if (this.flight !== null) cancelAnimationFrame(this.flight);
    if (prefersReducedMotion()) {
      this.draw();
      return;
    }
    const started = performance.now();
    const step = (now: number): void => {
      const progress = Math.min(1, (now - started) / MOTION.flight);
      this.flightProgress = 1 - (1 - progress) ** 3;
      this.draw();
      if (progress < 1) {
        this.flight = requestAnimationFrame(step);
        return;
      }
      this.flight = null;
      this.flightProgress = 1;
      this.draw();
    };
    this.flightProgress = 0;
    this.flight = requestAnimationFrame(step);
  }

  private flightProgress = 1;

  /** The blocking panels of the selected rail fade to 25 percent. */
  private applyFade(): void {
    const rail = this.rail?.name ?? null;
    for (const node of this.nodes) {
      const faded = rail !== null && node.part.fadedFor.includes(rail);
      const opacity = faded ? PANEL_FADE : 1;
      for (const fill of node.fills) {
        fill.transparent = faded;
        fill.opacity = opacity;
        fill.needsUpdate = true;
      }
      for (const line of node.lines) {
        line.transparent = faded;
        line.opacity = opacity;
        line.needsUpdate = true;
      }
      node.group.renderOrder = faded ? -1 : 0;
    }
  }

  /** `data-panel-fade` for a part, as the parts rows publish it. */
  panelFade(partId: string): '1' | '0.25' {
    const rail = this.rail?.name ?? null;
    const part = this.parts.find((row) => row.id === partId);
    if (!part || rail === null) return '1';
    return part.fadedFor.includes(rail) ? '0.25' : '1';
  }

  private updateCamera(): void {
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    const aspect = width / height;
    const halfWidth = BASE_HALF_WIDTH / this.zoom;
    const halfHeight = halfWidth / aspect;

    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;

    const azimuth = (this.azimuthDeg * Math.PI) / 180;
    const elevation = (this.elevationDeg * Math.PI) / 180;
    this.camera.position.set(
      CAMERA_TARGET.x + CAMERA_RADIUS * Math.cos(elevation) * Math.sin(azimuth),
      CAMERA_TARGET.y + CAMERA_RADIUS * Math.sin(elevation),
      CAMERA_TARGET.z + CAMERA_RADIUS * Math.cos(elevation) * Math.cos(azimuth),
    );
    this.camera.lookAt(CAMERA_TARGET);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  /** Lay out part positions, the fouling bar, labels and the handle, then draw. */
  draw(): void {
    this.updateCamera();

    const rail = this.rail;
    for (const node of this.nodes) {
      const offset = storyOffset(node.part, this.storyProgress);
      let position: [number, number, number] = [
        node.part.position[0] + offset[0],
        node.part.position[1] + offset[1],
        node.part.position[2] + offset[2],
      ];

      if (rail && node.part.id === rail.partId && this.mode === 'configure') {
        const seated = node.part.position;
        const driven = this.railPosition(node.part, rail);
        // The flight carries the part out to the rail start over its duration.
        position = [
          seated[0] + (driven[0] - seated[0]) * this.flightProgress,
          seated[1] + (driven[1] - seated[1]) * this.flightProgress,
          seated[2] + (driven[2] - seated[2]) * this.flightProgress,
        ];
      }

      node.group.position.copy(toScene(position));
      node.group.updateMatrixWorld();
      node.dynamicPosition = position;
    }

    this.updateFoulingBar();
    this.render();
    this.layoutLabels();
    this.layoutHandle();
  }

  private updateFoulingBar(): void {
    const rail = this.rail;
    const atStop = rail !== null && this.travelMm >= rail.stopTravelMm;
    const contact = atStop && rail?.foulingFeature !== null;

    if (this.foulingBar) {
      this.scene.remove(this.foulingBar);
      this.foulingBar = null;
    }
    // None of the accent pixels appear before contact.
    if (!contact || !rail) return;

    const point = this.leadingEdgePoint();
    const node = this.nodes.find((row) => row.part.id === rail.partId);
    if (!point || !node?.part.storyAxis) return;

    // At least 3 CSS pixels thick, whatever the zoom.
    const perPixel = this.worldPerPixel();
    const thickness = Math.max(perPixel * 5, 8);
    const insertionAxisIndex = axisIndexOf(node.part.storyAxis);
    const span = spanAcross(node.part, insertionAxisIndex);

    const size: [number, number, number] = [thickness, thickness, thickness];
    size[(insertionAxisIndex + 1) % 3] = span[0];
    size[(insertionAxisIndex + 2) % 3] = span[1];

    const bar = new Mesh(
      new BoxGeometry(size[0], size[2], size[1]),
      // The flat, unlit fill of the primary action buttons.
      new MeshBasicMaterial({ color: ACCENT }),
    );
    bar.position.copy(toScene(point));
    bar.renderOrder = 10;
    this.scene.add(bar);
    bar.updateMatrixWorld();
    this.foulingBar = bar;
  }

  private worldPerPixel(): number {
    const width = Math.max(1, this.element.clientWidth);
    return (2 * (BASE_HALF_WIDTH / this.zoom)) / width;
  }

  private render(): void {
    if (this.renderer) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.renderStill();
  }

  /**
   * The still drawing, from the same parts and geometry tables: each
   * primitive's projected outline, with the fouling edge in the same accent.
   */
  private renderStill(): void {
    const svg = this.still;
    if (!svg) return;
    while (svg.firstChild) svg.firstChild.remove();

    const rect = this.element.getBoundingClientRect();
    const toLocal = (point: readonly [number, number, number]): ScreenPoint => {
      const screen = this.project(point);
      return { x: screen.x - rect.left, y: screen.y - rect.top };
    };

    const drawn = this.nodes
      .map((node) => ({ node, depth: this.depthOf(node) }))
      .sort((a, b) => b.depth - a.depth);

    for (const { node } of drawn) {
      const origin = node.dynamicPosition ?? node.part.position;
      const faded = this.rail !== null && node.part.fadedFor.includes(this.rail.name);
      for (const primitive of node.part.primitives) {
        const offset: [number, number, number] = [
          origin[0] + (primitive.centre[0] - node.part.position[0]),
          origin[1] + (primitive.centre[1] - node.part.position[1]),
          origin[2] + (primitive.centre[2] - node.part.position[2]),
        ];
        const hull = convexHull(cornersOf(offset, primitive.size).map(toLocal));
        const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        polygon.setAttribute('points', hull.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
        polygon.setAttribute('fill', `#${(FILLS[node.part.id] ?? 0xd0c9ba).toString(16).padStart(6, '0')}`);
        polygon.setAttribute('stroke', `#${INK.toString(16).padStart(6, '0')}`);
        polygon.setAttribute('stroke-width', '1.5');
        if (faded) polygon.setAttribute('opacity', String(PANEL_FADE));
        svg.append(polygon);
      }
    }

    const rail = this.rail;
    if (rail && this.travelMm >= rail.stopTravelMm && rail.foulingFeature !== null) {
      const point = this.leadingEdgePoint();
      if (point) {
        const centre = toLocal(point);
        const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bar.setAttribute('x', String(centre.x - 3));
        bar.setAttribute('y', String(centre.y - 26));
        bar.setAttribute('width', '6');
        bar.setAttribute('height', '52');
        bar.setAttribute('fill', `#${ACCENT.toString(16).padStart(6, '0')}`);
        svg.append(bar);
      }
    }
  }

  private depthOf(node: PartNode): number {
    const origin = node.dynamicPosition ?? node.part.position;
    return toScene(origin).applyMatrix4(this.camera.matrixWorldInverse).z;
  }

  /**
   * Dimension labels sit beside their part and are pushed apart so none of
   * them overlap, including at 375 px.
   */
  private layoutLabels(): void {
    const rect = this.element.getBoundingClientRect();
    const placed: { top: number; bottom: number; left: number; right: number }[] = [];

    const ordered = [...this.nodes].sort((a, b) => {
      const pa = this.project(a.dynamicPosition ?? a.part.position);
      const pb = this.project(b.dynamicPosition ?? b.part.position);
      return pa.y - pb.y;
    });

    for (const node of ordered) {
      const screen = this.project(node.dynamicPosition ?? node.part.position);
      let left = screen.x - rect.left + 10;
      let top = screen.y - rect.top - 8;
      const width = Math.max(56, node.label.offsetWidth);
      const height = Math.max(14, node.label.offsetHeight);

      left = Math.max(2, Math.min(rect.width - width - 2, left));
      top = Math.max(2, Math.min(rect.height - height - 2, top));

      let guard = 0;
      while (
        guard < 40 &&
        placed.some(
          (box) =>
            left < box.right && left + width > box.left && top < box.bottom && top + height > box.top,
        )
      ) {
        top += height + 3;
        if (top + height > rect.height - 2) {
          top = 2;
          left += width + 6;
        }
        guard += 1;
      }

      placed.push({ left, right: left + width, top, bottom: top + height });
      node.label.style.left = `${left.toFixed(1)}px`;
      node.label.style.top = `${top.toFixed(1)}px`;
      node.label.dataset.screenX = (left + rect.left).toFixed(1);
      node.label.dataset.screenY = (top + rect.top).toFixed(1);
    }
  }

  /**
   * The handle's centre stays on the part's projected leading edge.
   *
   * It is placed in viewport coordinates, the same ones the readout publishes,
   * and clamped to stay inside the scene.
   */
  layoutHandle(): void {
    if (this.handle.hidden) return;
    const edge = this.leadingEdge();
    if (!edge) return;
    const rect = this.element.getBoundingClientRect();
    const half = this.handle.offsetWidth / 2;
    const x = Math.max(rect.left + half, Math.min(rect.right - half, edge.x));
    const y = Math.max(rect.top + half, Math.min(rect.bottom - half, edge.y));
    this.handle.style.left = `${x.toFixed(1)}px`;
    this.handle.style.top = `${y.toFixed(1)}px`;
  }

  /** The projected centre of a part, for its parts row. */
  partScreenPoint(partId: string): ScreenPoint | null {
    const node = this.nodes.find((row) => row.part.id === partId);
    if (!node) return null;
    return this.project(node.dynamicPosition ?? node.part.position);
  }

  /** Live story offsets for every part with a story stage, in millimetres. */
  storyOffsets(): Record<string, [string, string, string]> {
    const out: Record<string, [string, string, string]> = {};
    for (const part of this.parts) {
      if (part.storyStage === null) continue;
      const offset = storyOffset(part, this.mode === 'story' ? this.storyProgress : 0);
      out[part.id] = [offset[0].toFixed(1), offset[1].toFixed(1), offset[2].toFixed(1)];
    }
    return out;
  }

  private bindPointer(): void {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    this.element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      this.element.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      // A mouse drag orbits on both axes.
      this.orbit((event.clientX - lastX) * 0.4, -(event.clientY - lastY) * 0.4);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const stop = (): void => {
      dragging = false;
    };
    this.element.addEventListener('pointerup', stop);
    this.element.addEventListener('pointercancel', stop);

    this.element.addEventListener('click', (event) => {
      const picked = this.pick(event.clientX, event.clientY);
      if (picked) this.callbacks.onPartClick(picked);
    });
  }

  /** The part nearest the pointer, by projected distance. */
  private pick(clientX: number, clientY: number): string | null {
    let best: { id: string; distance: number } | null = null;
    for (const node of this.nodes) {
      const screen = this.project(node.dynamicPosition ?? node.part.position);
      const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
      if (!best || distance < best.distance) best = { id: node.part.id, distance };
    }
    return best && best.distance < 80 ? best.id : null;
  }

  private bindKeys(): void {
    this.element.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          this.orbit(-15, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          this.orbit(15, 0);
          break;
        case 'ArrowUp':
          event.preventDefault();
          this.orbit(0, 15);
          break;
        case 'ArrowDown':
          event.preventDefault();
          this.orbit(0, -15);
          break;
        case '+':
        case '=':
          event.preventDefault();
          this.changeZoom(0.1);
          break;
        case '-':
          event.preventDefault();
          this.changeZoom(-0.1);
          break;
        case 'Home':
          event.preventDefault();
          this.resetCamera();
          break;
        default:
          break;
      }
    });
  }

  /** The drawn rail's length in CSS pixels, which scales a handle drag. */
  drawnRailPixels(): number {
    const rail = this.rail;
    if (!rail) return 1;
    const node = this.nodes.find((row) => row.part.id === rail.partId);
    if (!node?.part.storyAxis) return 1;
    const axis = node.part.storyAxis;
    const seated = node.part.position;
    const start: [number, number, number] = [
      seated[0] + axis[0] * rail.railMm,
      seated[1] + axis[1] * rail.railMm,
      seated[2] + axis[2] * rail.railMm,
    ];
    const a = this.project(seated);
    const b = this.project(start);
    return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
  }
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function geometryFor(primitive: Primitive): BoxGeometry | CylinderGeometry {
  if (primitive.kind === 'box') {
    // Brief x, y, z map to Three x, z, y.
    return new BoxGeometry(primitive.size[0], primitive.size[2], primitive.size[1]);
  }
  const along = primitive.along ?? 'y';
  const radius =
    along === 'y'
      ? Math.max(primitive.size[0], primitive.size[2]) / 2
      : along === 'x'
        ? Math.max(primitive.size[1], primitive.size[2]) / 2
        : Math.max(primitive.size[0], primitive.size[1]) / 2;
  const length = along === 'x' ? primitive.size[0] : along === 'y' ? primitive.size[1] : primitive.size[2];
  return new CylinderGeometry(radius, radius, length, 24, 1, false);
}

/** A cylinder is built along Three's y; turn it onto the brief axis asked for. */
function orientCylinder(mesh: Mesh, along: Axis): void {
  if (along === 'x') mesh.rotation.z = Math.PI / 2;
  else if (along === 'y') mesh.rotation.x = Math.PI / 2;
}

function axisIndexOf(axis: readonly [number, number, number]): number {
  return axis[0] !== 0 ? 0 : axis[1] !== 0 ? 1 : 2;
}

/** The part's extents across the two axes the insertion axis does not use. */
function spanAcross(part: ScenePart, axisIndex: number): [number, number] {
  const other = [(axisIndex + 1) % 3, (axisIndex + 2) % 3];
  return other.map((index) => {
    let span = 0;
    for (const primitive of part.primitives) span = Math.max(span, primitive.size[index] as number);
    return span;
  }) as [number, number];
}

function cornersOf(
  centre: readonly [number, number, number],
  size: readonly [number, number, number],
): [number, number, number][] {
  const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
  const corners: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push([centre[0] + sx * hx, centre[1] + sy * hy, centre[2] + sz * hz]);
      }
    }
  }
  return corners;
}

function convexHull(points: ScreenPoint[]): ScreenPoint[] {
  const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const build = (list: ScreenPoint[]): ScreenPoint[] => {
    const stack: ScreenPoint[] = [];
    for (const point of list) {
      while (
        stack.length >= 2 &&
        cross(stack[stack.length - 2] as ScreenPoint, stack[stack.length - 1] as ScreenPoint, point) <= 0
      ) {
        stack.pop();
      }
      stack.push(point);
    }
    return stack;
  };

  const lower = build(sorted);
  const upper = build([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function createCanvas(): { canvas: HTMLCanvasElement; renderer: WebGLRenderer } | null {
  const canvas = document.createElement('canvas');
  try {
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.setClearColor(PAPER, 1);
    return { canvas, renderer };
  } catch {
    // Without WebGL a still drawing replaces the canvas.
    return null;
  }
}
