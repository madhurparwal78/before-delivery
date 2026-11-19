/**
 * The tower stage: one accessible grid of unit cells, drawn either over the 3D
 * stage or as the flat floor grid, with the Window Lens following the newest
 * unit under the pointer or keyboard focus.
 */

import { el, icon, prefersReducedMotion, setAttributes } from '../dom';
import { Lens, LENS_DIAMETER, type LensSubject } from './lens';
import { TowerScene } from './scene';
import { chipText, type DisplayStatus } from '../../shared/labels';
import {
  HIGHEST_FLOOR,
  LOWEST_FLOOR,
  STACK_LETTERS,
  stackSpec,
  unitCode,
  type StackLetter,
} from '../../shared/units';
import type { CellStatus, TowerResponse } from '../../shared/types';

export interface CellState {
  code: string;
  floor: number;
  stack: StackLetter;
  bearing: number;
  facing: string;
  status: CellStatus;
  syncing: boolean;
  outsideFilters: boolean;
  heldByYou: boolean;
}

export interface TowerViewOptions {
  /** The unit the lens must describe now, or null when the pointer leaves the cells. */
  onLensUnit: (code: string | null) => void;
  onPin: (code: string) => void;
  onGridFallback: (reason: 'models' | 'context') => void;
  insetLens: boolean;
}

const TURN_MS = 350;

/** The finder's tower is drawn in the two field colours against the white stage. */
const TOWER_LIGHT: [number, number, number] = [0.129, 0.157, 0.588];
const TOWER_SHADE: [number, number, number] = [0.043, 0.039, 0.165];

export class TowerView {
  readonly region: HTMLElement;
  readonly lens: Lens;
  private readonly field: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly grid: HTMLElement;
  private readonly turnButtons: HTMLElement;
  private readonly cells = new Map<string, HTMLElement>();
  private states = new Map<string, CellState>();
  private scene: TowerScene | null = null;
  private mode: '3d' | 'grid' = 'grid';
  private focused = '20C';
  private pinned: string | null = null;
  private hovered: string | null = null;
  private turnFrame = 0;
  private dragged = false;
  private readonly loadingBlock: HTMLElement;
  private readonly lensBox: HTMLElement;

  constructor(private readonly options: TowerViewOptions) {
    this.canvas = el('canvas', { class: 'tower-canvas', 'aria-hidden': 'true' }) as HTMLCanvasElement;
    this.grid = el('div', { class: 'tower-grid', role: 'grid', 'aria-label': 'Tower' });
    this.lens = new Lens(options.insetLens);
    this.loadingBlock = el('div', { class: 'tower-loading', 'aria-hidden': 'true' });
    this.field = el('div', { class: 'tower-field' }, [this.canvas, this.loadingBlock, this.grid]);
    this.turnButtons = el('div', { class: 'tower-turns' }, [
      el('button', { type: 'button', class: 'turn', 'aria-label': 'Turn left', onclick: () => this.turn(-1) }, [
        icon('chevron-left'),
      ]),
      el('button', { type: 'button', class: 'turn', 'aria-label': 'Turn right', onclick: () => this.turn(1) }, [
        icon('chevron-right'),
      ]),
    ]);
    this.lensBox = el('div', { class: 'lens-box' });
    this.region = el('section', { class: 'tower-stage', role: 'region', 'aria-label': 'Tower' }, [
      this.field,
      this.turnButtons,
      this.lensBox,
      this.lens.figure,
    ]);
    this.setInsetLens(options.insetLens);
    this.buildGrid();
    this.bindPointer();
    window.addEventListener('resize', () => this.layout());
  }

  /** The phone keeps the lens in a reserved box so it never covers a cell. */
  setInsetLens(inset: boolean): void {
    this.lens.setInset(inset);
    this.lensBox.hidden = !inset;
    if (inset) this.lensBox.append(this.lens.figure);
    else this.region.append(this.lens.figure);
  }

  /** Starts the 3D stage, falling back to the floor grid when it cannot run. */
  start(assets: TowerResponse['assets'] | null): void {
    const scene = TowerScene.create(this.canvas, () => this.dropToGrid('context'));
    if (!scene || !assets) {
      this.applyGridMode();
      return;
    }
    this.scene = scene;
    scene.setColours(TOWER_LIGHT, TOWER_SHADE);
    this.mode = '3d';
    this.region.classList.remove('tower-grid-mode');
    this.layout();
    scene
      .loadShell(assets.shell)
      .then(() => {
        this.loadingBlock.hidden = true;
        this.layout();
      })
      .catch(() => this.dropToGrid('models'));
  }

  dropToGrid(reason: 'models' | 'context'): void {
    if (this.mode === 'grid') return;
    this.applyGridMode();
    this.options.onGridFallback(reason);
  }

