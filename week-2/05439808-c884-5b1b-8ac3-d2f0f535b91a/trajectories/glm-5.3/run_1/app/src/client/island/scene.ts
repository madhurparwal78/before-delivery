// The island view: one application element carrying the published data attributes, the camera,
// the cursor and ghost, pointer/touch/keyboard input, and the animation loops. The renderer is
// WebGL with a flat top-down plan as the fallback.
import { reducedMotion, notice } from '../ui.ts';
import { BUILDINGS } from '../../domain/catalog.ts';
import type { BuildingType } from '../../domain/types.ts';
import { FlatRenderer, flatPick, flatBadge } from './flat.ts';
import { WebGLRenderer, webglPick, webglBadge } from './webgl.ts';

export type ViewKind = 'village' | 'scout' | 'raid' | 'replay';

export interface SceneBuilding {
  id: number;
  type: BuildingType;
  x: number;
  y: number;
  rotation: number;
  level: number;
  working: boolean;
  destroyed?: boolean;
}

export interface SceneUnit {
  index: number;
  unit: 'saltjack' | 'peat_slinger';
  x: number; // thousandths of a cell
  y: number;
  hp: number;
  alive: boolean;
}

export interface Ghost {
  type: BuildingType;
  x: number;
  y: number;
  rotation: number;
  valid: boolean;
}

export interface Camera {
  azimuth: number;
  zoom: number;
  panX: number;
  panY: number;
}

export interface Renderer {
  kind: 'webgl' | 'flat';
  resize(widthPx: number, heightPx: number): void;
  render(timeMs: number): void;
}

export interface ReplayOverlay {
  tick: number;
  destruction: number;
  stars: number;
  loot: { brine: number; peat: number; copper: number };
  hash: string;
  settled: boolean;
}

export interface SceneCallbacks {
  onSelectBuilding?(building: SceneBuilding): void;
  onEmptyTap?(): void;
  onCellCursor?(x: number, y: number): void;
  onGhostChanged?(): void;
  onDeployCell?(x: number, y: number): void;
  onOpenBuildDialog?(): void;
  onConfirmGhost?(): void;
  onCancelGhost?(): void;
  onSelectUnit?(index: number): void;
}

export function clampCell(value: number): number {
  return Math.max(0, Math.min(39, value));
}

export function footprintSize(type: BuildingType, rotation: number): { width: number; depth: number } {
  const { width, depth } = BUILDINGS[type];
  return rotation === 90 || rotation === 270 ? { width: depth, depth: width } : { width, depth };
}

export class IslandScene {
  readonly appElement: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly badgeLayer: HTMLElement;
  private renderer: Renderer | null = null;
  private buildings: SceneBuilding[] = [];
  private units: SceneUnit[] = [];
  private ghost: Ghost | null = null;
  private cursor = { x: 20, y: 20 };
  private hasRenderedOnce = false;
  private camera: Camera = { azimuth: 35, zoom: 1, panX: 20, panY: 20 };
  private animating = false;
  private rafHandle: number | null = null;
  private readonly riseAnimations = new Map<number, number>();
  private readonly collapseAnimations = new Map<number, number>();
  private readonly pulseAnimations = new Map<number, number>();
  private readonly view: ViewKind;
  private readonly cb: SceneCallbacks;
  private readonly reduced: boolean;
  private ghostDragging = false;
  private drawnTick = 0;
  private replayOverlay: ReplayOverlay | null = null;
  private flatRendererInstance: FlatRenderer | null = null;

  constructor(view: ViewKind, cb: SceneCallbacks = {}) {
    this.view = view;
    this.cb = cb;
    this.reduced = reducedMotion();

    this.appElement = document.createElement('div');
    this.appElement.setAttribute('role', 'application');
    this.appElement.setAttribute('aria-label', 'Island view');
    this.appElement.tabIndex = 0;
    this.appElement.style.position = 'relative';
    this.appElement.style.width = '100%';
    this.appElement.style.height = '100%';
    this.appElement.dataset.view = view;

    this.canvas = document.createElement('canvas');
    this.canvas.style.touchAction = 'none';
    this.badgeLayer = document.createElement('div');
    this.badgeLayer.style.position = 'absolute';
    this.badgeLayer.style.inset = '0';
    this.badgeLayer.style.pointerEvents = 'none';
    this.appElement.append(this.canvas, this.badgeLayer);

    if (view === 'raid') this.cursor = { x: 0, y: 20 };
    this.appElement.dataset.cursorX = String(this.cursor.x);
    this.appElement.dataset.cursorY = String(this.cursor.y);
    this.appElement.dataset.animating = 'false';
    this.applyCameraAttributes();
    this.initRenderer();
    this.bindInput();
    this.startLoop();
  }

