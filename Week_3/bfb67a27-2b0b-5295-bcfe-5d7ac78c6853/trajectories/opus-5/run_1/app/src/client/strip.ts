import { addDays, weekdayName } from '../shared/dates.js';
import { clear, currentLayout, el, prefersReducedMotion } from './dom.js';
import type { DayKind, PriceDay } from '../shared/types.js';

const FOLD_MS = 220;
const MAX_DAY = 14;

interface RenderedCell {
  kind: DayKind | 'weekend-single';
  label: string;
  span: number;
}

/** Groups the priced days into the cells the strip draws, folding free runs. */
export function renderedCells(days: PriceDay[]): RenderedCell[] {
  if (days.length > 0 && days[0]?.kind === 'weekend') {
    return [{ kind: 'weekend-single', label: 'weekend · 1 day', span: days.length }];
  }
  const cells: RenderedCell[] = [];
  for (const day of days) {
    if (day.kind === 'billable') {
      cells.push({ kind: 'billable', label: `${day.day} ${weekdayName(day.date)}`, span: 1 });
      continue;
    }
    const previous = cells[cells.length - 1];
    if (previous !== undefined && previous.kind === 'free') {
      previous.span += 1;
      continue;
    }
    cells.push({ kind: 'free', label: 'free', span: 1 });
  }
  return cells;
}

export interface DayStrip {
  element: HTMLElement;
  slider: HTMLElement;
  setDays: (days: PriceDay[]) => void;
  value: () => number;
  setValue: (day: number) => void;
}

export interface DayStripOptions {
  pickupDate: () => string;
  onChange: (returnDay: number) => void;
}

/**
 * The ruled day strip and its return handle. The handle is a slider over the
 * strip's own track: each day cell is a step, and dragging counts one day per
 * cell width crossed, carrying on into week two on the phone layout.
 */
