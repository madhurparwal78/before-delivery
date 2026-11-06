// The Island view: input (pointer, touch, keyboard), the camera, the cell cursor, the ghost, the
// transitions, and the public data attributes. Drawing is delegated to the WebGL or flat renderer.
import { BUILDINGS, GRID_SIZE, ROTATIONS, type BuildingType, type Rotation } from '../../shared/catalog';
import { buildingAt, footprint, insideBuildArea, occupied, onTidalRing } from '../../shared/grid';
import { FlatRenderer } from './flat';
import type { BuildingMotion, Camera, DrawState, Ghost, Renderer, SceneBuilding, SceneUnit, ViewMode } from './types';
import { createWebglRenderer } from './webgl';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const RISE_MS = 560;
const PULSE_MS = 250;
const CAMERA_MS = 250;
const LOOP_FRAME_MS = 80;

interface IslandHooks {
  announce(text: string): void;
  warn(text: string): void;
  openDetails(buildingId: number, viaKeyboard: boolean): void;
  closePanels(): void;
  openBuild(): void;
  confirmGhost(ghost: Ghost): void;
  ghostChanged(ghost: (Ghost & { valid: boolean }) | null): void;
  deploy(x: number, y: number): void;
  pickUnit(index: number): void;
}

interface Pointer {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
  button: number;
  shift: boolean;
}

const ease = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const wrap = (deg: number): number => ((Math.round(deg) % 360) + 360) % 360;

export class IslandController {
  readonly renderer: Renderer;
  private mode: ViewMode = 'village';
  private buildings: SceneBuilding[] = [];
  private known = new Set<number>();
  private hasLoaded = false;
  private levels = new Map<number, number>();
  private destroyed = new Map<number, boolean>();
  private motion = new Map<number, BuildingMotion & { riseAt: number; collapseAt: number; pulseAt: number; collapseFrom: number }>();
  private units: SceneUnit[] = [];
  private ghost: Ghost | null = null;
  private cursor = { x: 20, y: 20 };
  private selected: number | null = null;
  private camera: Camera = { azimuth: 0, zoom: 1, panX: 20, panY: 20, offsetX: 0, offsetY: 0 };
  private cameraTween: { from: Camera; to: Camera; start: number } | null = null;
  private pointers = new Map<number, Pointer>();
  private gesture: { distance: number; angle: number } | null = null;
  private ghostDrag = false;
  private dirty = true;
  private frame = 0;
  private lastLoopDraw = 0;
  private loopTime = 0;
  private lastFrameAt = performance.now();
  private panelAnimating = false;
  private size = { width: 0, height: 0 };
  private readonly observer: ResizeObserver;

  constructor(
    readonly element: HTMLElement,
    private canvas: HTMLCanvasElement,
    private readonly hooks: IslandHooks,
    private readonly reducedMotion: boolean,
  ) {
    const webgl = createWebglRenderer(canvas);
    if (webgl) this.renderer = webgl;
    else {
      // A canvas that was offered to WebGL cannot draw 2D, so the flat plan gets a fresh one.
      const fresh = document.createElement('canvas');
      canvas.replaceWith(fresh);
      this.canvas = fresh;
      this.renderer = new FlatRenderer(fresh);
    }
    element.dataset.renderer = this.renderer.kind;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(element);
    this.resize();
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('keydown', this.onKeyDown);
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    this.writeAttributes();
    this.renderer.draw(this.drawState());
    this.frame = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.dispose();
  }

  private resize(): void {
    const rect = this.element.getBoundingClientRect();
    this.size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    this.renderer.resize(this.size.width, this.size.height);
    this.dirty = true;
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.ghost = null;
    this.selected = null;
    this.hasLoaded = false;
    this.known.clear();
    this.levels.clear();
    this.destroyed.clear();
    this.motion.clear();
    this.units = [];
    this.cursor = mode === 'raid' ? { x: 0, y: 0 } : { x: 20, y: 20 };
    this.camera = { ...this.camera, panX: 20, panY: 20, offsetX: 0, offsetY: 0 };
    this.hooks.ghostChanged(null);
    this.changed();
  }