  private initRenderer(): void {
    const gl = this.canvas.getContext('webgl', { antialias: true });
    if (gl !== null) {
      this.renderer = new WebGLRenderer(this, gl);
      this.appElement.dataset.renderer = 'webgl';
    } else {
      this.flatRendererInstance = new FlatRenderer(this);
      this.renderer = this.flatRendererInstance;
      this.appElement.dataset.renderer = 'flat';
      this.camera.azimuth = 0;
      this.applyCameraAttributes();
      notice('3D view unavailable — showing the flat plan.');
    }
  }

  // --- scene content ---

  setBuildings(buildings: SceneBuilding[]): void {
    const previous = new Map(this.buildings.map((b) => [b.id, b]));
    this.buildings = buildings;
    this.appElement.dataset.buildingCount = String(buildings.length);
    const now = performance.now();
    // nothing animates on the first render: the island was always there
    if (!this.reduced && this.hasRenderedOnce) {
      for (const building of buildings) {
        const before = previous.get(building.id);
        if (!before) this.riseAnimations.set(building.id, now);
        else if (before.level < building.level) this.pulseAnimations.set(building.id, now);
        else if (!before.destroyed && building.destroyed) this.collapseAnimations.set(building.id, now);
      }
    }
    this.hasRenderedOnce = true;
    this.updateBadges();
  }

  setUnits(units: SceneUnit[]): void {
    this.units = units;
  }

  getUnits(): SceneUnit[] {
    return this.units;
  }

  getBuildings(): SceneBuilding[] {
    return this.buildings;
  }

  setReplayOverlay(overlay: ReplayOverlay | null): void {
    this.replayOverlay = overlay;
    if (overlay === null) return;
    this.appElement.dataset.tick = String(overlay.tick);
    this.appElement.dataset.destruction = String(overlay.destruction);
    this.appElement.dataset.stars = String(overlay.stars);
    this.appElement.dataset.lootBrine = String(overlay.loot.brine);
    this.appElement.dataset.lootPeat = String(overlay.loot.peat);
    this.appElement.dataset.lootCopper = String(overlay.loot.copper);
    this.appElement.dataset.stateHash = String(overlay.hash);
    this.appElement.dataset.settled = String(overlay.settled);
  }

  setDrawnTick(tick: number): void {
    this.drawnTick = tick;
    this.appElement.dataset.drawnTick = String(tick);
  }

  getDrawnTick(): number {
    return this.drawnTick;
  }

  // --- ghost ---

  getGhost(): Ghost | null {
    return this.ghost;
  }

  showGhost(type: BuildingType, x: number, y: number): void {
    this.ghost = { type, x, y, rotation: 0, valid: this.computeGhostValid(type, x, y, 0) };
    this.applyGhostAttributes();
  }

