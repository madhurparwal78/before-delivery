import { CELLS_PER_LANE, LANES, SPAWN_POSITION, creatureSpec, deviceSpec } from '../shared/constants.js';
import type { Frame } from '../shared/types.js';
import { creatureSilhouette, deviceSilhouette, pierTexture } from './art.js';
import { button, clear, h } from './dom.js';

interface BoardCallbacks {
  onSelect: (lane: number, cell: number) => void;
  onActivate: (lane: number, cell: number) => void;
  inspector?: (lane: number, cell: number) => void;
}

const PAN_STEP = 40;
const ZOOM_STEPS = [1, 1.35, 1.8];

/**
 * The harbour chart: one roving tab stop over a lane-by-cell grid, with panning and zooming
 * confined to its own region and an accessible spatial counterpart for the procedural art.
 */
export class HarbourChart {
  readonly element: HTMLElement;
  readonly navigation: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly surface: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly overlay: HTMLElement;
  private readonly cells = new Map<string, HTMLElement>();
  private readonly markers = new Map<number, HTMLElement>();
  private readonly traces: HTMLElement;
  private selected = { lane: 1, cell: CELLS_PER_LANE };
  private buildable = new Set<string>();
  private pan = { x: 0, y: 0 };
  private zoomIndex = 0;
  private didDrag = false;
  private dragging: { pointerId: number; x: number; y: number } | null = null;

  constructor(private readonly callbacks: BoardCallbacks) {
    this.grid = h('div', { role: 'grid', 'aria-label': 'Harbour chart', class: 'chart-grid' });
    this.overlay = h('div', { class: 'chart-overlay', 'aria-hidden': 'true' });
    this.traces = h('div', { class: 'chart-traces', 'aria-hidden': 'true' });
    this.surface = h('div', { class: 'chart-surface' }, [
      pierTexture(LANES, CELLS_PER_LANE),
      this.grid,
      this.overlay,
      this.traces,
    ]);
    this.viewport = h('div', { class: 'chart-viewport' }, [this.surface]);
    this.navigation = h('div', { class: 'chart-navigation' }, [
      button('Pan left', () => this.panBy(PAN_STEP, 0), { className: 'chart-button' }),
      button('Pan right', () => this.panBy(-PAN_STEP, 0), { className: 'chart-button' }),
      button('Pan up', () => this.panBy(0, PAN_STEP), { className: 'chart-button' }),
      button('Pan down', () => this.panBy(0, -PAN_STEP), { className: 'chart-button' }),
      button('Zoom in', () => this.zoomBy(1), { className: 'chart-button' }),
      button('Zoom out', () => this.zoomBy(-1), { className: 'chart-button' }),
    ]);
    this.element = h('div', { class: 'chart' }, [this.viewport, this.navigation]);
    this.buildGrid();
    this.attachPanning();
  }

  private key(lane: number, cell: number): string {
    return `${lane}:${cell}`;
  }

  private buildGrid(): void {
    for (let lane = 1; lane <= LANES; lane += 1) {
      const row = h('div', { role: 'row', 'aria-label': `Lane ${lane}`, class: 'chart-row' });
      for (let cell = 1; cell <= CELLS_PER_LANE; cell += 1) {
        const element = h('div', {
          role: 'gridcell',
          'aria-label': `Lane ${lane}, cell ${cell}`,
          class: 'chart-cell',
          tabindex: '-1',
          'data-lane': lane,
          'data-cell': cell,
        });
        element.append(h('span', { class: 'cell-coordinate' }, [`${lane}·${cell}`]));
        element.append(h('span', { class: 'cell-state' }));
        element.append(h('span', { class: 'cell-occupant' }));
        if (this.callbacks.inspector !== undefined) {
          const inspect = button(
            `Inspect crew ${lane}, ${cell}`,
            () => (this.callbacks.inspector as (lane: number, cell: number) => void)(lane, cell),
            { label: 'Inspect crew', className: 'action cell-inspect' },
          );
          inspect.tabIndex = -1;
          inspect.addEventListener('keydown', (event) => event.stopPropagation());
          inspect.addEventListener('click', (event) => event.stopPropagation());
          element.append(inspect);
        }
        element.addEventListener('click', () => { if (!this.didDrag) this.select(lane, cell, true); });
        element.addEventListener('keydown', (event) => this.onKeyDown(event as KeyboardEvent, lane, cell));
        this.cells.set(this.key(lane, cell), element);
        row.append(element);
      }
      this.grid.append(row);
    }
    this.applySelection();
  }

  private onKeyDown(event: KeyboardEvent, lane: number, cell: number): void {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.callbacks.onActivate(lane, cell);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.select(lane, 1, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      this.select(lane, CELLS_PER_LANE, true);
      return;
    }
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const nextLane = Math.min(Math.max(lane + move[0], 1), LANES);
    const nextCell = Math.min(Math.max(cell + move[1], 1), CELLS_PER_LANE);
    this.select(nextLane, nextCell, true);
  }

