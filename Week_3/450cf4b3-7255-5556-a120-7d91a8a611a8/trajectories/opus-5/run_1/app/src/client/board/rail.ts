import { el, setAttr, setText, svg } from '../dom';
import { icon } from '../icons';
import * as copy from '../copy';
import { hhmmOfMinutes, minutesOfHhmm } from '../../shared/format';
import type { CoolerFreeCell } from '../../shared/types';

const OPEN_MINUTES = minutesOfHhmm('05:00');
const CLOSE_MINUTES = minutesOfHhmm('23:00');
const STEP = 30;
const CELLS = 36;

export interface RailHandlers {
  onSpanChange(from: string, to: string): void;
}

export interface Rail {
  node: HTMLElement;
  startSlider: HTMLInputElement;
  endSlider: HTMLInputElement;
  setSpan(from: string, to: string): void;
  setCooler(cells: ReadonlyArray<CoolerFreeCell>, shelvesFree: number, shelfTotal: number): void;
}

export function createRail(handlers: RailHandlers): Rail {
  const node = el('div', {
    className: 'hour-rail',
    attrs: { role: 'group', 'aria-label': 'Hour rail' },
  });
  const track = el('div', { className: 'rail-track' });
  const shade = el('div', { className: 'rail-shade' });
  const ticks = el('div', { className: 'rail-ticks' });
  const numerals = el('div', { className: 'rail-numerals' });
  track.append(shade, ticks);

  for (let minutes = OPEN_MINUTES; minutes <= CLOSE_MINUTES; minutes += STEP) {
    const tick = el('span', { className: minutes % 60 === 0 ? 'rail-tick hour' : 'rail-tick half' });
    tick.style.setProperty('left', `${((minutes - OPEN_MINUTES) / (CLOSE_MINUTES - OPEN_MINUTES)) * 100}%`);
    ticks.append(tick);
  }
  for (let hour = 5; hour <= 23; hour += 1) {
    numerals.append(el('span', { className: 'rail-numeral mono', text: String(hour).padStart(2, '0') }));
  }

  const startSlider = el('input', {
    className: 'rail-slider',
    attrs: {
      type: 'range',
      min: String(OPEN_MINUTES),
      max: String(CLOSE_MINUTES),
      step: String(STEP),
      'aria-label': 'Span start',
    },
  });
  const endSlider = el('input', {
    className: 'rail-slider',
    attrs: {
      type: 'range',
      min: String(OPEN_MINUTES),
      max: String(CLOSE_MINUTES),
      step: String(STEP),
      'aria-label': 'Span end',
    },
  });

  const coolerStrip = el('div', { className: 'cooler-strip' });
  const cellNodes: HTMLElement[] = [];
  for (let index = 0; index < CELLS; index += 1) {
    const cell = el('div', { className: 'cooler-cell' });
    cell.append(svg('svg', { viewBox: '0 0 12 18', class: 'cooler-cell-shape', 'aria-hidden': 'true' }));
    coolerStrip.append(cell);
    cellNodes.push(cell);
  }
  const shelvesLine = el('p', { className: 'shelves-free-line' });
  const shelvesText = el('span', { className: 'shelves-free-text' });
  shelvesLine.append(icon('snowflake'), shelvesText);

  const sliders = el('div', { className: 'rail-sliders' });
  sliders.append(startSlider, endSlider);
  node.append(track, numerals, sliders, coolerStrip, shelvesLine);

  let fromMinutes = minutesOfHhmm('09:00');
  let toMinutes = minutesOfHhmm('12:00');

  const paint = (): void => {
    const span = CLOSE_MINUTES - OPEN_MINUTES;
    shade.style.setProperty('left', `${((fromMinutes - OPEN_MINUTES) / span) * 100}%`);
    shade.style.setProperty('width', `${((toMinutes - fromMinutes) / span) * 100}%`);
    startSlider.value = String(fromMinutes);
    endSlider.value = String(toMinutes);
    startSlider.setAttribute('aria-valuetext', hhmmOfMinutes(fromMinutes));
    endSlider.setAttribute('aria-valuetext', hhmmOfMinutes(toMinutes));
  };

  const commit = (nextFrom: number, nextTo: number): void => {
    const clampedFrom = Math.max(OPEN_MINUTES, Math.min(CLOSE_MINUTES - STEP, nextFrom));
    const clampedTo = Math.max(clampedFrom + STEP, Math.min(CLOSE_MINUTES, nextTo));
    if (clampedFrom === fromMinutes && clampedTo === toMinutes) {
      paint();
      return;
    }
    fromMinutes = clampedFrom;
    toMinutes = clampedTo;
    paint();
    handlers.onSpanChange(hhmmOfMinutes(fromMinutes), hhmmOfMinutes(toMinutes));
  };

  startSlider.addEventListener('input', () => {
    commit(Number(startSlider.value), toMinutes);
  });
  endSlider.addEventListener('input', () => {
    commit(fromMinutes, Number(endSlider.value));
  });

  const minutesAt = (clientX: number): number => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = OPEN_MINUTES + ratio * (CLOSE_MINUTES - OPEN_MINUTES);
    return Math.round(raw / STEP) * STEP;
  };

  let dragMode: 'new' | 'start' | 'end' | null = null;
  let anchorMinutes = 0;

  track.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    track.setPointerCapture(event.pointerId);
    const at = minutesAt(event.clientX);
    if (Math.abs(at - fromMinutes) <= STEP / 2 && at >= fromMinutes && at <= toMinutes) {
      dragMode = 'start';
    } else if (Math.abs(at - toMinutes) <= STEP / 2 && at >= fromMinutes && at <= toMinutes) {
      dragMode = 'end';
    } else {
      dragMode = 'new';
      anchorMinutes = at;
      commit(at, at + STEP);
    }
  });
  track.addEventListener('pointermove', (event) => {
    if (dragMode === null) return;
    event.preventDefault();
    const at = minutesAt(event.clientX);
    if (dragMode === 'new') {
      if (at <= anchorMinutes) commit(at, anchorMinutes);
      else commit(anchorMinutes, at);
    } else if (dragMode === 'start') {
      commit(at, toMinutes);
    } else {
      commit(fromMinutes, at);
    }
  });
  const endDrag = (): void => {
    dragMode = null;
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  track.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });

  paint();

  return {
    node,
    startSlider,
    endSlider,
    setSpan: (from: string, to: string) => {
      fromMinutes = minutesOfHhmm(from);
      toMinutes = minutesOfHhmm(to);
      paint();
    },
    setCooler: (cells, shelvesFree, shelfTotal) => {
      for (const [index, cell] of cellNodes.entries()) {
        const data = cells[index];
        const time = data?.time ?? hhmmOfMinutes(OPEN_MINUTES + index * STEP);
        const free = data?.freeShelves ?? 0;
        setAttr(cell, 'data-cooler-time', time);
        setAttr(cell, 'data-cooler-free', String(free));
        cell.classList.toggle('empty', free === 0);
        const shape = cell.querySelector('svg');
        if (shape !== null) {
          while (shape.firstChild !== null) shape.firstChild.remove();
          if (free === 0) {
            shape.append(svg('line', { x1: 0, y1: 18, x2: 12, y2: 0, class: 'cooler-hatch' }));
            shape.append(svg('line', { x1: 0, y1: 9, x2: 6, y2: 0, class: 'cooler-hatch' }));
          } else {
            for (let tick = 0; tick < free; tick += 1) {
              shape.append(
                svg('line', {
                  x1: 1,
                  x2: 11,
                  y1: 16 - tick * 5,
                  y2: 16 - tick * 5,
                  class: 'cooler-tick',
                }),
              );
            }
          }
        }
      }
      setText(shelvesText, copy.shelvesFreeLine(shelvesFree, shelfTotal));
    },
  };
}