  /** The flat floor grid: the same cells, lens, chip and keyboard steps. */
  private applyGridMode(): void {
    this.mode = 'grid';
    this.loadingBlock.hidden = true;
    this.scene?.dispose();
    this.scene = null;
    this.canvas.hidden = true;
    this.region.classList.add('tower-grid-mode');
    this.turnButtons.hidden = true;
    for (const cell of this.cells.values()) cell.removeAttribute('style');
  }

  private buildGrid(): void {
    for (let floor = HIGHEST_FLOOR; floor >= LOWEST_FLOOR; floor -= 1) {
      const row = el('div', { class: 'tower-row', role: 'row', 'aria-label': `Floor ${floor}` });
      for (const stack of STACK_LETTERS) {
        const code = unitCode(floor, stack);
        const cell = el('div', {
          class: 'tower-cell',
          role: 'gridcell',
          tabindex: '-1',
          'data-code': code,
          'aria-disabled': 'true',
        });
        cell.addEventListener('pointerenter', (event) => {
          if ((event as PointerEvent).pointerType === 'touch') return;
          this.setHovered(code);
        });
        cell.addEventListener('click', () => {
          if (this.dragged) return;
          this.activate(code);
        });
        cell.addEventListener('focus', () => {
          this.focused = code;
          this.setRovingTabStop();
          this.setHovered(code);
        });
        this.cells.set(code, cell);
        row.append(cell);
      }
      this.grid.append(row);
    }
    this.grid.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.grid.addEventListener('pointerleave', () => {
      if (this.options.insetLens) return;
      this.hovered = null;
      this.lens.hide();
      this.options.onLensUnit(null);
    });
    this.setRovingTabStop();
  }

