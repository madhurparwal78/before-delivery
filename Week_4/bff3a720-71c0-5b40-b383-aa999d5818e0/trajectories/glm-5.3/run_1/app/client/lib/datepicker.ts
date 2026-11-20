import { h, clear } from './els.js';
import { announce } from './announce.js';

/**
 * The date picker: a dialog with a month grid. Left/Right step a day, Up/Down
 * a week, Page Up/Down a month, Home/End the week. Days before the server's
 * today are disabled.
 */
export interface DatePickerOpts {
  selected: string;            // YYYY-MM-DD
  today: string;               // YYYY-MM-DD by server date
  labelForButton: (iso: string) => string;
  onPick: (iso: string) => void;
}

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FULL_WD = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const FULL_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monday-first weekday index for a calendar date. */
function weekdayOf(y: number, m: number, d: number): number {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const js = dt.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function datePickerButton(opts: DatePickerOpts): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'field date-button', 'aria-haspopup': 'dialog' }, opts.labelForButton(opts.selected)) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    openPicker(opts, btn);
  });
  return btn;
}

function openPicker(opts: DatePickerOpts, opener: HTMLButtonElement): void {
  let { y, m, d } = parts(opts.selected);
  const todayParts = parts(opts.today);
  const selected = opts.selected;

  const monthLabel = (): string => `${MONTHS[m - 1]} ${y}`;

  const grid = h('div', { role: 'grid', 'aria-label': monthLabel(), class: 'date-grid' });
  const dialog = h('div', {
    class: 'dialog sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a date',
    'data-motion': 'sheet', 'data-motion-ms': '0', 'data-state': 'open',
  },
    h('div', { class: 'dialog-body date-body' },
      h('div', { class: 'date-nav' },
        h('button', { type: 'button', class: 'ghost', onClick: () => { shiftMonth(-1); } }, 'Previous month'),
        h('span', { class: 'date-month', id: 'month-name' }, monthLabel()),
        h('button', { type: 'button', class: 'ghost', onClick: () => { shiftMonth(1); } }, 'Next month'),
      ),
      grid,
    ),
  );

  const overlay = h('div', { class: 'overlay' }, dialog);
  let closed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    overlay.remove();
    opener.focus();
  };

  overlay.addEventListener('mousedown', (e: Event) => { if (e.target === overlay) close(); });

  // A downward swipe of at least 80 pixels closes the sheet, the same as Escape.
  let swipeStartY: number | null = null;
  let swipeLastY = 0;
  dialog.addEventListener('touchstart', (e: TouchEvent) => {
    swipeStartY = e.touches[0].clientY;
    swipeLastY = swipeStartY;
  }, { passive: true });
  dialog.addEventListener('touchmove', (e: TouchEvent) => {
    if (swipeStartY === null) return;
    swipeLastY = e.touches[0].clientY;
  }, { passive: true });
  dialog.addEventListener('touchend', () => {
    if (swipeStartY === null) return;
    const dy = swipeLastY - swipeStartY;
    swipeStartY = null;
    if (dy >= 80) close();
  });

  const shiftMonth = (delta: number): void => {
    let ny = y;
    let nm = m + delta;
    if (nm < 1) { ny -= 1; nm = 12; }
    if (nm > 12) { ny += 1; nm = 1; }
    const maxD = daysInMonth(ny, nm);
    y = ny; m = nm; d = Math.min(d, maxD);
    render();
    announce(monthLabel());
  };

  const render = (): void => {
    clear(grid);
    grid.setAttribute('aria-label', monthLabel());
    const monthName = dialog.querySelector('#month-name');
    if (monthName) monthName.textContent = monthLabel();
    const firstWd = weekdayOf(y, m, 1);
    for (const wd of WD) grid.append(h('div', { role: 'columnheader', class: 'date-wd' }, wd));
    for (let i = 0; i < firstWd; i++) grid.append(h('div', { class: 'date-empty' }));
    const maxD = daysInMonth(y, m);
    for (let day = 1; day <= maxD; day++) {
      const iso = isoOf(y, m, day);
      const past = iso < opts.today;
      const isSelected = iso === selected;
      const cell = h('div', { role: 'gridcell', class: 'date-cell' },
        h('button', {
          type: 'button', class: 'date-day' + (isSelected ? ' selected' : '') + (past ? ' disabled' : ''),
          'aria-label': `${FULL_WD[weekdayOf(y, m, day)]} ${day} ${FULL_MON[m - 1]} ${y}`,
          'aria-disabled': past ? 'true' : 'false', tabindex: isSelected ? '0' : '-1',
          onclick: () => {
            if (past) { announce('Past dates cannot be chosen'); return; }
            close();
            opts.onPick(iso);
          },
        }, String(day)),
      );
      grid.append(cell);
    }
    const selCell = grid.querySelector<HTMLElement>('.date-day.selected') ?? grid.querySelector<HTMLElement>('.date-day:not(.disabled)');
    selCell?.focus();
  };

  dialog.addEventListener('keydown', (e: Event) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Escape') { ke.preventDefault(); close(); return; }
    if (ke.key === 'PageUp') { ke.preventDefault(); shiftMonth(-1); return; }
    if (ke.key === 'PageDown') { ke.preventDefault(); shiftMonth(1); return; }
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '];
    if (!handled.includes(ke.key)) return;
    ke.preventDefault();
    let nd = d;
    const wd = weekdayOf(y, m, nd);
    if (ke.key === 'ArrowLeft') nd = d - 1;
    else if (ke.key === 'ArrowRight') nd = d + 1;
    else if (ke.key === 'ArrowUp') nd = d - 7;
    else if (ke.key === 'ArrowDown') nd = d + 7;
    else if (ke.key === 'Home') nd = d - wd;
    else if (ke.key === 'End') nd = d + (6 - wd);
    else if (ke.key === 'Enter' || ke.key === ' ') {
      const iso = isoOf(y, m, d);
      if (iso < opts.today) { announce('Past dates cannot be chosen'); return; }
      close();
      opts.onPick(iso);
      return;
    }
    if (nd < 1) { shiftMonth(-1); return; }
    if (nd > daysInMonth(y, m)) { shiftMonth(1); return; }
    d = nd;
    render();
  });

  document.body.append(overlay);
  render();
  void todayParts;
}
