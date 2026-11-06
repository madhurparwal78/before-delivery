import * as THREE from 'three';
import { AXIS_VECTOR, DEFAULT_SCENE_KIT, resolveSceneParts, storyOffsets, type RailPartId, type ScenePart } from '../../shared/parts.js';
import type { RailResult, Units } from '../../shared/types.js';
import { buildMoped, COLOURS, type MopedScene, type PartObject } from './build.js';
import { BANDS_PX, layoutDimensions, type DimensionInput, type DimensionLine, type Point } from './layout.js';

type RailKey = 'pack' | 'hub';
const RAIL_PART: Record<RailKey, RailPartId> = { pack: 'traction-pack', hub: 'hub-motor' };
const PART_RAIL: Record<RailPartId, RailKey> = { 'traction-pack': 'pack', 'hub-motor': 'hub' };

const FLIGHT_MS = 680;
const SPRING_MS = 500;
const FOV_DEG = 5;
/**
 * The camera orbits about a point ahead of the pack's rail, so that a part on the rail always moves when the view turns.
 * The picture is then shifted so that, from the starting view, the moped stands centred between the rows of dimension lines.
 */
const TARGET = new THREE.Vector3(830, 0, 450);
const MOPED_MIDDLE_X_MM = 650;
const AHEAD_MM = TARGET.x - MOPED_MIDDLE_X_MM;
const START_VIEW_SHIFT_MM = {
  across: AHEAD_MM * Math.cos(THREE.MathUtils.degToRad(30)),
  up: AHEAD_MM * Math.sin(THREE.MathUtils.degToRad(30)) * Math.sin(THREE.MathUtils.degToRad(15)),
};
/** Half the drawing's width and height in millimetres, in a view that keeps every part in frame. */
const FRAME_MM = { config: { halfWide: 800, halfTall: 530 }, story: { halfWide: 900, halfTall: 720 } } as const;
const MIN_DRAWING_SHARE = 0.45;
const EPS = 1e-6;
const AXIS_COMPONENT = { x: 0, y: 1, z: 2 } as const;

interface Station { id: string; name: string; travelMm: number; gapMm: string | null }
interface RailInfo { railMm: number; stopMm: number; stations: Station[]; foulingFeature: string | null }
interface RailRun {
  flight: number;
  flightAnim: { from: number; to: number; t0: number } | null;
  travel: number;
  spring: { from: number; t0: number } | null;
}

interface RailSnapshot {
  part: RailPartId;
  travelMm: number;
  railMm: number;
  stopMm: number;
  contact: boolean;
  /** One entry per station: reached flag and the gap string (empty until reached). */
  stations: { id: string; name: string; travelMm: number; reached: boolean; gapMm: string }[];
  smallestGapMm: string;
  foulingFeature: string;
  /** Viewport CSS px. */
  leadingEdge: Point;
  foulingPoint: Point | null;
  /** Scene-local CSS px (origin at the scene's top-left corner). */
  leadingEdgeLocal: Point;
  settled: boolean;
}
export interface SceneSnapshot {
  version: number;
  renderer: 'webgl' | 'still';
  mode: 'config' | 'story';
  meshCount: number;
  azimuthDeg: number;
  elevationDeg: number;
  zoom: number;
  selectedPart: string;
  units: Units;
  width: number;
  height: number;
  parts: { id: string; name: string; position: [number, number, number]; fade: 1 | 0.25; screen: Point; dimensionMm: number }[];
  storyOffsetsJson: string;
  rail: RailSnapshot | null;
  dimensions: DimensionLine[];
  selectionBox: { x: number; y: number; w: number; h: number; tag: string } | null;
}

type Listener = () => void;
type SceneEvent = 'railStop' | 'select';

