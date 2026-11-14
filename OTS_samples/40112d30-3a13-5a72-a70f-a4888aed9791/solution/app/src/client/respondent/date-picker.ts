import { h, svg } from '../lib/dom.ts';
import { dialogShell, openDialog } from '../lib/dialog.ts';
import {
  DAYS_PER_WEEK, WEEKDAY_NAMES, addDays, addMonths, compareDays, dayTitle, daysInMonth, monthTitle, weekdayIndex, type Day,
} from './dates.ts';

interface PickerRequest {
  opener: HTMLElement;
  /** The day that takes focus when the calendar opens. */
  start: Day;
  selected: Day | null;
  min: Day | null;
  max: Day | null;
  onPick(day: Day): void;
}

const MONTHS_PER_YEAR = 12;

const chevron = (left: boolean): SVGSVGElement =>
  svg('svg', { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', class: 'icon' },
    svg('path', { d: left ? 'M10.5 3 5.5 8l5 5' : 'M5.5 3l5 5-5 5', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));

/** The `Choose a date` dialog: a centred dialog from 768 pixels, a full-width sheet at 767 or less (the stylesheet decides). */
export function openDatePicker(request: PickerRequest): void {
  let focused = request.start;
  const outside = (day: Day): boolean =>
    (request.min !== null && compareDays(day, request.min) < 0) || (request.max !== null && compareDays(day, request.max) > 0);

  const month = h('p', { class: 'calendar-month' });
  const grid = h('div', { role: 'grid', class: 'calendar-grid' });
  const step = (count: number): void => {
    focused = addMonths(focused, count);
    draw();
  };
  const header = h('div', { class: 'calendar-header' },
    h('button', { type: 'button', class: 'calendar-step', 'aria-label': 'Previous month', onclick: () => step(-1) }, chevron(true)),
    month,
    h('button', { type: 'button', class: 'calendar-step', 'aria-label': 'Next month', onclick: () => step(1) }, chevron(false)));

  function cell(day: Day): HTMLElement {
    const props = {
      role: 'gridcell',
      class: 'calendar-day',
      'aria-label': dayTitle(day),
      'aria-disabled': outside(day) ? 'true' : null,
      'aria-selected': request.selected && compareDays(day, request.selected) === 0 ? 'true' : null,
      tabindex: compareDays(day, focused) === 0 ? '0' : '-1',
    };
    return h('div', { ...props, onclick: () => pick(day) }, String(day.day));
  }

  function draw(): void {
    month.textContent = monthTitle(focused);
    grid.setAttribute('aria-label', monthTitle(focused));
    const first = { ...focused, day: 1 };
    const blank = (): HTMLElement => h('div', { role: 'gridcell', class: 'calendar-blank', 'aria-hidden': 'true' });
    const days = [
      ...Array.from({ length: weekdayIndex(first) }, blank),
      ...Array.from({ length: daysInMonth(focused.year, focused.month) }, (_, index) => cell({ ...focused, day: index + 1 })),
    ];
    while (days.length % DAYS_PER_WEEK !== 0) days.push(blank());
    const weeks = Array.from({ length: days.length / DAYS_PER_WEEK }, (_, week) =>
      h('div', { role: 'row', class: 'calendar-week' }, days.slice(week * DAYS_PER_WEEK, (week + 1) * DAYS_PER_WEEK)));
    grid.replaceChildren(
      h('div', { role: 'row', class: 'calendar-week' }, WEEKDAY_NAMES.map((name) => h('span', { role: 'columnheader', class: 'calendar-weekday' }, name))),
      ...weeks);
  }

  function destination(event: KeyboardEvent): Day | null {
    const year = event.shiftKey ? MONTHS_PER_YEAR : 1;
    switch (event.key) {
      case 'ArrowLeft': return addDays(focused, -1);
      case 'ArrowRight': return addDays(focused, 1);
      case 'ArrowUp': return addDays(focused, -DAYS_PER_WEEK);
      case 'ArrowDown': return addDays(focused, DAYS_PER_WEEK);
      case 'Home': return addDays(focused, -weekdayIndex(focused));
      case 'End': return addDays(focused, DAYS_PER_WEEK - 1 - weekdayIndex(focused));
      case 'PageUp': return addMonths(focused, -year);
      case 'PageDown': return addMonths(focused, year);
      default: return null;
    }
  }

  function pick(day: Day): void {
    if (outside(day)) return;
    opened.close();
    request.onPick(day);
  }

  grid.addEventListener('keydown', (event) => {
    const next = destination(event);
    if (next) {
      event.preventDefault();
      focused = next;
      draw();
      focusedCell().focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(focused);
    }
  });
  const focusedCell = (): HTMLElement => grid.querySelector<HTMLElement>('[tabindex="0"]') ?? grid;

  const dialog = dialogShell('Choose a date', header, grid, h('div', { class: 'dialog-actions' }, h('button', { type: 'button', onclick: () => opened.close() }, 'Close')));
  dialog.classList.add('date-dialog');
  draw();
  const opened = openDialog(dialog, request.opener, { first: focusedCell() });
}
