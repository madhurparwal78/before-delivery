import { el, prefersReducedMotion, setAttr, setText, tween, type CancelTween } from '../dom';
import * as copy from '../copy';
import {
  BLOCK_VIEW_HEIGHT,
  MAX_EXTRUSION,
  COLUMN_STEP,
  ROW_STEP,
  TILE_DEPTH,
  TILE_WIDTH,
  createBlock,
  createCoolerOutline,
  createSlab,
  drawBlock,
  extrusionPixels,
  planPosition,
  roundExtrusion,
  type BlockNodes,
  type PlanPosition,
} from './iso';
import type { Station } from '../../shared/types';

export type StationState = 'free' | 'partial' | 'full' | 'taken';

interface StationNode {
  station: Station;
  position: PlanPosition;
  button: HTMLButtonElement;
  block: BlockNodes;
  drawnExtrusion: number;
  drawnFree: number;
  cancelHeight: CancelTween | null;
  cancelNumber: CancelTween | null;
  justTakenTimer: number | null;
  label: string;
}

export interface PlanHandlers {
  onStationActivate(stationId: string): void;
}

export interface Plan {
  node: HTMLElement;
  stationOrder(): ReadonlyArray<Station>;
  draw(stations: ReadonlyArray<Station>, spanMinutes: number): void;
  setDropTarget(stationId: string | null): void;
  dropTarget(): string | null;
  markJustTaken(stationIds: ReadonlyArray<string>): void;
  dropSlab(stationIds: ReadonlyArray<string>, label: string): void;
  liftSlabsOff(): void;
  slideSlabsBack(): void;
  removeSlabs(): void;
  buttonFor(stationId: string): HTMLButtonElement | null;
  labelFor(stationId: string): string;
  stationAt(point: { x: number; y: number }): string | null;
}

const JUST_TAKEN_MS = 5000;