  private attachPanning(): void {
    this.viewport.addEventListener('pointerdown', (event) => {
      this.didDrag = false;
      this.dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    });
    this.viewport.addEventListener('pointermove', (event) => {
      if (this.dragging === null || this.dragging.pointerId !== event.pointerId) return;
      const dx = event.clientX - this.dragging.x;
      const dy = event.clientY - this.dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.didDrag = true;
      if (!this.didDrag) return;
      this.viewport.setPointerCapture(event.pointerId);
      this.panBy(dx, dy);
      this.didDrag = false;
      this.dragging = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    });
    const release = (): void => {
      this.dragging = null;
    };
    this.viewport.addEventListener('pointerup', release);
    this.viewport.addEventListener('pointercancel', release);
    this.viewport.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.panBy(-event.deltaX, -event.deltaY);
      },
      { passive: false },
    );
  }

  private panBy(x: number, y: number): void {
    this.pan = { x: this.pan.x + x, y: this.pan.y + y };
    this.applyTransform();
  }

  private zoomBy(direction: number): void {
    this.zoomIndex = Math.min(Math.max(this.zoomIndex + direction, 0), ZOOM_STEPS.length - 1);
    this.applyTransform();
    this.revealSelected();
  }

  private applyTransform(): void {
    const scale = ZOOM_STEPS[this.zoomIndex];
    this.surface.style.transform = `translate(${this.pan.x}px, ${this.pan.y}px) scale(${scale})`;
  }

  private revealSelected(): void {
    const element = this.cells.get(this.key(this.selected.lane, this.selected.cell));
    if (element === undefined) return;
    const cellBox = element.getBoundingClientRect();
    const viewBox = this.viewport.getBoundingClientRect();
    let dx = 0;
    let dy = 0;
    if (cellBox.left < viewBox.left) dx = viewBox.left - cellBox.left;
    if (cellBox.right > viewBox.right) dx = viewBox.right - cellBox.right;
    if (cellBox.top < viewBox.top) dy = viewBox.top - cellBox.top;
    if (cellBox.bottom > viewBox.bottom) dy = viewBox.bottom - cellBox.bottom;
    if (dx !== 0 || dy !== 0) this.panBy(dx, dy);
  }

  select(lane: number, cell: number, focus: boolean): void {
    this.selected = { lane, cell };
    this.applySelection();
    if (focus) {
      const element = this.cells.get(this.key(lane, cell));
      element?.focus({ preventScroll: true });
      this.revealSelected();
    }
    this.callbacks.onSelect(lane, cell);
  }

  selection(): { lane: number; cell: number } {
    return { ...this.selected };
  }

  focusSelected(): void {
    this.cells.get(this.key(this.selected.lane, this.selected.cell))?.focus({ preventScroll: true });
  }

  private applySelection(): void {
    for (const [key, element] of this.cells) {
      const isSelected = key === this.key(this.selected.lane, this.selected.cell);
      element.setAttribute('tabindex', isSelected ? '0' : '-1');
      element.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      element.classList.toggle('selected', isSelected);
    }
  }

  setBuildable(cells: { lane: number; cell: number }[]): void {
    this.buildable = new Set(cells.map((cell) => this.key(cell.lane, cell.cell)));
    for (const [key, element] of this.cells) {
      const buildable = this.buildable.has(key);
      element.classList.toggle('buildable', buildable);
      (element.querySelector('.cell-state') as HTMLElement).textContent = buildable
        ? 'Buildable'
        : 'Not buildable';
    }
  }

  /** Renders installations and storm creatures without replacing gridcell identity. */
  render(frame: Frame | null): void {
    const occupants = new Map<string, Frame['devices'][number]>();
    for (const device of frame?.devices ?? []) occupants.set(this.key(device.lane, device.cell), device);
    for (const [key, element] of this.cells) {
      const slot = element.querySelector('.cell-occupant') as HTMLElement;
      const inspect = element.querySelector('.cell-inspect') as HTMLButtonElement | null;
      const occupant = occupants.get(key);
      clear(slot);
      element.classList.toggle('occupied', occupant !== undefined);
      element.setAttribute('aria-description', `${this.buildable.has(key) ? 'Buildable' : 'Not buildable'}; ${occupant === undefined ? 'empty' : `${deviceSpec(occupant.device).name}; ${occupant.tier}`}`);
      if (inspect !== null) { inspect.disabled = occupant === undefined; inspect.tabIndex = occupant === undefined ? -1 : 0; }
      if (occupant === undefined) {
        slot.textContent = '';
        element.title = `${key.replace(':', ' · ')} — ${this.buildable.has(key) ? 'Buildable' : 'Not buildable'}, empty`;
        continue;
      }
      element.title = `${key.replace(':', ' · ')} — ${deviceSpec(occupant.device).name} (${occupant.tier})`;
      const spec = deviceSpec(occupant.device);
      slot.append(deviceSilhouette(spec.id, spec.silhouette));
      slot.append(h('span', { class: 'occupant-label' }, [`${spec.name} (${occupant.tier})`]));
    }
    const live = new Set<number>();
    for (const creature of frame?.creatures ?? []) {
      live.add(creature.id);
      let marker = this.markers.get(creature.id);
      if (marker === undefined) {
        const spec = creatureSpec(creature.creature);
        marker = h('div', { class: 'creature-marker' });
        marker.append(creatureSilhouette(spec.id, spec.silhouette));
        this.markers.set(creature.id, marker);
        this.overlay.append(marker);
      }
      marker.style.left = `${(creature.position / (SPAWN_POSITION + 1)) * 100}%`;
      marker.style.top = `${((creature.lane - 1) / LANES) * 100}%`;
      marker.style.height = `${100 / LANES}%`;
      marker.title = `${creatureSpec(creature.creature).name} health ${creature.health}`;
    }
    for (const [id, marker] of this.markers) {
      if (live.has(id)) continue;
      marker.remove();
      this.markers.delete(id);
    }
  }

  /** The forecast trace layer drawn over the actual pier. */
  traceLayer(): HTMLElement {
    return this.traces;
  }

  clearTraces(): void {
    clear(this.traces);
  }
}