  /** New buildings rise, finished upgrades pulse, newly destroyed buildings collapse. */
  setBuildings(list: SceneBuilding[], animateDestruction = true): void {
    const now = performance.now();
    for (const b of list) {
      const m = this.motion.get(b.id) ?? { rise: 1, collapse: 0, pulse: 0, riseAt: 0, collapseAt: 0, pulseAt: 0, collapseFrom: 0 };
      if (this.hasLoaded && !this.known.has(b.id) && !this.reducedMotion) {
        m.rise = 0;
        m.riseAt = now;
      }
      const before = this.levels.get(b.id);
      if (this.hasLoaded && before !== undefined && b.level > before && !this.reducedMotion) {
        m.pulse = 0;
        m.pulseAt = now;
      }
      const wasDestroyed = this.destroyed.get(b.id) ?? false;
      if (b.destroyed !== wasDestroyed) {
        if (animateDestruction && this.hasLoaded && !this.reducedMotion) {
          m.collapseFrom = m.collapse;
          m.collapseAt = now;
        } else {
          m.collapse = b.destroyed ? 1 : 0;
          m.collapseAt = 0;
        }
      }
      this.motion.set(b.id, m);
      this.known.add(b.id);
      this.levels.set(b.id, b.level);
      this.destroyed.set(b.id, b.destroyed);
    }
    const first = !this.hasLoaded;
    this.buildings = list;
    this.hasLoaded = true;
    // The first island is drawn at once, so the scene's shaders are ready before any input.
    if (first) this.renderer.draw(this.drawState());
    if (this.selected !== null && !list.some((b) => b.id === this.selected)) this.selected = null;
    this.changed();
  }

  setUnits(units: SceneUnit[]): void {
    this.units = units;
    this.dirty = true;
  }

  setSelected(id: number | null): void {
    this.selected = id;
    this.changed();
  }

  setPanelAnimating(on: boolean): void {
    this.panelAnimating = on;
    this.writeAttributes();
  }

  get cursorCell(): { x: number; y: number } {
    return { ...this.cursor };
  }

  /** Eases the camera so the target cell sits in the middle of the area no panel covers. */
  frameCell(cellX: number, cellY: number, covered: DOMRect | null): void {
    let offsetX = 0;
    let offsetY = 0;
    if (covered) {
      const view = this.element.getBoundingClientRect();
      const bottomSheet = covered.left <= view.left + 1 && covered.width >= view.width - 2;
      if (bottomSheet) offsetY = (covered.top - view.top) / 2 - view.height / 2;
      else offsetX = (covered.left - view.left) / 2 - view.width / 2;
    }
    this.moveCamera({ ...this.camera, panX: cellX, panY: cellY, offsetX, offsetY });
  }

  clearFraming(): void {
    if (this.camera.offsetX === 0 && this.camera.offsetY === 0) return;
    this.moveCamera({ ...this.camera, offsetX: 0, offsetY: 0 });
  }

  private moveCamera(to: Camera): void {
    if (this.reducedMotion) {
      this.camera = to;
      this.changed();
      return;
    }
    this.cameraTween = { from: { ...this.camera }, to, start: performance.now() };
    this.changed();
  }

  startGhost(type: BuildingType, x: number, y: number, rotation: Rotation, movingId: number | null): void {
    this.ghost = this.clampGhost({ type, x, y, rotation, movingId });
    this.selected = null;
    const f = footprint(type, this.ghost.x, this.ghost.y, rotation);
    this.moveCamera({ ...this.camera, panX: f.x + f.width / 2, panY: f.y + f.depth / 2, offsetX: 0, offsetY: 0 });
    this.element.focus({ preventScroll: true });
  }

  /** Keeps the whole ghost footprint on the grid, so it can always be seen and steered. */
  private clampGhost(g: Ghost): Ghost {
    const f = footprint(g.type, g.x, g.y, g.rotation);
    return { ...g, x: clamp(g.x, 0, GRID_SIZE - f.width), y: clamp(g.y, 0, GRID_SIZE - f.depth) };
  }

  cancelGhost(): void {
    this.ghost = null;
    this.changed();
  }