export function createPlan(handlers: PlanHandlers): Plan {
  const node = el('div', {
    className: 'floor-plan',
    attrs: { role: 'region', 'aria-label': 'Floor plan' },
  });
  const scaler = el('div', { className: 'plan-scaler' });
  const surface = el('div', { className: 'plan-surface' });
  scaler.append(surface);
  node.append(scaler);

  const nodes = new Map<string, StationNode>();
  let order: ReadonlyArray<Station> = [];
  let dropTargetId: string | null = null;
  const slabs: HTMLElement[] = [];

  const layout = (stations: ReadonlyArray<Station>): void => {
    const diffs = stations.map((station) => station.col - station.row);
    const minDiff = Math.min(...diffs, 0);
    const maxDiff = Math.max(...diffs, 0);
    const maxSum = Math.max(...stations.map((station) => station.col + station.row), 0);
    const width = (maxDiff - minDiff) * (COLUMN_STEP / 2) + COLUMN_STEP;
    const height = maxSum * (ROW_STEP / 2) + BLOCK_VIEW_HEIGHT;
    surface.style.setProperty('width', `${width}px`);
    surface.style.setProperty('height', `${height}px`);

    const shelves = stations.filter((station) => station.kind === 'cooler_shelf');
    if (shelves.length > 0) {
      const positions = shelves.map((station) => planPosition(station.col, station.row, minDiff));
      const left = Math.min(...positions.map((position) => position.left)) - 16;
      const top = Math.min(...positions.map((position) => position.top)) - 16;
      const right = Math.max(...positions.map((position) => position.left)) + TILE_WIDTH + 24;
      const bottom = Math.max(...positions.map((position) => position.top)) + BLOCK_VIEW_HEIGHT + 16;
      let outline = surface.querySelector('.cooler-outline-holder');
      if (outline === null) {
        outline = el('div', { className: 'cooler-outline-holder' });
        surface.prepend(outline);
      }
      if (outline instanceof HTMLElement) {
        outline.textContent = '';
        outline.style.setProperty('left', `${left}px`);
        outline.style.setProperty('top', `${top}px`);
        outline.append(
          createCoolerOutline(positions, right - left, bottom - top, { left, top }),
        );
      }
    }

    for (const station of stations) {
      const position = planPosition(station.col, station.row, minDiff);
      let entry = nodes.get(station.id);
      if (entry === undefined) {
        const button = el('button', {
          className: 'station-button',
          attrs: { type: 'button', 'data-station-id': station.id },
        });
        const block = createBlock(station.id);
        button.append(block.root);
        surface.append(button);
        button.addEventListener('click', () => handlers.onStationActivate(station.id));
        entry = {
          station,
          position,
          button,
          block,
          drawnExtrusion: 0,
          drawnFree: 0,
          cancelHeight: null,
          cancelNumber: null,
          justTakenTimer: null,
          label: '',
        };
        nodes.set(station.id, entry);
      }
      entry.station = station;
      entry.position = position;
      entry.button.style.setProperty('left', `${position.left}px`);
      entry.button.style.setProperty('z-index', String(10 + station.col + station.row));
      placeButton(entry);
    }
  };

  /** The hit area hugs the drawn block, so neighbouring blocks never swallow a tap. */
  const placeButton = (entry: StationNode): void => {
    const height = Math.max(0, Math.min(MAX_EXTRUSION, entry.drawnExtrusion));
    entry.button.style.setProperty('top', `${entry.position.top + (MAX_EXTRUSION - height)}px`);
    entry.button.style.setProperty('height', `${height + TILE_DEPTH + 4}px`);
    entry.button.style.setProperty('width', `${TILE_WIDTH}px`);
  };

  const fit = (): void => {
    const available = node.clientWidth;
    const width = surface.offsetWidth;
    const height = surface.offsetHeight;
    if (available === 0 || width === 0 || height === 0) return;
    const room = Math.max(240, window.innerHeight - node.getBoundingClientRect().top - 190);
    const scale = Math.min(Math.max(Math.min(available / width, room / height), 0.1), 1.9);
    scaler.style.setProperty('transform', `scale(${scale})`);
    scaler.style.setProperty('height', `${surface.offsetHeight * scale}px`);
  };
  window.addEventListener('resize', fit);

  const paint = (entry: StationNode, spanMinutes: number): void => {
    const station = entry.station;
    const occupied = station.occupiedMinutes ?? 0;
    const free = station.freeMinutes ?? Math.max(0, spanMinutes - occupied);
    const buffer = station.bufferMinutes ?? 0;
    const target = extrusionPixels(occupied, spanMinutes);
    const full = spanMinutes > 0 && free <= 0;
    const state: StationState = full ? 'full' : occupied === 0 ? 'free' : 'partial';
    const label = spanMinutes <= 0 ? '' : copy.stationLabel(free, spanMinutes);

    setAttr(entry.button, 'data-extrusion', String(roundExtrusion(target)));
    if (entry.justTakenTimer === null) {
      setAttr(entry.button, 'data-state', state);
      entry.label = label;
      setAttr(entry.button, 'aria-label', `${station.name}, ${label}`);
    }

    entry.cancelHeight?.();
    const bufferShare = occupied === 0 ? 0 : buffer / occupied;
    entry.cancelHeight = tween(entry.drawnExtrusion, target, 330, (value) => {
      drawBlock(entry.block, {
        extrusion: value,
        bufferShare,
        full,
        name: station.name,
        label: entry.justTakenTimer === null ? label : copy.justTaken,
      });
    });
    entry.drawnExtrusion = target;
    placeButton(entry);

    entry.cancelNumber?.();
    const fromFree = entry.drawnFree;
    entry.cancelNumber = tween(fromFree, free, 250, (value) => {
      if (entry.justTakenTimer !== null) return;
      const shown = spanMinutes <= 0 ? '' : copy.stationLabel(Math.round(value), spanMinutes);
      entry.block.labelText.textContent = shown;
    });
    entry.drawnFree = free;
  };

  return {
    node,
    stationOrder: () => order,
    draw: (stations, spanMinutes) => {
      order = stations;
      layout(stations);
      for (const station of stations) {
        const entry = nodes.get(station.id);
        if (entry !== undefined) paint(entry, spanMinutes);
      }
      fit();
    },
    setDropTarget: (stationId) => {
      for (const [id, entry] of nodes) {
        if (id === stationId) {
          setAttr(entry.button, 'data-drop-target', 'true');
          entry.button.classList.add('drop-target');
        } else {
          entry.button.removeAttribute('data-drop-target');
          entry.button.classList.remove('drop-target');
        }
      }
      dropTargetId = stationId;
    },
    dropTarget: () => dropTargetId,
    markJustTaken: (stationIds) => {
      for (const stationId of stationIds) {
        const entry = nodes.get(stationId);
        if (entry === undefined) continue;
        if (entry.justTakenTimer !== null) window.clearTimeout(entry.justTakenTimer);
        setAttr(entry.button, 'data-state', 'taken');
        setAttr(entry.button, 'aria-label', `${entry.station.name}, ${copy.justTaken}`);
        setText(entry.block.labelText, copy.justTaken);
        entry.block.labelText.classList.add('taken');
        entry.justTakenTimer = window.setTimeout(() => {
          entry.justTakenTimer = null;
          entry.block.labelText.classList.remove('taken');
          setAttr(entry.button, 'aria-label', `${entry.station.name}, ${entry.label}`);
          setText(entry.block.labelText, entry.label);
          const occupied = entry.station.occupiedMinutes ?? 0;
          const free = entry.station.freeMinutes ?? 0;
          setAttr(
            entry.button,
            'data-state',
            free <= 0 ? 'full' : occupied === 0 ? 'free' : 'partial',
          );
        }, JUST_TAKEN_MS);
      }
    },
    dropSlab: (stationIds, label) => {
      for (const stationId of stationIds) {
        const entry = nodes.get(stationId);
        if (entry === undefined) continue;
        const holder = el('div', { className: 'dropped-slab' });
        holder.append(createSlab(label));
        holder.style.setProperty('left', `${entry.position.left}px`);
        holder.style.setProperty(
          'top',
          `${entry.position.top + MAX_EXTRUSION - Math.min(MAX_EXTRUSION, entry.drawnExtrusion) - 8}px`,
        );
        surface.append(holder);
        slabs.push(holder);
        if (!prefersReducedMotion()) {
          holder.animate(
            [{ transform: 'translateY(-120px)', opacity: '0.4' }, { transform: 'translateY(0)', opacity: '1' }],
            { duration: 330, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'none' },
          );
        }
      }
    },
    liftSlabsOff: () => {
      for (const holder of slabs) {
        if (prefersReducedMotion()) {
          holder.remove();
          continue;
        }
        const animation = holder.animate(
          [{ transform: 'translateY(0)', opacity: '1' }, { transform: 'translateY(-120px)', opacity: '0' }],
          { duration: 250, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'none' },
        );
        animation.addEventListener('finish', () => holder.remove(), { once: true });
      }
      slabs.length = 0;
    },
    slideSlabsBack: () => {
      for (const holder of slabs) {
        if (prefersReducedMotion()) {
          holder.remove();
          continue;
        }
        const animation = holder.animate([{ opacity: '1' }, { opacity: '0' }], {
          duration: 250,
          fill: 'none',
        });
        animation.addEventListener('finish', () => holder.remove(), { once: true });
      }
      slabs.length = 0;
    },
    removeSlabs: () => {
      for (const holder of slabs) holder.remove();
      slabs.length = 0;
    },
    buttonFor: (stationId) => nodes.get(stationId)?.button ?? null,
    labelFor: (stationId) => nodes.get(stationId)?.label ?? '',
    stationAt: (point) => {
      const element = document.elementFromPoint(point.x, point.y);
      const station = element?.closest('[data-station-id]');
      return station instanceof HTMLElement ? station.getAttribute('data-station-id') : null;
    },
  };
}
