import { announce } from '../announce.js';
import { focus, h } from '../dom.js';
import { MONTHS_LONG, MONTHS_SHORT, WEEKDAYS_LONG, WEEKDAYS_SHORT } from '../../shared/format.js';
import { openDialog } from './dialog.js';
import { serverToday } from '../state.js';

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export function parseKey(key: string): DateParts {
  const [year, month, day] = key.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function toKey(parts: DateParts): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(
    parts.day,
  ).padStart(2, '0')}`;
}

function asUtc(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

function fromUtc(date: Date): DateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftDays(parts: DateParts, days: number): DateParts {
  return fromUtc(new Date(asUtc(parts).getTime() + days * 86_400_000));
}

function shiftMonths(parts: DateParts, months: number): DateParts {
  const total = (parts.year * 12 + parts.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return { year, month, day: Math.min(parts.day, daysInMonth(year, month)) };
}

/** `Date, Fri 13 Nov 2026` */
export function dateButtonName(key: string): string {
  const parts = parseKey(key);
  const weekday = WEEKDAYS_SHORT[asUtc(parts).getUTCDay()] as string;
  return `Date, ${weekday} ${parts.day} ${MONTHS_SHORT[parts.month - 1]} ${parts.year}`;
}

/** `Friday 13 November 2026` */
function cellName(parts: DateParts): string {
  const weekday = WEEKDAYS_LONG[asUtc(parts).getUTCDay()] as string;
  return `${weekday} ${parts.day} ${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
}

function monthName(parts: DateParts): string {
  return `${MONTHS_LONG[parts.month - 1]} ${parts.year}`;
}

export interface DateFieldHandle {
  button: HTMLButtonElement;
  value(): string;
  setValue(key: string): void;
}

export function dateField(
  initial: string,
  onPick: (key: string) => void,
  sheet = true,
): DateFieldHandle {
  let value = initial;
  const button = h('button', {
    type: 'button',
    class: 'field date-button',
    'aria-label': dateButtonName(value),
    text: dateButtonName(value),
  });

  button.addEventListener('click', () => {
    let cursor = parseKey(value);
    let grid: HTMLElement;

    const render = (handleClose: () => void) => {
      grid.textContent = '';
      grid.setAttribute('aria-label', monthName(cursor));
      const header = h('div', { role: 'row', class: 'grid-head' });
      for (const weekday of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
        header.appendChild(
          h('span', { role: 'columnheader', text: weekday, class: 'grid-weekday' }),
        );
      }
      grid.appendChild(header);

      const first = { year: cursor.year, month: cursor.month, day: 1 };
      const leading = (asUtc(first).getUTCDay() + 6) % 7;
      const total = daysInMonth(cursor.year, cursor.month);
      let row = h('div', { role: 'row', class: 'grid-row' });
      for (let i = 0; i < leading; i += 1) {
        row.appendChild(h('span', { role: 'gridcell', class: 'grid-blank' }));
      }
      for (let day = 1; day <= total; day += 1) {
        const parts = { year: cursor.year, month: cursor.month, day };
        const key = toKey(parts);
        const past = key < serverToday();
        const selected = key === value;
        const cell = h('span', {
          role: 'gridcell',
          class: `grid-cell${selected ? ' selected' : ''}${past ? ' past' : ''}`,
          'aria-label': cellName(parts),
          'aria-selected': selected ? 'true' : 'false',
          'aria-disabled': past ? 'true' : null,
          tabindex: key === toKey(cursor) ? '0' : '-1',
          text: String(day),
        });
        cell.addEventListener('click', () => pick(parts, handleClose));
        cell.addEventListener('keydown', (event) => onCellKey(event, parts, handleClose));
        row.appendChild(cell);
        if ((leading + day) % 7 === 0) {
          grid.appendChild(row);
          row = h('div', { role: 'row', class: 'grid-row' });
        }
      }
      if (row.childElementCount > 0) grid.appendChild(row);
    };

    const focusCursor = () => {
      const cell = grid.querySelector<HTMLElement>(
        `[aria-label="${cellName(cursor)}"]`,
      );
      focus(cell);
    };

    const moveTo = (next: DateParts, handleClose: () => void) => {
      const monthChanged = next.month !== cursor.month || next.year !== cursor.year;
      cursor = next;
      render(handleClose);
      focusCursor();
      if (monthChanged) announce(monthName(cursor));
    };

    const pick = (parts: DateParts, handleClose: () => void) => {
      if (toKey(parts) < serverToday()) {
        announce('Past dates cannot be chosen');
        return;
      }
      value = toKey(parts);
      button.setAttribute('aria-label', dateButtonName(value));
      button.textContent = dateButtonName(value);
      handleClose();
      onPick(value);
    };

    const onCellKey = (event: KeyboardEvent, parts: DateParts, handleClose: () => void) => {
      const keys: Record<string, () => DateParts> = {
        ArrowLeft: () => shiftDays(parts, -1),
        ArrowRight: () => shiftDays(parts, 1),
        ArrowUp: () => shiftDays(parts, -7),
        ArrowDown: () => shiftDays(parts, 7),
        PageUp: () => shiftMonths(parts, -1),
        PageDown: () => shiftMonths(parts, 1),
        Home: () => shiftDays(parts, -((asUtc(parts).getUTCDay() + 6) % 7)),
        End: () => shiftDays(parts, 6 - ((asUtc(parts).getUTCDay() + 6) % 7)),
      };
      const step = keys[event.key];
      if (step) {
        event.preventDefault();
        moveTo(step(), handleClose);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        pick(parts, handleClose);
      }
    };

    openDialog({
      name: 'Choose a date',
      opener: button,
      sheet,
      build: ({ close }) => {
        grid = h('div', { role: 'grid', class: 'date-grid' });
        const previous = h('button', {
          type: 'button',
          text: 'Previous month',
          'aria-label': 'Previous month',
          class: 'month-step',
          onclick: () => moveTo(shiftMonths(cursor, -1), close),
        });
        const next = h('button', {
          type: 'button',
          text: 'Next month',
          'aria-label': 'Next month',
          class: 'month-step',
          onclick: () => moveTo(shiftMonths(cursor, 1), close),
        });
        render(close);
        return [h('div', { class: 'month-bar' }, previous, next), grid];
      },
      initialFocus: (element) =>
        element.querySelector<HTMLElement>(`[aria-label="${cellName(cursor)}"]`),
    });
  });

  return {
    button,
    value: () => value,
    setValue(key: string) {
      value = key;
      button.setAttribute('aria-label', dateButtonName(value));
      button.textContent = dateButtonName(value);
    },
  };
}