  rotateGhost(): void {
    if (!this.ghost) return;
    const next = ROTATIONS[(ROTATIONS.indexOf(this.ghost.rotation) + 1) % ROTATIONS.length] as Rotation;
    this.ghost = this.clampGhost({ ...this.ghost, rotation: next });
    this.changed();
  }

  ghostState(): (Ghost & { valid: boolean }) | null {
    return this.ghost ? { ...this.ghost, valid: this.ghostValid(this.ghost) } : null;
  }

  private ghostValid(g: Ghost): boolean {
    const f = footprint(g.type, g.x, g.y, g.rotation);
    return insideBuildArea(f) && !occupied(this.buildings, f, g.movingId);
  }

  /** The canvas pixel of the ghost's far corner, for placing its action bar beside it. */
  ghostAnchor(): { x: number; y: number } | null {
    if (!this.ghost) return null;
    const f = footprint(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
    return this.renderer.project(f.x + f.width, f.y + f.depth / 2, this.camera);
  }

  private changed(): void {
    this.dirty = true;
    this.writeAttributes();
    this.hooks.ghostChanged(this.ghostState());
  }

  private animating(): boolean {
    if (this.cameraTween) return true;
    for (const m of this.motion.values()) if (m.riseAt || m.collapseAt || m.pulseAt) return true;
    return this.panelAnimating;
  }

  private writeAttributes(): void {
    const d = this.element.dataset;
    d.view = this.mode;
    d.buildingCount = String(this.buildings.length);
    d.cursorX = String(this.cursor.x);
    d.cursorY = String(this.cursor.y);
    d.cameraAzimuth = String(wrap(this.camera.azimuth));
    d.cameraZoom = this.camera.zoom.toFixed(2);
    d.cameraPanX = this.camera.panX.toFixed(1);
    d.cameraPanY = this.camera.panY.toFixed(1);
    d.animating = String(this.animating());
    const g = this.ghostState();
    if (g) {
      d.ghostType = g.type;
      d.ghostX = String(g.x);
      d.ghostY = String(g.y);
      d.ghostRotation = String(g.rotation);
      d.ghostValid = String(g.valid);
    } else {
      for (const key of ['ghostType', 'ghostX', 'ghostY', 'ghostRotation', 'ghostValid']) delete d[key];
    }
  }

  private tick = (): void => {
    this.frame = requestAnimationFrame(this.tick);
    const now = performance.now();
    const elapsed = now - this.lastFrameAt;
    this.lastFrameAt = now;
    let moving = false;
    if (this.cameraTween) {
      const t = ease((now - this.cameraTween.start) / CAMERA_MS);
      const { from, to } = this.cameraTween;
      this.camera = {
        azimuth: to.azimuth,
        zoom: to.zoom,
        panX: from.panX + (to.panX - from.panX) * t,
        panY: from.panY + (to.panY - from.panY) * t,
        offsetX: from.offsetX + (to.offsetX - from.offsetX) * t,
        offsetY: from.offsetY + (to.offsetY - from.offsetY) * t,
      };
      if (t >= 1) {
        this.camera = { ...to };
        this.cameraTween = null;
        this.writeAttributes();
      }
      moving = true;
    }
    for (const [id, m] of this.motion) {
      if (m.riseAt) {
        m.rise = ease((now - m.riseAt) / RISE_MS);
        if (m.rise >= 1) m.riseAt = 0;
        moving = true;
      }
      if (m.collapseAt) {
        const target = this.destroyed.get(id) ? 1 : 0;
        const t = ease((now - m.collapseAt) / RISE_MS);
        m.collapse = m.collapseFrom + (target - m.collapseFrom) * t;
        if (t >= 1) m.collapseAt = 0;
        moving = true;
      }
      if (m.pulseAt) {
        m.pulse = Math.min(1, (now - m.pulseAt) / PULSE_MS);
        if (m.pulse >= 1) {
          m.pulseAt = 0;
          m.pulse = 0;
        }
        moving = true;
      }
    }
    if (moving && !this.animating()) this.writeAttributes();
    else if (moving) this.element.dataset.animating = 'true';
    const looping = !this.reducedMotion && !document.hidden;
    if (looping) this.loopTime += elapsed / 1000;
    const loopDue = looping && now - this.lastLoopDraw >= LOOP_FRAME_MS;
    if (this.dirty || moving || loopDue) {
      this.renderer.draw(this.drawState());
      this.dirty = false;
      if (loopDue) this.lastLoopDraw = now;
      if (moving) this.hooks.ghostChanged(this.ghostState());
    }
  };

  private drawState(): DrawState {
    const g = this.ghostState();
    return {
      mode: this.mode,
      buildings: this.buildings,
      motion: this.motion,
      units: this.units,
      ghost: g,
      cursor: this.cursor,
      selected: this.selected,
      camera: this.camera,
      loopTime: this.loopTime,
    };
  }

  // Input -------------------------------------------------------------------------------------

  private local(e: PointerEvent | WheelEvent): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private cellAt(px: number, py: number): { x: number; y: number } | null {
    const p = this.renderer.pick(px, py, this.camera);
    if (!p) return null;
    const x = Math.floor(p.x);
    const y = Math.floor(p.y);
    return x >= 0 && y >= 0 && x < GRID_SIZE && y < GRID_SIZE ? { x, y } : null;
  }

  private onGhost(cell: { x: number; y: number } | null): boolean {
    if (!this.ghost || !cell) return false;
    const f = footprint(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
    return cell.x >= f.x && cell.x < f.x + f.width && cell.y >= f.y && cell.y < f.y + f.depth;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.target !== this.canvas && e.target !== this.element) return;
    const p = this.local(e);
    this.element.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: p.x, y: p.y, startX: p.x, startY: p.y, type: e.pointerType, button: e.button, shift: e.shiftKey });
    if (this.pointers.size === 1) this.ghostDrag = this.onGhost(this.cellAt(p.x, p.y));
    if (this.pointers.size === 2) {
      this.ghostDrag = false;
      this.gesture = this.twoFinger();
    }
    if (this.cameraTween) this.cameraTween = null;
  };

  private twoFinger(): { distance: number; angle: number } {
    const [a, b] = [...this.pointers.values()] as [Pointer, Pointer];
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const p = this.local(e);
    const prev = { x: pointer.x, y: pointer.y };
    pointer.x = p.x;
    pointer.y = p.y;
    if (this.pointers.size >= 2 && this.gesture) {
      const now = this.twoFinger();
      const zoom = clamp(this.camera.zoom * (now.distance / Math.max(1, this.gesture.distance)), ZOOM_MIN, ZOOM_MAX);
      const twist = this.renderer.kind === 'flat' ? 0 : ((now.angle - this.gesture.angle) * 180) / Math.PI;
      this.camera = { ...this.camera, zoom, azimuth: this.camera.azimuth - twist };
      this.gesture = now;
      this.changed();
      return;
    }
    if (this.ghostDrag && this.ghost) {
      const cell = this.cellAt(p.x, p.y);
      const start = this.cellAt(prev.x, prev.y);
      if (cell && start && (cell.x !== start.x || cell.y !== start.y)) {
        this.ghost = this.clampGhost({ ...this.ghost, x: this.ghost.x + (cell.x - start.x), y: this.ghost.y + (cell.y - start.y) });
        this.changed();
      } else if (cell && start) {
        pointer.x = prev.x;
        pointer.y = prev.y;
      }
      return;
    }
    const orbit = pointer.type === 'mouse' && (pointer.button === 2 || pointer.shift);
    if (orbit) {
      if (this.renderer.kind === 'webgl') this.camera = { ...this.camera, azimuth: this.camera.azimuth - (p.x - prev.x) * 0.4 };
    } else {
      const a = this.renderer.pick(prev.x, prev.y, this.camera);
      const b = this.renderer.pick(p.x, p.y, this.camera);
      if (a && b) this.camera = { ...this.camera, panX: clamp(this.camera.panX + a.x - b.x, 0, GRID_SIZE), panY: clamp(this.camera.panY + a.y - b.y, 0, GRID_SIZE) };
    }
    this.changed();
  };

  private onPointerUp = (e: PointerEvent): void => {
    const pointer = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.gesture = null;
    if (!pointer || e.type === 'pointercancel') return;
    const moved = Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY);
    if (moved < 6 && this.pointers.size === 0 && !this.ghostDrag) this.tap(this.cellAt(pointer.x, pointer.y));
    this.ghostDrag = false;
  };

  private tap(cell: { x: number; y: number } | null): void {
    if (!cell) return;
    if (this.mode === 'raid') {
      if (onTidalRing(cell.x, cell.y)) {
        this.cursor = cell;
        this.changed();
        this.hooks.deploy(cell.x, cell.y);
      }
      return;
    }
    if (this.ghost) return;
    this.cursor = cell;
    if (this.mode !== 'village') {
      this.changed();
      return;
    }
    const hit = buildingAt(this.buildings, cell.x, cell.y);
    if (hit) {
      this.selected = hit.id;
      this.changed();
      this.hooks.openDetails(hit.id, false);
    } else {
      this.selected = null;
      this.changed();
      this.hooks.closePanels();
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.camera = { ...this.camera, zoom: clamp(this.camera.zoom * factor, ZOOM_MIN, ZOOM_MAX) };
    this.changed();
  };

  private describeCursor(): string {
    const hit = buildingAt(this.buildings, this.cursor.x, this.cursor.y);
    const what = hit ? `${BUILDINGS[hit.type].name} level ${hit.level}` : 'open salt';
    return `Cell ${this.cursor.x}, ${this.cursor.y} — ${what}`;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const step = arrows[e.key];
    if (step && e.shiftKey) {
      e.preventDefault();
      this.camera = { ...this.camera, panX: clamp(this.camera.panX + step[0], 0, GRID_SIZE), panY: clamp(this.camera.panY + step[1], 0, GRID_SIZE) };
      this.changed();
      return;
    }
    if (step) {
      e.preventDefault();
      if (this.ghost) {
        this.ghost = this.clampGhost({ ...this.ghost, x: this.ghost.x + step[0], y: this.ghost.y + step[1] });
        this.changed();
        return;
      }
      const next = { x: clamp(this.cursor.x + step[0], 0, GRID_SIZE - 1), y: clamp(this.cursor.y + step[1], 0, GRID_SIZE - 1) };
      if (this.mode === 'raid' && !onTidalRing(next.x, next.y)) return;
      this.cursor = next;
      this.changed();
      this.hooks.announce(this.describeCursor());
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'q' || key === 'e') {
      if (this.renderer.kind === 'webgl') this.camera = { ...this.camera, azimuth: this.camera.azimuth + (key === 'q' ? -45 : 45) };
      this.changed();
      return;
    }
    if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      const delta = e.key === '+' || e.key === '=' ? 0.25 : -0.25;
      this.camera = { ...this.camera, zoom: clamp(this.camera.zoom + delta, ZOOM_MIN, ZOOM_MAX) };
      this.changed();
      return;
    }
    if (this.mode === 'raid') {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        this.hooks.deploy(this.cursor.x, this.cursor.y);
      } else if (e.key === '1' || e.key === '2') {
        this.hooks.pickUnit(Number(e.key) - 1);
      }
      return;
    }
    if (this.ghost) {
      if (key === 'r') this.rotateGhost();
      else if (e.key === 'Escape') {
        e.preventDefault();
        this.cancelGhost();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.confirmGhost();
      }
      return;
    }
    if (this.mode === 'village' && key === 'b') {
      e.preventDefault();
      this.hooks.openBuild();
      return;
    }
    if (e.key === 'Enter' && this.mode === 'village') {
      const hit = buildingAt(this.buildings, this.cursor.x, this.cursor.y);
      if (hit) {
        e.preventDefault();
        this.selected = hit.id;
        this.changed();
        this.hooks.openDetails(hit.id, true);
      }
      return;
    }
    if (e.key === 'Escape') this.hooks.closePanels();
  };

  /** Enter or "Confirm placement": an invalid ghost sends nothing and says why. */
  confirmGhost(): void {
    const g = this.ghostState();
    if (!g) return;
    if (!g.valid) {
      this.hooks.warn('That spot is taken or off the build area.');
      return;
    }
    this.hooks.confirmGhost({ type: g.type, x: g.x, y: g.y, rotation: g.rotation, movingId: g.movingId });
  }
}