const easeOut = (t: number, power: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** power;
const tenths = (value: string): number => Math.round(Number.parseFloat(value) * 10);
const fixed1 = (mm: number): string => (Math.round(mm * 10) / 10).toFixed(1);
const num1 = (value: number): number => Math.round(value * 10) / 10;

export class SceneModel {
  readonly camera = new THREE.PerspectiveCamera(FOV_DEG, 1.5, 1000, 60000);
  moped: MopedScene;
  rendererKind: 'webgl' | 'still' = 'webgl';
  mode: 'config' | 'story' = 'config';
  azimuthDeg = 30;
  elevationDeg = 15;
  zoom = 1;
  units: Units;
  reducedMotion: boolean;
  /** Provided by the view: the scene element's rectangle in the viewport. */
  measure: (() => { left: number; top: number; width: number; height: number }) | null = null;

  private parts: ScenePart[];
  private rails: Record<RailKey, RailInfo | null> = { pack: null, hub: null };
  private selected: string | null = null;
  private run: Record<RailPartId, RailRun> = {
    'traction-pack': { flight: 0, flightAnim: null, travel: 0, spring: null },
    'hub-motor': { flight: 0, flightAnim: null, travel: 0, spring: null },
  };
  private drag: { part: RailPartId; startTravel: number; x: number; y: number; screenRail: Point } | null = null;
  private storyProgress: number | null = null;
  private listeners = new Set<Listener>();
  private handlers = new Map<SceneEvent, Set<(value: string) => void>>();
  private renderers = new Set<() => void>();
  private snapHandlers = new Set<() => void>();
  private frame = 0;
  private size = { width: 300, height: 200 };
  private snapshot: SceneSnapshot;
  private version = 0;
  private readonly raycaster = new THREE.Raycaster();

  constructor(options: { reducedMotion: boolean; units: Units }) {
    this.reducedMotion = options.reducedMotion;
    this.units = options.units;
    this.parts = resolveSceneParts(DEFAULT_SCENE_KIT);
    this.moped = buildMoped(this.parts);
    this.snapshot = this.compute();
  }

  // ---- subscription -------------------------------------------------------------------------
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): SceneSnapshot => this.snapshot;
  on(event: SceneEvent, handler: (value: string) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
    return () => set.delete(handler);
  }
  private emit(event: SceneEvent, value: string): void {
    this.handlers.get(event)?.forEach((handler) => handler(value));
  }
  addRenderer(render: () => void): () => void {
    this.renderers.add(render);
    this.invalidate();
    return () => this.renderers.delete(render);
  }
  /** Called when a reduced-motion snap happens, so the view can run its 120 ms cross-fade. */
  onSnap(handler: () => void): () => void {
    this.snapHandlers.add(handler);
    return () => this.snapHandlers.delete(handler);
  }

  // ---- configuration ------------------------------------------------------------------------
  setRendererKind(kind: 'webgl' | 'still'): void {
    this.rendererKind = kind;
    this.refresh();
  }
  setMode(mode: 'config' | 'story'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'story') this.select(null);
    this.refresh();
  }
  setUnits(units: Units): void {
    this.units = units;
    this.refresh();
  }
  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    if (reduced) this.finishAnimations();
    this.refresh();
  }
  setSize(width: number, height: number): void {
    this.size = { width: Math.max(1, width), height: Math.max(1, height) };
    this.refresh();
  }
  setParts(parts: readonly ScenePart[]): void {
    if (JSON.stringify(parts) === JSON.stringify(this.parts)) return;
    this.parts = [...parts];
    this.moped = buildMoped(this.parts);
    this.refresh();
  }
  setRails(rails: { pack: RailResult | null; hub: RailResult | null }): void {
    const parse = (rail: RailResult | null): RailInfo | null => rail && {
      railMm: Number.parseFloat(rail.railMm),
      stopMm: Number.parseFloat(rail.stopTravelMm),
      foulingFeature: rail.foulingFeature,
      stations: rail.stations.map((s) => ({ id: s.id, name: s.name, travelMm: Number.parseFloat(s.travelMm), gapMm: s.gapMm })),
    };
    this.rails = { pack: parse(rails.pack), hub: parse(rails.hub) };
    for (const key of ['pack', 'hub'] as const) {
      const info = this.rails[key];
      const run = this.run[RAIL_PART[key]];
      if (info && run.travel > info.stopMm) run.travel = info.stopMm;
    }
    this.refresh();
  }

  // ---- selection and travel -----------------------------------------------------------------
  select(id: string | null): void {
    if (this.mode === 'story' && id !== null) return;
    if (id === this.selected) return;
    this.selected = id;
    const now = performance.now();
    for (const part of ['traction-pack', 'hub-motor'] as const) {
      const run = this.run[part];
      const target = part === id ? 1 : 0;
      if (part === id) { run.travel = 0; run.spring = null; }
      if (this.reducedMotion) {
        run.flight = target; run.flightAnim = null; run.spring = null;
        if (target === 0) run.travel = 0;
      } else if (run.flight !== target || run.flightAnim) {
        run.flightAnim = { from: run.flight, to: target, t0: now };
      }
    }
    if (this.reducedMotion) this.announceSnap();
    this.refresh();
    this.invalidate();
  }
  private get railPart(): RailPartId | null {
    return this.selected === 'traction-pack' || this.selected === 'hub-motor' ? this.selected : null;
  }
  private railInfo(part: RailPartId): RailInfo | null {
    return this.rails[PART_RAIL[part]];
  }
  setTravel(mm: number): void {
    const part = this.railPart;
    const info = part && this.railInfo(part);
    if (!part || !info) return;
    const run = this.run[part];
    run.spring = null;
    const previous = run.travel;
    run.travel = Math.min(info.stopMm, Math.max(0, mm));
    if (run.travel >= info.stopMm - EPS && previous < info.stopMm - EPS) this.emit('railStop', part);
    this.refresh();
    this.invalidate();
  }
  stepTravel(deltaMm: number): void {
    const part = this.railPart;
    if (part) this.setTravel(this.run[part].travel + deltaMm);
  }
  travelToStart(): void {
    this.setTravel(0);
  }
  travelToStop(): void {
    const part = this.railPart;
    const info = part && this.railInfo(part);
    if (info) this.setTravel(info.stopMm);
  }

  beginDrag(clientX: number, clientY: number): boolean {
    const part = this.railPart;
    const info = part && this.railInfo(part);
    if (!part || !info) return false;
    const run = this.run[part];
    run.spring = null;
    const frame = this.railFrame(part, info);
    const a = this.toLocal(frame.leadingAt(0));
    const b = this.toLocal(frame.leadingAt(info.railMm));
    this.drag = { part, startTravel: run.travel, x: clientX, y: clientY, screenRail: { x: b.x - a.x, y: b.y - a.y } };
    return true;
  }
  dragTo(clientX: number, clientY: number): void {
    const drag = this.drag;
    if (!drag) return;
    const info = this.railInfo(drag.part);
    if (!info) return;
    const { x: sx, y: sy } = drag.screenRail;
    const length2 = sx * sx + sy * sy;
    if (length2 < 1) return;
    const along = ((clientX - drag.x) * sx + (clientY - drag.y) * sy) / length2;
    this.setTravel(drag.startTravel + along * info.railMm);
  }
  endDrag(cancelled: boolean): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const info = this.railInfo(drag.part);
    const run = this.run[drag.part];
    if (!info) return;
    const atStop = run.travel >= info.stopMm - EPS;
    if ((cancelled || !atStop) && run.travel > 0) this.springBack(drag.part);
  }
  private springBack(part: RailPartId): void {
    const run = this.run[part];
    if (this.reducedMotion) {
      run.travel = 0; run.spring = null;
      this.announceSnap();
    } else {
      run.spring = { from: run.travel, t0: performance.now() };
    }
    this.refresh();
    this.invalidate();
  }

  // ---- camera and story ---------------------------------------------------------------------
  orbit(dAzimuthDeg: number, dElevationDeg: number): void {
    this.azimuthDeg += dAzimuthDeg;
    this.elevationDeg = Math.min(75, Math.max(-15, this.elevationDeg + dElevationDeg));
    this.refresh();
    this.invalidate();
  }
  zoomBy(delta: number): void {
    this.zoom = Math.min(2, Math.max(0.5, Math.round((this.zoom + delta) * 1000) / 1000));
    this.refresh();
    this.invalidate();
  }
  scaleZoom(factor: number): void {
    this.zoom = Math.min(2, Math.max(0.5, this.zoom * factor));
    this.refresh();
    this.invalidate();
  }
  resetCamera(): void {
    this.azimuthDeg = 30; this.elevationDeg = 15; this.zoom = 1;
    this.refresh();
    this.invalidate();
  }
  setStoryProgress(progress: number | null): void {
    this.storyProgress = progress;
    this.refresh();
    this.invalidate();
  }

  // ---- picking ------------------------------------------------------------------------------
  pick(clientX: number, clientY: number): string | null {
    const rect = this.rect();
    this.updateCamera();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    for (const part of this.moped.parts.values()) meshes.push(...part.meshes);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    const id = hit?.object.userData['partId'];
    return typeof id === 'string' ? id : null;
  }
  clickSelect(clientX: number, clientY: number): void {
    if (this.mode !== 'config') return;
    const id = this.pick(clientX, clientY);
    this.select(id);
    this.emit('select', id ?? '');
  }

  /** Painter's order for the SVG still: meshes (and their edge lines) far to near, so parts never cut through each other. */
  orderForStill(): void {
    const world = new THREE.Vector3();
    const meshes: { mesh: THREE.Mesh; distance: number }[] = [];
    for (const part of this.moped.parts.values()) {
      for (const mesh of part.meshes) meshes.push({ mesh, distance: mesh.getWorldPosition(world).distanceTo(this.camera.position) });
    }
    meshes.sort((a, b) => b.distance - a.distance);
    meshes.forEach(({ mesh }, index) => {
      mesh.renderOrder = index * 2;
      mesh.children.forEach((child) => { child.renderOrder = index * 2 + 1; });
    });
  }

  // ---- frame loop ---------------------------------------------------------------------------
  invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => this.tick());
  }
  private tick(): void {
    this.frame = 0;
    const animating = this.advance(performance.now());
    this.refresh();
    this.renderers.forEach((render) => render());
    if (animating) this.invalidate();
  }
  private advance(now: number): boolean {
    let active = false;
    for (const part of ['traction-pack', 'hub-motor'] as const) {
      const run = this.run[part];
      if (run.flightAnim) {
        const t = (now - run.flightAnim.t0) / FLIGHT_MS;
        const { from, to } = run.flightAnim;
        if (t >= 1) { run.flight = to; run.flightAnim = null; if (to === 0) run.travel = 0; } else { run.flight = from + (to - from) * easeOut(t, 2.5); active = true; }
      }
      if (run.spring) {
        const t = (now - run.spring.t0) / SPRING_MS;
        if (t >= 1) { run.travel = 0; run.spring = null; } else { run.travel = run.spring.from * (1 - easeOut(t, 3)); active = true; }
      }
    }
    return active;
  }
  private finishAnimations(): void {
    for (const part of ['traction-pack', 'hub-motor'] as const) {
      const run = this.run[part];
      if (run.flightAnim) { run.flight = run.flightAnim.to; run.flightAnim = null; }
      if (run.spring) { run.travel = 0; run.spring = null; }
    }
    this.announceSnap();
  }
  private announceSnap(): void {
    this.snapHandlers.forEach((handler) => handler());
  }

  /** Recompute pose, projection and the published snapshot (no drawing). */
  refresh(): void {
    this.snapshot = this.compute();
    this.listeners.forEach((listener) => listener());
  }

  // ---- geometry -----------------------------------------------------------------------------
  private rect(): { left: number; top: number; width: number; height: number } {
    return this.measure?.() ?? { left: 0, top: 0, width: this.size.width, height: this.size.height };
  }
  private updateCamera(): void {
    const { width, height } = this.size;
    const aspect = width / height;
    const vHalf = THREE.MathUtils.degToRad(FOV_DEG / 2);
    const { halfWide, halfTall } = FRAME_MM[this.mode];
    const pxPerMm = Math.min(width / (2 * halfWide), Math.max(height - BANDS_PX, height * MIN_DRAWING_SHARE) / (2 * halfTall));
    const distance = height / (2 * pxPerMm) / Math.tan(vHalf) / this.zoom;
    const az = THREE.MathUtils.degToRad(this.azimuthDeg);
    const el = THREE.MathUtils.degToRad(this.elevationDeg);
    this.camera.aspect = aspect;
    const shownPxPerMm = pxPerMm * this.zoom;
    this.camera.setViewOffset(width, height, START_VIEW_SHIFT_MM.across * shownPxPerMm, -START_VIEW_SHIFT_MM.up * shownPxPerMm, width, height);
    this.camera.position.set(
      TARGET.x + distance * Math.sin(az) * Math.cos(el),
      TARGET.y + distance * Math.cos(az) * Math.cos(el),
      TARGET.z + distance * Math.sin(el),
    );
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(TARGET);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }
  private toLocal(point: THREE.Vector3): Point {
    const ndc = point.clone().project(this.camera);
    return { x: ((ndc.x + 1) / 2) * this.size.width, y: ((1 - ndc.y) / 2) * this.size.height };
  }
  private railFrame(part: RailPartId, info: RailInfo): { leadingAt: (travel: number) => THREE.Vector3; dir: THREE.Vector3; length: number; cross: [number, number] } {
    const def = this.parts.filter((p) => p.id === part)[0];
    const assembly = new THREE.Vector3(...(def.axis ? AXIS_VECTOR[def.axis] : [0, 0, 0]));
    const dir = assembly.clone().negate();
    const { lengthMm: length, crossMm: cross } = def.railBody ?? { lengthMm: 0, crossMm: [0, 0] };
    const seated = new THREE.Vector3(...def.position).add(this.storyVector(part));
    const startLeading = seated.clone().addScaledVector(assembly, info.railMm).addScaledVector(dir, length / 2);
    return { leadingAt: (travel) => startLeading.clone().addScaledVector(dir, travel), dir, length, cross };
  }
  private storyVector(part: string): THREE.Vector3 {
    const offsets = storyOffsets(this.storyProgress ?? 0)[part];
    return offsets ? new THREE.Vector3(...offsets) : new THREE.Vector3();
  }

  private compute(): SceneSnapshot {
    this.updateCamera();
    const rect = this.rect();
    const selectedRail = this.railPart;
    const fadeTarget = new Set<string>();
    if (selectedRail) for (const part of this.parts) if (part.fadedFor.includes(selectedRail)) fadeTarget.add(part.id);
    // pose
    for (const object of this.moped.parts.values()) {
      const position = object.base.clone().add(this.storyVector(object.id));
      if (object.id === 'traction-pack' || object.id === 'hub-motor') {
        const part = object.id;
        const def = this.parts.find((p) => p.id === part);
        const info = this.railInfo(part);
        const run = this.run[part];
        if (def?.axis && info) {
          const offset = Math.max(0, info.railMm * run.flight - run.travel);
          position.addScaledVector(new THREE.Vector3(...AXIS_VECTOR[def.axis]), offset);
        }
      }
      object.group.position.copy(position);
    }
    for (const object of this.moped.parts.values()) {
      const def = this.parts.find((p) => p.id === object.id);
      let fade = 1;
      for (const rail of ['traction-pack', 'hub-motor'] as const) if (def?.fadedFor.includes(rail)) fade = Math.min(fade, 1 - 0.75 * this.run[rail].flight);
      applyLook(object, fade, object.id === this.selected);
    }
    this.moped.scene.updateMatrixWorld(true);

    const parts: SceneSnapshot['parts'] = [];
    const dims: DimensionInput[] = [];
    let selectionBox: SceneSnapshot['selectionBox'] = null;
    for (const def of this.parts) {
      const object = this.moped.parts.get(def.id);
      if (!object) continue;
      const box = new THREE.Box3().setFromObject(object.group);
      const centre = box.getCenter(new THREE.Vector3());
      const screen = this.toLocal(centre);
      parts.push({
        id: def.id, name: def.name, position: def.position,
        fade: fadeTarget.has(def.id) ? 0.25 : 1,
        screen: { x: rect.left + screen.x, y: rect.top + screen.y },
        dimensionMm: object.dimensionMm,
      });
      dims.push(this.dimensionOf(object, box));
      if (def.id === this.selected && !selectedRail) {
        const corners = boxCorners(box).map((c) => this.toLocal(c));
        const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
        const pad = 6;
        selectionBox = {
          x: Math.min(...xs) - pad, y: Math.min(...ys) - pad,
          w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2,
          tag: `${def.position.join(', ')} mm`,
        };
      }
    }
    const rail = this.railSnapshot(rect);
    this.version += 1;
    return {
      version: this.version,
      renderer: this.rendererKind,
      mode: this.mode,
      meshCount: this.moped.meshCount,
      azimuthDeg: num1(this.azimuthDeg),
      elevationDeg: num1(this.elevationDeg),
      zoom: Math.round(this.zoom * 100) / 100,
      selectedPart: this.selected ?? '',
      units: this.units,
      width: this.size.width,
      height: this.size.height,
      parts,
      storyOffsetsJson: JSON.stringify(storyOffsets(this.storyProgress ?? 0)),
      rail,
      dimensions: layoutDimensions(dims, this.size.width, this.size.height),
      selectionBox,
    };
  }

  /** A part's measured extent along its dimension axis, projected at the edge of the part that faces its row of lines. */
  private dimensionOf(object: PartObject, box: THREE.Box3): DimensionInput {
    const centre = box.getCenter(new THREE.Vector3());
    const side = this.toLocal(centre).y < this.size.height / 2 ? 'above' : 'below';
    const edge = centre.clone().setZ(side === 'above' ? box.max.z : box.min.z);
    const end = (value: number): Point => this.toLocal(edge.clone().setComponent(AXIS_COMPONENT[object.dimensionAxis], value));
    return { id: object.id, from: end(box.min[object.dimensionAxis]), to: end(box.max[object.dimensionAxis]), text: `${object.dimensionMm} mm`, side };
  }

  private railSnapshot(rect: { left: number; top: number }): RailSnapshot | null {
    const part = this.railPart;
    const info = part && this.railInfo(part);
    const guides = this.moped.guides;
    guides.railLine.visible = guides.ticks.visible = guides.feeler.visible = guides.feelerEdge.visible = guides.foul.visible = false;
    if (!part || !info) return null;
    const run = this.run[part];
    const frame = this.railFrame(part, info);
    const travel = run.travel;
    const reached = info.stations.map((s) => s.travelMm <= travel + EPS);
    const contact = info.foulingFeature !== null && travel >= info.stopMm - EPS;
    const gaps = info.stations.filter((_, i) => reached[i] && info.stations[i]?.gapMm !== null).map((s) => tenths(s.gapMm ?? '0'));
    const lead = frame.leadingAt(travel + info.railMm * (1 - run.flight));
    const leadLocal = this.toLocal(lead);
    const flown = run.flight >= 1 - EPS;
    this.placeGuides(part, info, frame, travel, contact, flown);
    const stopLocal = contact ? this.toLocal(frame.leadingAt(info.stopMm)) : null;
    return {
      part,
      travelMm: num1(travel),
      railMm: info.railMm,
      stopMm: info.stopMm,
      contact,
      stations: info.stations.map((s, i) => ({ id: s.id, name: s.name, travelMm: s.travelMm, reached: reached[i] === true, gapMm: reached[i] ? (s.gapMm ?? '') : '' })),
      smallestGapMm: gaps.length ? fixed1(Math.min(...gaps) / 10) : '',
      foulingFeature: contact ? (info.foulingFeature ?? '') : '',
      leadingEdge: { x: rect.left + leadLocal.x, y: rect.top + leadLocal.y },
      foulingPoint: stopLocal ? { x: rect.left + stopLocal.x, y: rect.top + stopLocal.y } : null,
      leadingEdgeLocal: leadLocal,
      settled: flown,
    };
  }

  private placeGuides(part: RailPartId, info: RailInfo, frame: ReturnType<SceneModel['railFrame']>, travel: number, contact: boolean, flown: boolean): void {
    const h = this.moped.guides;
    if (!flown) return;
    const start = frame.leadingAt(0);
    const end = frame.leadingAt(info.railMm);
    h.railLine.geometry.setFromPoints([start, end]);
    h.railLine.computeLineDistances();
    h.railLine.visible = true;
    const ticks: THREE.Vector3[] = [];
    const lift = new THREE.Vector3(0, 0, 1);
    const perp = part === 'traction-pack' ? lift : new THREE.Vector3(1, 0, 0);
    for (const station of info.stations) {
      const p = frame.leadingAt(station.travelMm);
      ticks.push(p.clone().addScaledVector(perp, -32), p.clone().addScaledVector(perp, 32));
    }
    h.ticks.geometry.setFromPoints(ticks);
    h.ticks.visible = true;
    const p0 = this.toLocal(start);
    const p1 = this.toLocal(start.clone().addScaledVector(frame.dir, 100));
    const screen = Math.hypot(p1.x - p0.x, p1.y - p0.y) / 100;
    const thick = Math.min(60, Math.max(22, 6 / Math.max(screen, 0.01)));
    const [c1, c2] = frame.cross;
    const along = (vector: THREE.Vector3, size: [number, number, number]): void => void vector.set(...size);
    const place = (mesh: THREE.Mesh, at: THREE.Vector3, t: number, grow: number): void => {
      mesh.position.copy(at);
      along(mesh.scale, part === 'traction-pack' ? [t, c1 + grow, c2 + grow] : [c1 + grow, t, c2 + grow]);
    };
    if (contact) {
      place(h.foul, frame.leadingAt(info.stopMm), thick, 20);
      h.foul.visible = true;
    } else {
      place(h.feeler, frame.leadingAt(travel), 4, 30);
      h.feeler.visible = true;
      h.feelerEdge.position.copy(frame.leadingAt(travel));
      h.feelerEdge.rotation.z = part === 'traction-pack' ? 0 : Math.PI / 2;
      h.feelerEdge.scale.set(1, c1 + 30, c2 + 30);
      if (part === 'hub-motor') h.feelerEdge.scale.set(1, c2 + 30, c1 + 30);
      h.feelerEdge.visible = true;
    }
  }
}

function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

function applyLook(object: PartObject, fade: number, selected: boolean): void {
  const translucent = fade < 1;
  object.fills.forEach((material, i) => {
    material.color.setHex(selected ? COLOURS.selected : (object.tones[i] ?? COLOURS.body));
    material.opacity = fade;
    if (material.transparent !== translucent) { material.transparent = translucent; material.needsUpdate = true; }
    material.depthWrite = !translucent;
  });
  object.lines.forEach((material) => {
    material.opacity = fade;
    if (material.transparent !== translucent) { material.transparent = translucent; material.needsUpdate = true; }
  });
  object.meshes.forEach((mesh) => { mesh.renderOrder = fade < 1 ? 5 : 0; });
}