export function createDayStrip(options: DayStripOptions): DayStrip {
  let returnDay = 1;
  let bandSpans = new Map<number, number>();

  const list = el('ul', { class: 'strip-list', 'aria-label': 'Hire days' });
  const slider = el('div', {
    role: 'slider',
    tabindex: '0',
    'aria-label': 'Return day',
    'aria-valuemin': '1',
    'aria-valuemax': String(MAX_DAY),
    'aria-valuenow': '1',
    class: 'strip-handle',
  });
  const caption = el('p', { class: 'strip-caption' });
  const rail = el('div', { class: 'strip-rail' }, [list]);
  const element = el('div', { class: 'strip' }, [rail, slider, caption]);

  const cellsPerRow = (): number => (currentLayout() === 'phone' ? 7 : MAX_DAY);

  const sizeCells = (): void => {
    const width = rail.clientWidth;
    if (width === 0) return;
    const cell = Math.max(44, Math.floor(width / cellsPerRow()));
    element.style.setProperty('--cell', `${cell}px`);
  };

  const setValue = (next: number, announce: boolean): void => {
    const clamped = Math.min(MAX_DAY, Math.max(1, next));
    if (clamped === returnDay) return;
    returnDay = clamped;
    slider.setAttribute('aria-valuenow', String(returnDay));
    updateValueText();
    if (announce) options.onChange(returnDay);
  };

  const updateValueText = (): void => {
    const returnDate = addDays(options.pickupDate(), returnDay);
    slider.setAttribute('aria-valuetext', `Day ${returnDay}, return ${returnDate}`);
    slider.style.setProperty('--handle-fraction', String((returnDay - 1) / (MAX_DAY - 1)));
    caption.textContent = `Return day ${returnDay} · ${returnDate}`;
  };

  slider.addEventListener('keydown', (event) => {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowUp: 1,
      ArrowLeft: -1,
      ArrowDown: -1,
      PageUp: 7,
      PageDown: -7,
    };
    if (event.key === 'Home') {
      event.preventDefault();
      setValue(1, true);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setValue(MAX_DAY, true);
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    setValue(returnDay + step, true);
  });

  let dragStartX: number | null = null;
  let dragStartDay = 1;

  const beginDrag = (event: PointerEvent): void => {
    dragStartX = event.clientX;
    dragStartDay = returnDay;
    slider.setPointerCapture(event.pointerId);
  };

  slider.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    slider.focus();
    beginDrag(event);
  });

  rail.addEventListener('pointerdown', (event) => {
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-day]');
    slider.focus();
    if (cell !== null) {
      const day = Number(cell.dataset.day);
      if (Number.isInteger(day)) setValue(day, true);
    }
    dragStartX = event.clientX;
    dragStartDay = returnDay;
  });

  const onMove = (event: PointerEvent): void => {
    if (dragStartX === null) return;
    const cell = Number.parseFloat(
      getComputedStyle(element).getPropertyValue('--cell').replace('px', ''),
    );
    if (!Number.isFinite(cell) || cell <= 0) return;
    const steps = Math.round((event.clientX - dragStartX) / cell);
    setValue(dragStartDay + steps, true);
  };

  const endDrag = (): void => {
    dragStartX = null;
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => {
    sizeCells();
  });

  const setDays = (days: PriceDay[]): void => {
    sizeCells();
    const cells = renderedCells(days);
    const nextSpans = new Map<number, number>();
    clear(list);
    let dayCursor = 1;
    cells.forEach((cell, index) => {
      const item = el('li', {
        class: `strip-cell strip-${cell.kind === 'weekend-single' ? 'weekend' : cell.kind}`,
        'data-day': String(dayCursor + cell.span - 1),
        'data-span': String(cell.span),
      });
      item.append(el('span', { class: 'strip-label' }, [cell.label]));
      if (cell.kind === 'free') {
        nextSpans.set(index, cell.span);
        foldBand(item, cell.span, bandSpans.get(index));
      }
      list.append(item);
      dayCursor += cell.span;
    });
    bandSpans = nextSpans;
    for (let day = days.length + 1; day <= MAX_DAY; day += 1) {
      list.append(
        el('li', {
          role: 'presentation',
          class: 'strip-cell strip-empty',
          'data-day': String(day),
        }),
      );
    }
    updateValueText();
  };

  setDays([]);
  requestAnimationFrame(() => {
    sizeCells();
  });

  return {
    element,
    slider,
    setDays,
    value: () => returnDay,
    setValue: (day: number) => {
      returnDay = Math.min(MAX_DAY, Math.max(1, day));
      slider.setAttribute('aria-valuenow', String(returnDay));
      updateValueText();
    },
  };
}

/**
 * A free run folds from its unfolded width down to one billable cell's width,
 * starting fast and settling gently. With reduced motion it is folded at once.
 */
function foldBand(item: HTMLElement, span: number, previousSpan: number | undefined): void {
  if (prefersReducedMotion()) {
    item.style.width = 'var(--cell)';
    return;
  }
  const from = Math.max(span, previousSpan ?? span);
  item.style.width = `calc(var(--cell) * ${from})`;
  requestAnimationFrame(() => {
    item.style.transition = `width ${FOLD_MS}ms cubic-bezier(0.16, 0.84, 0.28, 1)`;
    item.style.width = 'var(--cell)';
  });
}

const ROLL_MS = 360;

/**
 * Rolls the price numerals from the old figure to the server's new one, then
 * settles the billable-day count and announces the total.
 */
export function rollTotal(
  node: HTMLElement,
  from: number,
  to: number,
  format: (cents: number) => string,
  settle: () => void,
): void {
  if (prefersReducedMotion() || from === to) {
    node.textContent = format(to);
    settle();
    return;
  }
  const start = performance.now();
  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / ROLL_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = format(Math.round(from + (to - from) * eased));
    if (progress < 1) {
      requestAnimationFrame(step);
      return;
    }
    node.textContent = format(to);
    settle();
  };
  requestAnimationFrame(step);
}