  /** Dragging orbits the tower; a press that barely moves is a click on the cell. */
  private bindPointer(): void {
    let pressed = false;
    let dragged = false;
    let startX = 0;
    let startBearing = 0;
    this.field.addEventListener('pointerdown', (event) => {
      if (!this.scene) return;
      pressed = true;
      dragged = false;
      startX = event.clientX;
      startBearing = this.scene.getBearing();
    });
    const onMove = (event: PointerEvent): void => {
      if (pressed && this.scene) {
        const delta = event.clientX - startX;
        if (Math.abs(delta) > 4) dragged = true;
        if (dragged) {
          this.scene.setBearing(startBearing - delta * 0.4);
          this.layoutCells();
          return;
        }
      }
      if (!this.options.insetLens) this.lens.moveTo(event.clientX, event.clientY);
    };
    const onUp = (): void => {
      if (!pressed) return;
      pressed = false;
      if (dragged) this.settleToNearestFace();
      this.dragged = dragged;
      window.setTimeout(() => {
        this.dragged = false;
      }, 0);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }

  private settleToNearestFace(): void {
    if (!this.scene) return;
    const current = this.scene.getBearing();
    const nearest = STACK_LETTERS.map((stack) => stackSpec(stack).windowBearing).reduce((best, bearing) => {
      const distance = Math.abs(((bearing - current + 540) % 360) - 180);
      const bestDistance = Math.abs(((best - current + 540) % 360) - 180);
      return distance < bestDistance ? bearing : best;
    }, stackSpec('C').windowBearing);
    this.animateBearing(nearest);
  }

  private turn(direction: number): void {
    if (!this.scene) return;
    const bearings = STACK_LETTERS.map((stack) => stackSpec(stack).windowBearing).sort((a, b) => a - b);
    const current = this.scene.getBearing();
    let index = 0;
    let bestDistance = 361;
    bearings.forEach((bearing, position) => {
      const distance = Math.abs(((bearing - current + 540) % 360) - 180);
      if (distance < bestDistance) {
        bestDistance = distance;
        index = position;
      }
    });
    const next = bearings[(index + direction + bearings.length) % bearings.length];
    this.animateBearing(next);
  }

  private animateBearing(target: number): void {
    if (!this.scene) return;
    window.cancelAnimationFrame(this.turnFrame);
    const scene = this.scene;
    const from = scene.getBearing();
    const delta = ((target - from + 540) % 360) - 180;
    if (prefersReducedMotion()) {
      scene.setBearing(target);
      this.layoutCells();
      return;
    }
    const started = performance.now();
    const step = (): void => {
      const progress = Math.min(1, (performance.now() - started) / TURN_MS);
      const eased = 1 - (1 - progress) ** 3;
      scene.setBearing(from + delta * eased);
      this.layoutCells();
      if (progress < 1) this.turnFrame = window.requestAnimationFrame(step);
    };
    this.turnFrame = window.requestAnimationFrame(step);
  }

  /** Turns the tower so the stack's face is towards the viewer. */
  private faceStack(stack: StackLetter): void {
    this.animateBearing(stackSpec(stack).windowBearing);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const current = this.states.get(this.focused);
    if (!current) return;
    const stackIndex = STACK_LETTERS.indexOf(current.stack);
    let nextCode: string | null = null;
    switch (event.key) {
      case 'ArrowUp':
        nextCode = unitCode(Math.min(HIGHEST_FLOOR, current.floor + 1), current.stack);
        break;
      case 'ArrowDown':
        nextCode = unitCode(Math.max(LOWEST_FLOOR, current.floor - 1), current.stack);
        break;
      case 'ArrowLeft':
        nextCode = unitCode(current.floor, STACK_LETTERS[(stackIndex + STACK_LETTERS.length - 1) % STACK_LETTERS.length]);
        break;
      case 'ArrowRight':
        nextCode = unitCode(current.floor, STACK_LETTERS[(stackIndex + 1) % STACK_LETTERS.length]);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activate(this.focused);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!nextCode) return;
    const next = this.states.get(nextCode);
    if (next && this.mode === '3d' && next.stack !== current.stack) this.faceStack(next.stack);
    this.focusCell(nextCode, true);
  }

  focusCell(code: string, moveFocus: boolean): void {
    const cell = this.cells.get(code);
    if (!cell) return;
    this.focused = code;
    this.setRovingTabStop();
    if (moveFocus) cell.focus();
    this.setHovered(code);
  }

  focusedCode(): string {
    return this.focused;
  }

  cellNode(code: string): HTMLElement | undefined {
    return this.cells.get(code);
  }

  private setRovingTabStop(): void {
    for (const [code, cell] of this.cells) cell.tabIndex = code === this.focused ? 0 : -1;
  }

  private activate(code: string): void {
    const state = this.states.get(code);
    if (!state || !isPinnable(state)) return;
    if (this.options.insetLens && this.hovered !== code) {
      this.setHovered(code);
      return;
    }
    this.options.onPin(code);
  }

  private setHovered(code: string): void {
    if (this.hovered === code) return;
    this.hovered = code;
    this.paintFrames();
    this.options.onLensUnit(code);
  }

  hoveredCode(): string | null {
    return this.hovered;
  }

  /** The lens subject for the unit now under the pointer or focus. */
  showLens(subject: LensSubject): void {
    this.lens.show(subject);
  }

  setPinned(code: string | null): void {
    this.pinned = code;
    for (const [cellCode, cell] of this.cells) {
      cell.setAttribute('aria-selected', String(cellCode === code));
    }
  }

  setCells(states: CellState[]): void {
    this.states = new Map(states.map((state) => [state.code, state]));
    for (const state of states) {
      const cell = this.cells.get(state.code);
      if (!cell) continue;
      const status = displayStatus(state);
      setAttributes(cell, {
        'aria-label': chipText({
          code: state.code,
          bearing: state.bearing,
          facing: state.facing as never,
          status,
          syncing: state.syncing,
          outsideFilters: state.outsideFilters && state.status !== 'withdrawn' && state.status !== 'unreleased',
        }),
        'aria-disabled': String(!isPinnable(state)),
        'aria-selected': String(this.pinned === state.code),
      });
      cell.className = [
        'tower-cell',
        `cell-${state.status}`,
        state.heldByYou ? 'cell-mine' : '',
        state.outsideFilters ? 'cell-dimmed' : '',
        state.syncing ? 'cell-syncing' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
    this.paintFrames();
    this.layoutCells();
  }

  private paintFrames(): void {
    for (const [code, cell] of this.cells) cell.classList.toggle('cell-hovered', code === this.hovered);
  }

  layout(): void {
    if (this.mode === '3d') this.scene?.resize();
    this.layoutCells();
  }

  private layoutCells(): void {
    if (this.mode !== '3d' || !this.scene) return;
    for (const [code, cell] of this.cells) {
      const state = this.states.get(code);
      const bearing = state ? state.bearing : 0;
      const floor = state ? state.floor : LOWEST_FLOOR;
      const projected = this.scene.projectCell(bearing, floor);
      cell.style.left = `${projected.x}px`;
      cell.style.top = `${projected.y}px`;
      cell.style.width = `${Math.max(2, projected.width)}px`;
      cell.style.height = `${Math.max(2, projected.height)}px`;
      cell.classList.toggle('cell-away', !projected.visible);
    }
  }

  /** The lens circle's current screen box, used when it grows into the detail. */
  lensRect(): { x: number; y: number; size: number } {
    const rect = this.lens.figure.querySelector('.lens-circle')?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0, size: LENS_DIAMETER };
    return { x: rect.left, y: rect.top, size: rect.width };
  }
}

export function displayStatus(state: CellState): DisplayStatus {
  if (state.heldByYou && state.status === 'held') return 'held-by-you';
  return state.status;
}

export function isPinnable(state: CellState): boolean {
  if (state.status === 'withdrawn' || state.status === 'unreleased') return false;
  return !state.outsideFilters;
}