  moveGhost(dx: number, dy: number): void {
    if (!this.ghost) return;
    this.ghost.x = clampCell(this.ghost.x + dx);
    this.ghost.y = clampCell(this.ghost.y + dy);
    this.ghost.valid = this.computeGhostValid(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
    this.applyGhostAttributes();
    this.cb.onGhostChanged?.();
  }

  rotateGhost(): void {
    if (!this.ghost) return;
    this.ghost.rotation = (this.ghost.rotation + 90) % 360;
    this.ghost.valid = this.computeGhostValid(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
    this.applyGhostAttributes();
    this.cb.onGhostChanged?.();
  }

  hideGhost(): void {
    this.ghost = null;
    this.applyGhostAttributes();
  }

  ghostValid(): boolean {
    return this.ghost?.valid ?? false;
  }

  private computeGhostValid(type: BuildingType, x: number, y: number, rotation: number): boolean {
    const { width, depth } = footprintSize(type, rotation);
    if (x < 2 || y < 2 || x + width - 1 > 37 || y + depth - 1 > 37) return false;
    return !this.buildings.some(
      (b) => !b.destroyed && x < b.x + footprintSize(b.type, b.rotation).width && b.x < x + width && y < b.y + footprintSize(b.type, b.rotation).depth && b.y < y + depth
    );
  }

  private applyGhostAttributes(): void {
    if (this.ghost === null) {
      delete this.appElement.dataset.ghostType;
      delete this.appElement.dataset.ghostX;
      delete this.appElement.dataset.ghostY;
      delete this.appElement.dataset.ghostRotation;
      delete this.appElement.dataset.ghostValid;
      return;
    }
    this.appElement.dataset.ghostType = this.ghost.type;
    this.appElement.dataset.ghostX = String(this.ghost.x);
    this.appElement.dataset.ghostY = String(this.ghost.y);
    this.appElement.dataset.ghostRotation = String(this.ghost.rotation);
    this.appElement.dataset.ghostValid = String(this.ghost.valid);
  }

  // --- camera ---

  getCamera(): Camera {
    return this.camera;
  }

  orbit(degrees: number): void {
    if (this.renderer?.kind === 'flat') {
      this.camera.azimuth = 0;
    } else {
      this.camera.azimuth = (((this.camera.azimuth + degrees) % 360) + 360) % 360;
    }
    this.applyCameraAttributes();
  }

  zoomBy(factor: number): void {
    this.camera.zoom = Math.min(2, Math.max(0.5, Math.round(this.camera.zoom * factor * 100) / 100));
    this.applyCameraAttributes();
  }

  panBy(dx: number, dy: number): void {
    this.camera.panX = Math.max(-6, Math.min(46, Math.round((this.camera.panX + dx) * 10) / 10));
    this.camera.panY = Math.max(-6, Math.min(46, Math.round((this.camera.panY + dy) * 10) / 10));
    this.applyCameraAttributes();
  }

  recentreOn(x: number, y: number): void {
    if (this.reduced) {
      this.camera.panX = x;
      this.camera.panY = y;
      this.applyCameraAttributes();
      return;
    }
    const startX = this.camera.panX;
    const startY = this.camera.panY;
    const startTime = performance.now();
    this.setAnimating(true);
    const step = (): void => {
      const t = Math.min(1, (performance.now() - startTime) / 250);
      this.camera.panX = startX + (x - startX) * t;
      this.camera.panY = startY + (y - startY) * t;
      this.applyCameraAttributes();
      if (t < 1) requestAnimationFrame(step);
      else this.setAnimating(false);
    };
    requestAnimationFrame(step);
  }

  private applyCameraAttributes(): void {
    this.appElement.dataset.cameraAzimuth = String(Math.round(this.camera.azimuth) % 360);
    this.appElement.dataset.cameraZoom = this.camera.zoom.toFixed(2);
    this.appElement.dataset.cameraPanX = this.camera.panX.toFixed(1);
    this.appElement.dataset.cameraPanY = this.camera.panY.toFixed(1);
  }

  // --- cursor ---

  moveCursor(dx: number, dy: number): void {
    this.cursor.x = clampCell(this.cursor.x + dx);
    this.cursor.y = clampCell(this.cursor.y + dy);
    this.appElement.dataset.cursorX = String(this.cursor.x);
    this.appElement.dataset.cursorY = String(this.cursor.y);
    this.cb.onCellCursor?.(this.cursor.x, this.cursor.y);
  }

  setCursor(x: number, y: number): void {
    this.cursor.x = clampCell(x);
    this.cursor.y = clampCell(y);
    this.appElement.dataset.cursorX = String(this.cursor.x);
    this.appElement.dataset.cursorY = String(this.cursor.y);
  }

  getCursor(): { x: number; y: number } {
    return this.cursor;
  }

  cursorAnnounceCopy(): string {
    const hit = this.buildingAt(this.cursor.x, this.cursor.y);
    if (hit) return `Cell ${this.cursor.x}, ${this.cursor.y} — ${BUILDINGS[hit.type].name} level ${hit.level}`;
    return `Cell ${this.cursor.x}, ${this.cursor.y} — open salt`;
  }

  buildingAt(x: number, y: number): SceneBuilding | null {
    return (
      this.buildings.find((b) => !b.destroyed && x >= b.x && x < b.x + footprintSize(b.type, b.rotation).width && y >= b.y && y < b.y + footprintSize(b.type, b.rotation).depth) ?? null
    );
  }

  setAnimating(value: boolean): void {
    this.animating = value;
    this.appElement.dataset.animating = String(value);
  }

  getAnimating(): boolean {
    return this.animating;
  }

  // --- picking ---

  screenToCell(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (this.renderer?.kind === 'flat') return flatPick(this.flatRendererInstance!, px, py);
    return webglPick(this, px, py);
  }

  // --- input ---

  private bindInput(): void {
    let panning = false;
    let orbiting = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    const touches = new Map<number, { x: number; y: number }>();
    let pinchStart: { dist: number; zoom: number } | null = null;
    let twistStart: { angle: number; azimuth: number } | null = null;

    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.camera.zoom };
          twistStart = { angle: Math.atan2(b.y - a.y, b.x - a.x), azimuth: this.camera.azimuth };
        }
        moved = false;
        if (touches.size === 1 && this.ghost !== null) {
          const cell = this.screenToCell(event.clientX, event.clientY);
          if (cell && this.ghostCoversCell(cell.x, cell.y)) this.ghostDragging = true;
        }
        return;
      }
      this.canvas.setPointerCapture(event.pointerId);
      lastX = event.clientX;
      lastY = event.clientY;
      panning = event.button === 0;
      orbiting = event.button === 2 || event.shiftKey;
      moved = false;
      if (this.ghost !== null && panning) {
        const cell = this.screenToCell(event.clientX, event.clientY);
        if (cell && this.ghostCoversCell(cell.x, cell.y)) {
          this.ghostDragging = true;
          panning = false;
        }
      }
    });

    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.canvas.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch') {
        if (!touches.has(event.pointerId)) return;
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size === 2) {
          const [a, b] = [...touches.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinchStart !== null) {
            this.camera.zoom = Math.min(2, Math.max(0.5, Math.round((pinchStart.zoom * dist) / pinchStart.dist * 100) / 100));
          }
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          if (twistStart !== null && this.renderer?.kind !== 'flat') {
            const delta = ((angle - twistStart.angle) * 180) / Math.PI;
            this.camera.azimuth = (((twistStart.azimuth + delta) % 360) + 360) % 360;
          }
          this.applyCameraAttributes();
          moved = true;
          return;
        }
        if (touches.size === 1) {
          const point = [...touches.values()][0];
          if (this.ghost !== null && this.ghostDragging) {
            const cell = this.screenToCell(point.x, point.y);
            if (cell !== null && (cell.x !== this.ghost.x || cell.y !== this.ghost.y)) {
              this.ghost.x = clampCell(cell.x);
              this.ghost.y = clampCell(cell.y);
              this.ghost.valid = this.computeGhostValid(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
              this.applyGhostAttributes();
              this.cb.onGhostChanged?.();
            }
            moved = true;
            return;
          }
          this.panByScreenDelta(point.x - lastX, point.y - lastY);
          lastX = point.x;
          lastY = point.y;
          moved = true;
        }
        return;
      }
      if (!panning && !orbiting && !this.ghostDragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      if (this.ghostDragging) {
        const cell = this.screenToCell(event.clientX, event.clientY);
        if (cell !== null && (cell.x !== this.ghost!.x || cell.y !== this.ghost!.y)) {
          this.ghost!.x = clampCell(cell.x);
          this.ghost!.y = clampCell(cell.y);
          this.ghost!.valid = this.computeGhostValid(this.ghost!.type, this.ghost!.x, this.ghost!.y, this.ghost!.rotation);
          this.applyGhostAttributes();
          this.cb.onGhostChanged?.();
        }
        return;
      }
      if (orbiting) {
        this.orbit(-dx * 0.4);
      } else {
        this.panByScreenDelta(dx, dy);
      }
    });

    const endPointer = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') {
        const wasSingle = touches.size === 1;
        const wasDragging = this.ghostDragging;
        touches.delete(event.pointerId);
        if (touches.size < 2) {
          pinchStart = null;
          twistStart = null;
        }
        this.ghostDragging = false;
        if (wasSingle && !moved && !wasDragging) {
          const cell = this.screenToCell(event.clientX, event.clientY);
          if (cell !== null) this.handleTap(cell.x, cell.y);
        }
        return;
      }
      const wasTap = (panning || orbiting) && !moved && !this.ghostDragging;
      panning = false;
      orbiting = false;
      this.ghostDragging = false;
      if (wasTap) {
        const cell = this.screenToCell(event.clientX, event.clientY);
        if (cell !== null) this.handleTap(cell.x, cell.y);
      }
    };
    this.canvas.addEventListener('pointerup', endPointer);
    this.canvas.addEventListener('pointercancel', endPointer);

    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoomBy(event.deltaY < 0 ? 1.08 : 1 / 1.08);
    }, { passive: false });

    this.appElement.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          event.preventDefault();
          const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
          const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
          if (this.ghost !== null) {
            this.moveGhost(dx, dy);
          } else if (event.shiftKey) {
            const theta = (this.camera.azimuth * Math.PI) / 180;
            this.panBy(-(dx * Math.cos(theta) + dy * Math.sin(theta)), -(dx * Math.sin(theta) + dy * Math.cos(theta)));
          } else if (this.view === 'raid') {
            this.moveCursorAlongRing(dx, dy);
          } else {
            this.moveCursor(dx, dy);
            notice(this.cursorAnnounceCopy());
          }
          break;
        }
        case 'q':
        case 'Q':
          this.orbit(-45);
          break;
        case 'e':
        case 'E':
          this.orbit(45);
          break;
        case '+':
        case '=':
          this.zoomBy(1.15);
          break;
        case '-':
        case '_':
          this.zoomBy(1 / 1.15);
          break;
        case 'b':
        case 'B':
          if (this.view === 'village') {
            event.preventDefault();
            this.cb.onOpenBuildDialog?.();
          }
          break;
        case 'r':
        case 'R':
          if (this.ghost !== null) this.rotateGhost();
          break;
        case 'Enter':
          if (this.ghost !== null) {
            event.preventDefault();
            this.cb.onConfirmGhost?.();
          } else {
            const building = this.buildingAt(this.cursor.x, this.cursor.y);
            if (building) {
              event.preventDefault();
              this.cb.onSelectBuilding?.(building);
            }
          }
          break;
        case 'Escape':
          if (this.ghost !== null) {
            event.preventDefault();
            this.cb.onCancelGhost?.();
          }
          break;
        case ' ':
          if (this.view === 'raid') {
            event.preventDefault();
            this.cb.onDeployCell?.(this.cursor.x, this.cursor.y);
          }
          break;
        case '1':
        case '2':
          if (this.view === 'raid') this.cb.onSelectUnit?.(event.key === '1' ? 0 : 1);
          break;
        default:
          break;
      }
    });
  }

  private ghostCoversCell(x: number, y: number): boolean {
    if (!this.ghost) return false;
    const { width, depth } = footprintSize(this.ghost.type, this.ghost.rotation);
    return x >= this.ghost.x && x < this.ghost.x + width && y >= this.ghost.y && y < this.ghost.y + depth;
  }

  handleTap(x: number, y: number): void {
    if (this.ghost !== null) {
      const { width, depth } = footprintSize(this.ghost.type, this.ghost.rotation);
      this.ghost.x = clampCell(Math.round(x - (width - 1) / 2));
      this.ghost.y = clampCell(Math.round(y - (depth - 1) / 2));
      this.ghost.valid = this.computeGhostValid(this.ghost.type, this.ghost.x, this.ghost.y, this.ghost.rotation);
      this.applyGhostAttributes();
      this.cb.onGhostChanged?.();
      return;
    }
    const building = this.buildingAt(x, y);
    if (building !== null) {
      this.cb.onSelectBuilding?.(building);
    } else {
      this.cb.onEmptyTap?.();
      if (this.view === 'raid') this.cb.onDeployCell?.(x, y);
    }
  }

  moveCursorAlongRing(dx: number, dy: number): void {
    const x = this.cursor.x + dx;
    const y = this.cursor.y + dy;
    if (x < 0 || x > 39 || y < 0 || y > 39) return;
    if (!(x <= 1 || x >= 38 || y <= 1 || y >= 38)) return;
    this.cursor.x = x;
    this.cursor.y = y;
    this.appElement.dataset.cursorX = String(x);
    this.appElement.dataset.cursorY = String(y);
    this.cb.onCellCursor?.(x, y);
  }

  // --- badges ---

  updateBadges(): void {
    this.badgeLayer.replaceChildren();
    for (const building of this.buildings) {
      if (building.destroyed) continue;
      const { width, depth } = footprintSize(building.type, building.rotation);
      const center =
        this.renderer?.kind === 'flat'
          ? flatBadge(this.flatRendererInstance!, building.x + width / 2, building.y + depth / 2)
          : webglBadge(this, building.x + width / 2, building.y + depth / 2);
      if (center === null) continue;
      const badge = document.createElement('span');
      badge.textContent = String(building.level);
      badge.style.position = 'absolute';
      badge.style.left = `${center.x}px`;
      badge.style.top = `${center.y}px`;
      badge.style.transform = 'translate(-50%, -100%)';
      badge.style.background = 'rgba(28, 31, 54, 0.85)';
      badge.style.border = '1px solid #e8763a';
      badge.style.borderRadius = '8px';
      badge.style.padding = '1px 7px';
      badge.style.color = '#f4f1e6';
      badge.style.fontFamily = "'JetBrains Mono', monospace";
      badge.style.fontSize = '0.8rem';
      this.badgeLayer.append(badge);
    }
  }

  // --- loop ---

  private startLoop(): void {
    const step = (): void => {
      this.rafHandle = requestAnimationFrame(step);
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(1, Math.floor(rect.width * dpr));
      const py = Math.max(1, Math.floor(rect.height * dpr));
      if (this.canvas.width !== px || this.canvas.height !== py) {
        this.canvas.width = px;
        this.canvas.height = py;
        this.renderer?.resize(px, py);
        this.updateBadges();
      }
      this.renderer?.render(performance.now());
      this.tickAnimations();
    };
    this.rafHandle = requestAnimationFrame(step);
  }

  private tickAnimations(): void {
    if (this.reduced) {
      if (this.animating) this.setAnimating(false);
      return;
    }
    const now = performance.now();
    let animating = false;
    for (const [id, start] of this.riseAnimations) {
      if (now - start > 560) this.riseAnimations.delete(id);
      else animating = true;
    }
    for (const [id, start] of this.collapseAnimations) {
      if (now - start > 560) this.collapseAnimations.delete(id);
      else animating = true;
    }
    for (const [id, start] of this.pulseAnimations) {
      if (now - start > 560) this.pulseAnimations.delete(id);
      else animating = true;
    }
    if (animating !== this.animating) this.setAnimating(animating);
    if (animating) this.updateBadges();
  }

  private panByScreenDelta(dx: number, dy: number): void {
    const scale = 26 / this.camera.zoom;
    const theta = (this.camera.azimuth * Math.PI) / 180;
    const worldDx = (dx * Math.cos(theta) - dy * Math.sin(theta)) / scale;
    const worldDy = (dx * Math.sin(theta) + dy * Math.cos(theta)) / scale;
    this.camera.panX = Math.max(-6, Math.min(46, this.camera.panX - worldDx));
    this.camera.panY = Math.max(-6, Math.min(46, this.camera.panY - worldDy));
    this.applyCameraAttributes();
  }

  destroy(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.appElement.remove();
  }

  expose(): {
    buildings: SceneBuilding[];
    units: SceneUnit[];
    ghost: Ghost | null;
    camera: Camera;
    cursor: { x: number; y: number };
    view: ViewKind;
    riseAnimations: Map<number, number>;
    collapseAnimations: Map<number, number>;
    pulseAnimations: Map<number, number>;
    reduced: boolean;
    replayOverlay: ReplayOverlay | null;
    canvas: HTMLCanvasElement;
  } {
    return {
      buildings: this.buildings,
      units: this.units,
      ghost: this.ghost,
      camera: this.camera,
      cursor: this.cursor,
      view: this.view,
      riseAnimations: this.riseAnimations,
      collapseAnimations: this.collapseAnimations,
      pulseAnimations: this.pulseAnimations,
      reduced: this.reduced,
      replayOverlay: this.replayOverlay,
      canvas: this.canvas,
    };
  }
}
