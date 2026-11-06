import type { CascadeEntry, ReblockedEntry } from '../shared/types.js';
import { getState, setBlockedFlags, setState, type FreedMark } from './store.js';

const DEPTH_STEP = 60;
const CHIP_MS = 240;
const LINE_FADE_MS = 160;

function rowElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-task-row="${id}"]`);
}

function gridElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-grid-body]');
}

function cueLine(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-cue-line]');
}

function offsetWithin(grid: HTMLElement, row: HTMLElement): number {
  return row.getBoundingClientRect().top - grid.getBoundingClientRect().top + grid.scrollTop;
}

function drawLine(fromId: string | null, toIds: string[]): void {
  const grid = gridElement();
  const line = cueLine();
  if (!grid || !line) return;
  const start = fromId === null ? null : rowElement(fromId);
  const startTop = start ? offsetWithin(grid, start) + start.offsetHeight / 2 : 0;
  let top = startTop;
  let bottom = startTop;
  for (const id of toIds) {
    const row = rowElement(id);
    if (!row) continue;
    const middle = offsetWithin(grid, row) + row.offsetHeight / 2;
    top = Math.min(top, middle);
    bottom = Math.max(bottom, middle);
  }
  line.style.opacity = '1';
  line.style.top = `${top}px`;
  line.style.height = `${Math.max(bottom - top, 2)}px`;
}

function hideLine(): void {
  const line = cueLine();
  if (!line) return;
  line.style.opacity = '0';
  window.setTimeout(() => {
    if (!getState().cascading) {
      line.style.height = '0px';
    }
  }, LINE_FADE_MS);
}

function markFreed(entries: CascadeEntry[]): void {
  setState((current) => {
    const freed = new Map<string, FreedMark>(current.freed);
    for (const entry of entries) {
      freed.set(entry.id, { order: entry.order, depth: entry.depth, by: entry.freed_by });
    }
    return { freed };
  });
  setBlockedFlags(
    entries.map((entry) => entry.id),
    false,
  );
}

function clearFreed(ids: string[]): void {
  setState((current) => {
    const freed = new Map(current.freed);
    for (const id of ids) freed.delete(id);
    return { freed };
  });
  setBlockedFlags(ids, true);
}

/** Rows a change took from not blocked to blocked, outside an undo's reverse cascade. */
export function reblockRows(entries: ReblockedEntry[]): void {
  if (entries.length === 0) return;
  clearFreed(entries.map((entry) => entry.id));
}

/** The cue-line cascade: freed rows are reached in depth order, 60ms per depth. */
export function playCascade(changedId: string | null, cascade: CascadeEntry[]): void {
  if (cascade.length === 0) return;
  const { reducedMotion, snapshot } = getState();
  const finalBlocked = snapshot?.blocked ?? 0;
  if (reducedMotion) {
    markFreed(cascade);
    setState({ blockedDisplay: null });
    return;
  }

  const depths = [...new Set(cascade.map((entry) => entry.depth))].sort((a, b) => a - b);
  setState({ cascading: true, blockedDisplay: finalBlocked + cascade.length });
  const reached: string[] = [];
  depths.forEach((depth, index) => {
    window.setTimeout(() => {
      const group = cascade.filter((entry) => entry.depth === depth);
      reached.push(...group.map((entry) => entry.id));
      markFreed(group);
      setState((current) => ({
        blockedDisplay: Math.max(finalBlocked, (current.blockedDisplay ?? finalBlocked) - group.length),
      }));
      drawLine(changedId, reached);
    }, index * DEPTH_STEP);
  });
  window.setTimeout(
    () => {
      setState({ cascading: false, blockedDisplay: null });
      hideLine();
    },
    (depths.length - 1) * DEPTH_STEP + CHIP_MS,
  );
}

/** Undo plays the cascade backwards, in the order of the reblocked list. */
export function playReverseCascade(restoredId: string | null, reblocked: ReblockedEntry[]): void {
  if (reblocked.length === 0) return;
  const { reducedMotion, snapshot } = getState();
  const finalBlocked = snapshot?.blocked ?? 0;
  if (reducedMotion) {
    clearFreed(reblocked.map((entry) => entry.id));
    setState({ blockedDisplay: null });
    return;
  }

  const ordered = [...reblocked].sort((a, b) => a.order - b.order);
  const step = Math.min(DEPTH_STEP, Math.floor(300 / ordered.length));
  setState({ cascading: true, blockedDisplay: finalBlocked - ordered.length });
  const remaining = ordered.map((entry) => entry.id).reverse();
  drawLine(restoredId, remaining);
  ordered.forEach((entry, index) => {
    window.setTimeout(() => {
      clearFreed([entry.id]);
      setState((current) => ({
        blockedDisplay: Math.min(finalBlocked, (current.blockedDisplay ?? finalBlocked) + 1),
      }));
      drawLine(restoredId, remaining.slice(0, remaining.length - index));
    }, index * step);
  });
  window.setTimeout(
    () => {
      setState({ cascading: false, blockedDisplay: null });
      hideLine();
    },
    (ordered.length - 1) * step + CHIP_MS,
  );
}
