import {
  fitsBuildArea,
  footprintAt,
  footprintsOverlap,
  isOnDeployRing
} from '../../shared/catalog.js';
import type { BuildingType, Rotation } from '../../shared/types.js';
import { el, prefersReducedMotion } from '../dom.js';
import { createFlatRenderer } from './flat.js';
import { createWebglRenderer } from './webgl.js';
import {
  DEFAULT_CAMERA,
  GROUND_CELLS,
  type CameraState,
  type IslandRenderer,
  type SceneBuilding,
  type SceneGhost,
  type SceneUnit
} from './types.js';

export type IslandViewKind = 'village' | 'scout' | 'raid' | 'replay';

export type GhostState = {
  type: BuildingType;
  x: number;
  y: number;
  rotation: Rotation;
  buildingId: number | null;
};

export type IslandHandlers = {
  onSelectBuilding?: (id: number) => void;
  onSelectEmpty?: () => void;
  onCursorMove?: (x: number, y: number) => void;
  onConfirmGhost?: () => void;
  onCancelGhost?: () => void;
  onInvalidGhost?: () => void;
  onOpenBuild?: () => void;
  onDeploy?: (x: number, y: number) => void;
  onPickUnit?: (index: number) => void;
  onRendererFallback?: () => void;
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

export class IslandView {
  readonly root: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly renderer: IslandRenderer;
  private readonly handlers: IslandHandlers;
  private buildings: SceneBuilding[] = [];
  private camera: CameraState = { ...DEFAULT_CAMERA };
  private cursorX = 20;
  private cursorY = 20;
  private ghost: GhostState | null = null;
  private frameHandle = 0;
  private reduced = prefersReducedMotion();
  private animationUntil = 0;

  constructor(kind: IslandViewKind, handlers: IslandHandlers = {}) {
    this.handlers = handlers;
    this.surface = el('div', { class: 'island-surface' });
    this.root = el(
      'div',
      {
        role: 'application',
        'aria-label': 'Island view',
        tabindex: '0',
        class: 'island-view',
        'data-view': kind
      },
      [this.surface]
    );
    const webgl = createWebglRenderer(this.surface);
    if (webgl === null) {
      this.renderer = createFlatRenderer(this.surface);
      handlers.onRendererFallback?.();
    } else {
      this.renderer = webgl;
    }
    this.root.dataset.renderer = this.renderer.kind;
    this.renderer.setReducedMotion(this.reduced);
    this.writeCameraAttributes();
    this.writeCursorAttributes();
    this.root.dataset.buildingCount = '0';
    this.root.dataset.animating = 'false';
    this.bindPointer();
    this.bindKeyboard();
    this.bindTouch();
    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  mountedInto(parent: HTMLElement): void {
    parent.append(this.root);
    this.onResize();
  }

  dispose(): void {
    window.cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
    this.root.remove();
  }

  private readonly onResize = (): void => {
    this.renderer.resize(this.root.clientWidth, this.root.clientHeight);
  };

  private loop(): void {
    const step = (): void => {
      const now = performance.now();
      const animating = this.renderer.frame(now);
      const pending = animating || now < this.animationUntil;
      const next = pending ? 'true' : 'false';
      if (this.root.dataset.animating !== next) this.root.dataset.animating = next;
      this.frameHandle = window.requestAnimationFrame(step);
    };
    this.frameHandle = window.requestAnimationFrame(step);
  }

  markAnimating(durationMs: number): void {
    if (this.reduced) return;
    this.animationUntil = Math.max(this.animationUntil, performance.now() + durationMs);
  }

  setBuildings(buildings: SceneBuilding[]): void {
    this.buildings = buildings;
    this.root.dataset.buildingCount = String(buildings.length);
    this.renderer.setBuildings(buildings);
    if (this.ghost !== null) this.writeGhostAttributes();
  }

  setUnits(units: SceneUnit[]): void {
    this.renderer.setUnits(units);
  }

  get cursor(): { x: number; y: number } {
    return { x: this.cursorX, y: this.cursorY };
  }

  get ghostState(): GhostState | null {
    return this.ghost;
  }

  get rendererKind(): 'webgl' | 'flat' {
    return this.renderer.kind;
  }

  setCamera(next: Partial<CameraState>): void {
    const azimuth = ((Math.round(next.azimuth ?? this.camera.azimuth) % 360) + 360) % 360;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next.zoom ?? this.camera.zoom));
    const panX = Math.min(GROUND_CELLS, Math.max(0, next.panX ?? this.camera.panX));
    const panY = Math.min(GROUND_CELLS, Math.max(0, next.panY ?? this.camera.panY));
    this.camera = {
      azimuth: this.renderer.kind === 'flat' ? 0 : azimuth,
      zoom: Math.round(zoom * 100) / 100,
      panX: Math.round(panX * 10) / 10,
      panY: Math.round(panY * 10) / 10
    };
    this.renderer.setCamera(this.camera);
    this.writeCameraAttributes();
  }

  recentreOn(x: number, y: number): void {
    this.setCamera({ panX: x, panY: y });
    this.markAnimating(250);
  }

  private writeCameraAttributes(): void {
    this.root.dataset.cameraAzimuth = String(this.camera.azimuth);
    this.root.dataset.cameraZoom = this.camera.zoom.toFixed(2);
    this.root.dataset.cameraPanX = this.camera.panX.toFixed(1);
    this.root.dataset.cameraPanY = this.camera.panY.toFixed(1);
  }

  private writeCursorAttributes(): void {
    this.root.dataset.cursorX = String(this.cursorX);
    this.root.dataset.cursorY = String(this.cursorY);
    this.renderer.setCursor(this.cursorX, this.cursorY);
  }

  setCursor(x: number, y: number, announce = true): void {
    const clampedX = Math.min(GROUND_CELLS - 1, Math.max(0, x));
    const clampedY = Math.min(GROUND_CELLS - 1, Math.max(0, y));
    if (clampedX === this.cursorX && clampedY === this.cursorY && !announce) return;
    this.cursorX = clampedX;
    this.cursorY = clampedY;
    this.writeCursorAttributes();
    if (announce) this.handlers.onCursorMove?.(clampedX, clampedY);
  }

  buildingAt(x: number, y: number): SceneBuilding | null {
    return (
      this.buildings.find((building) => {
        const footprint = footprintAt(building.type, building.rotation);
        return (
          x >= building.x &&
          x < building.x + footprint.width &&
          y >= building.y &&
          y < building.y + footprint.depth
        );
      }) ?? null
    );
  }

  startGhost(ghost: GhostState): void {
    this.ghost = ghost;
    this.writeGhostAttributes();
  }

  moveGhost(dx: number, dy: number): void {
    if (this.ghost === null) return;
    this.ghost = { ...this.ghost, x: this.ghost.x + dx, y: this.ghost.y + dy };
    this.writeGhostAttributes();
  }

  placeGhostAt(x: number, y: number): void {
    if (this.ghost === null) return;
    this.ghost = { ...this.ghost, x, y };
    this.writeGhostAttributes();
  }

  rotateGhost(): void {
    if (this.ghost === null) return;
    const rotations: Rotation[] = [0, 90, 180, 270];
    const index = rotations.indexOf(this.ghost.rotation);
    this.ghost = { ...this.ghost, rotation: rotations[(index + 1) % 4] ?? 0 };
    this.writeGhostAttributes();
  }

  cancelGhost(): void {
    this.ghost = null;
    this.renderer.setGhost(null);
    delete this.root.dataset.ghostType;
    delete this.root.dataset.ghostX;
    delete this.root.dataset.ghostY;
    delete this.root.dataset.ghostRotation;
    delete this.root.dataset.ghostValid;
  }

  ghostIsValid(): boolean {
    if (this.ghost === null) return false;
    const { type, x, y, rotation, buildingId } = this.ghost;
    if (!fitsBuildArea(type, x, y, rotation)) return false;
    return !this.buildings.some(
      (building) =>
        building.id !== buildingId && footprintsOverlap({ type, x, y, rotation }, building)
    );
  }

  private writeGhostAttributes(): void {
    if (this.ghost === null) return;
    const valid = this.ghostIsValid();
    this.root.dataset.ghostType = this.ghost.type;
    this.root.dataset.ghostX = String(this.ghost.x);
    this.root.dataset.ghostY = String(this.ghost.y);
    this.root.dataset.ghostRotation = String(this.ghost.rotation);
    this.root.dataset.ghostValid = valid ? 'true' : 'false';
    this.renderer.setGhost({ ...this.ghost, valid } satisfies SceneGhost);
  }

  private bindPointer(): void {
    let dragging: 'none' | 'pan' | 'orbit' | 'ghost' = 'none';
    let lastX = 0;
    let lastY = 0;
    let moved = false;

    this.root.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch') return;
      this.root.focus();
      lastX = event.clientX;
      lastY = event.clientY;
      moved = false;
      const cell = this.renderer.pickCell(event.clientX, event.clientY);
      const onGhost =
        this.ghost !== null &&
        cell !== null &&
        cell.x >= this.ghost.x &&
        cell.y >= this.ghost.y &&
        cell.x < this.ghost.x + footprintAt(this.ghost.type, this.ghost.rotation).width &&
        cell.y < this.ghost.y + footprintAt(this.ghost.type, this.ghost.rotation).depth;
      if (onGhost) dragging = 'ghost';
      else if (event.button === 2 || event.shiftKey) dragging = 'orbit';
      else dragging = 'pan';
      this.root.setPointerCapture(event.pointerId);
    });

    this.root.addEventListener('pointermove', (event) => {
      if (dragging === 'none' || event.pointerType === 'touch') return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      if (dragging === 'orbit') {
        this.setCamera({ azimuth: this.camera.azimuth + dx * 0.5 });
      } else if (dragging === 'pan') {
        const scale = 0.04 / this.camera.zoom;
        const radians = (this.camera.azimuth * Math.PI) / 180;
        const worldX = -dx * scale;
        const worldY = -dy * scale;
        this.setCamera({
          panX: this.camera.panX + worldX * Math.cos(radians) + worldY * Math.sin(radians),
          panY: this.camera.panY - worldX * Math.sin(radians) + worldY * Math.cos(radians)
        });
      } else if (dragging === 'ghost') {
        const cell = this.renderer.pickCell(event.clientX, event.clientY);
        if (cell !== null) this.placeGhostAt(cell.x, cell.y);
      }
      lastX = event.clientX;
      lastY = event.clientY;
    });

    this.root.addEventListener('pointerup', (event) => {
      if (event.pointerType === 'touch') return;
      const wasDragging = dragging;
      dragging = 'none';
      if (moved || wasDragging === 'ghost') return;
      const cell = this.renderer.pickCell(event.clientX, event.clientY);
      if (cell === null) return;
      this.setCursor(cell.x, cell.y, false);
      if (this.handlers.onDeploy) {
        this.handlers.onDeploy(cell.x, cell.y);
        return;
      }
      const building = this.buildingAt(cell.x, cell.y);
      if (building) this.handlers.onSelectBuilding?.(building.id);
      else this.handlers.onSelectEmpty?.();
    });

    this.root.addEventListener('contextmenu', (event) => event.preventDefault());

    this.root.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.setCamera({ zoom: this.camera.zoom * (event.deltaY < 0 ? 1.1 : 0.9) });
      },
      { passive: false }
    );
  }

  private bindTouch(): void {
    const points = new Map<number, { x: number; y: number }>();
    let startDistance = 0;
    let startAngle = 0;
    let startZoom = 1;
    let startAzimuth = 0;
    let ghostDrag = false;

    const centreOf = (): { x: number; y: number } => {
      let x = 0;
      let y = 0;
      for (const point of points.values()) {
        x += point.x;
        y += point.y;
      }
      return { x: x / points.size, y: y / points.size };
    };

    this.root.addEventListener(
      'touchstart',
      (event) => {
        event.preventDefault();
        this.root.focus();
        for (const touch of Array.from(event.changedTouches)) {
          points.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
        }
        if (points.size === 1) {
          const [touch] = Array.from(event.touches);
          const cell = touch ? this.renderer.pickCell(touch.clientX, touch.clientY) : null;
          ghostDrag =
            this.ghost !== null &&
            cell !== null &&
            cell.x >= this.ghost.x &&
            cell.y >= this.ghost.y &&
            cell.x < this.ghost.x + footprintAt(this.ghost.type, this.ghost.rotation).width &&
            cell.y < this.ghost.y + footprintAt(this.ghost.type, this.ghost.rotation).depth;
        }
        if (points.size === 2) {
          const [first, second] = Array.from(points.values());
          if (first && second) {
            startDistance = Math.hypot(second.x - first.x, second.y - first.y);
            startAngle = Math.atan2(second.y - first.y, second.x - first.x);
            startZoom = this.camera.zoom;
            startAzimuth = this.camera.azimuth;
          }
        }
      },
      { passive: false }
    );

    this.root.addEventListener(
      'touchmove',
      (event) => {
        event.preventDefault();
        const previousCentre = centreOf();
        for (const touch of Array.from(event.changedTouches)) {
          if (points.has(touch.identifier)) {
            points.set(touch.identifier, { x: touch.clientX, y: touch.clientY });
          }
        }
        if (points.size === 1) {
          const centre = centreOf();
          if (ghostDrag) {
            const cell = this.renderer.pickCell(centre.x, centre.y);
            if (cell !== null) this.placeGhostAt(cell.x, cell.y);
            return;
          }
          const dx = centre.x - previousCentre.x;
          const dy = centre.y - previousCentre.y;
          const scale = 0.04 / this.camera.zoom;
          const radians = (this.camera.azimuth * Math.PI) / 180;
          const worldX = -dx * scale;
          const worldY = -dy * scale;
          this.setCamera({
            panX: this.camera.panX + worldX * Math.cos(radians) + worldY * Math.sin(radians),
            panY: this.camera.panY - worldX * Math.sin(radians) + worldY * Math.cos(radians)
          });
          return;
        }
        if (points.size >= 2) {
          const [first, second] = Array.from(points.values());
          if (!first || !second) return;
          const distance = Math.hypot(second.x - first.x, second.y - first.y);
          const angle = Math.atan2(second.y - first.y, second.x - first.x);
          if (startDistance > 0) {
            this.setCamera({
              zoom: startZoom * (distance / startDistance),
              azimuth: startAzimuth + ((angle - startAngle) * 180) / Math.PI
            });
          }
        }
      },
      { passive: false }
    );

    const endTouch = (event: TouchEvent): void => {
      event.preventDefault();
      const singleTap = points.size === 1 && !ghostDrag;
      const remembered = Array.from(points.values())[0];
      for (const touch of Array.from(event.changedTouches)) points.delete(touch.identifier);
      if (points.size === 0) {
        ghostDrag = false;
        if (singleTap && remembered) {
          const cell = this.renderer.pickCell(remembered.x, remembered.y);
          if (cell === null) return;
          this.setCursor(cell.x, cell.y, false);
          if (this.handlers.onDeploy) {
            this.handlers.onDeploy(cell.x, cell.y);
            return;
          }
          const building = this.buildingAt(cell.x, cell.y);
          if (building) this.handlers.onSelectBuilding?.(building.id);
          else this.handlers.onSelectEmpty?.();
        }
      }
    };
    this.root.addEventListener('touchend', endTouch, { passive: false });
    this.root.addEventListener('touchcancel', endTouch, { passive: false });
  }

  private bindKeyboard(): void {
    this.root.addEventListener('keydown', (event) => {
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      };
      const delta = deltas[event.key];
      if (delta) {
        event.preventDefault();
        const [dx, dy] = delta;
        if (event.shiftKey) {
          this.setCamera({ panX: this.camera.panX + dx, panY: this.camera.panY + dy });
          return;
        }
        if (this.ghost !== null) {
          this.moveGhost(dx, dy);
          return;
        }
        if (this.root.dataset.view === 'raid') {
          const nextX = this.cursorX + dx;
          const nextY = this.cursorY + dy;
          if (isOnDeployRing(nextX, nextY)) this.setCursor(nextX, nextY);
          return;
        }
        this.setCursor(this.cursorX + dx, this.cursorY + dy);
        return;
      }
      if (event.key === 'q' || event.key === 'Q') {
        this.setCamera({ azimuth: this.camera.azimuth - 45 });
        return;
      }
      if (event.key === 'e' || event.key === 'E') {
        this.setCamera({ azimuth: this.camera.azimuth + 45 });
        return;
      }
      if (event.key === '+' || event.key === '=') {
        this.setCamera({ zoom: this.camera.zoom + 0.1 });
        return;
      }
      if (event.key === '-' || event.key === '_') {
        this.setCamera({ zoom: this.camera.zoom - 0.1 });
        return;
      }
      if ((event.key === 'r' || event.key === 'R') && this.ghost !== null) {
        this.rotateGhost();
        return;
      }
      if ((event.key === 'b' || event.key === 'B') && this.ghost === null) {
        this.handlers.onOpenBuild?.();
        return;
      }
      if (event.key === 'Escape' && this.ghost !== null) {
        this.handlers.onCancelGhost?.();
        return;
      }
      if (event.key === '1') {
        this.handlers.onPickUnit?.(0);
        return;
      }
      if (event.key === '2') {
        this.handlers.onPickUnit?.(1);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        if (this.ghost !== null) {
          if (this.ghostIsValid()) this.handlers.onConfirmGhost?.();
          else this.handlers.onInvalidGhost?.();
          return;
        }
        if (this.handlers.onDeploy) {
          this.handlers.onDeploy(this.cursorX, this.cursorY);
          return;
        }
        const building = this.buildingAt(this.cursorX, this.cursorY);
        if (building) this.handlers.onSelectBuilding?.(building.id);
      }
    });
  }

  setReplayAttributes(values: {
    tick: number;
    destruction: number;
    stars: number;
    loot: { brine: number; peat: number; copper: number };
    hash: string;
    settled: boolean;
  }): void {
    this.root.dataset.tick = String(values.tick);
    this.root.dataset.destruction = String(values.destruction);
    this.root.dataset.stars = String(values.stars);
    this.root.dataset.lootBrine = String(values.loot.brine);
    this.root.dataset.lootPeat = String(values.loot.peat);
    this.root.dataset.lootCopper = String(values.loot.copper);
    this.root.dataset.stateHash = values.hash;
    this.root.dataset.settled = values.settled ? 'true' : 'false';
  }

  setSettled(settled: boolean): void {
    this.root.dataset.settled = settled ? 'true' : 'false';
  }

  setDrawnTick(tick: number): void {
    this.root.dataset.drawnTick = String(tick);
  }
}
