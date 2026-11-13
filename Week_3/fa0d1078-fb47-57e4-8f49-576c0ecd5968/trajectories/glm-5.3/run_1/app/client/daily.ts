import { el, announce } from './dom.js';
import { api, ApiError } from './api.js';
import type { DailyShape } from '../shared/api.js';
import { monthGrid, monthName, longDate, shiftDate } from '../shared/daily.js';
import * as M from '../shared/messages.js';

// The Daily page: the calendar tile with the month name and the previous and
// next month buttons above it, and the two streak lines beside it. The
// calendar is one Tab stop; arrow keys move by day and week; Enter or Space
// opens an open date's game.

export async function renderDaily(): Promise<HTMLElement> {
  let data: DailyShape;
  try {
    data = await api.get<DailyShape>('/api/daily');
  } catch {
    data = { today: '', month: '', days: [], current_streak: 0, best_streak: 0 };
  }

  const today = data.today;
  let shownMonth = today.slice(0, 7);

  const page = el('div', { class: 'calendar-layout' });
  const h1 = el('h1', {}, ['Daily challenge']);

  const streakPanel = el('div', { class: 'tile streak-panel' });
  const streakLine = el('div', { id: 'streak' }, [streakText(data.current_streak)]);
  const bestLine = el('div', { id: 'best-streak' }, [bestText(data.best_streak)]);
  streakPanel.append(streakLine, bestLine);

  const calendarWrap = el('div', { class: 'tile' });

  function stateOf(date: string): string {
    const day = data.days.find((d) => d.date === date);
    return day?.state ?? (date < '2026-01-01' ? 'closed' : date > today ? 'future' : date === today ? 'today' : 'missed');
  }

  function renderMonth(): void {
    const [year, month] = shownMonth.split('-').map(Number);
    const grid = monthGrid(year, month);
    const head = el('div', { class: 'calendar-head' }, [
      el('button', { class: 'button', type: 'button', id: 'prev-month', 'aria-label': 'Previous month' }, ['<']),
      el('h2', { id: 'month-name' }, [`${monthName(month)} ${year}`]),
      el('button', { class: 'button', type: 'button', id: 'next-month', 'aria-label': 'Next month' }, ['>']),
    ]);

    const calendar = el('div', { id: 'calendar', role: 'grid', 'aria-label': `${monthName(month)} ${year}` });

    const headerRow = el('div', { role: 'row' });
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
      headerRow.append(el('div', { role: 'columnheader' }, [day]));
    }
    calendar.append(headerRow);

    let tabTarget: string | null = null;

    const cells = new Map<string, HTMLElement>();
    for (const week of grid.weeks) {
      const row = el('div', { role: 'row' });
      for (const date of week) {
        if (date === null) {
          row.append(el('div', { role: 'gridcell' }));
          continue;
        }
        const state = stateOf(date);
        const stateWords = stateWordsFor(state);
        const cell = el('button', {
          role: 'gridcell',
          'data-date': date,
          'data-state': state,
          'aria-label': `${longDate(date)}, ${stateWords}`,
          'aria-disabled': state === 'future' || state === 'closed' ? 'true' : 'false',
          tabindex: '-1',
        }, [String(Number(date.slice(8)))]);
        cells.set(date, cell);
        row.append(cell);
      }
      calendar.append(row);
    }

    // The tab stop moves to day 1 of the shown month, or to today when the
    // shown month is today's.
    tabTarget = shownMonth === today.slice(0, 7) ? today : `${shownMonth}-01`;

    calendar.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement;
      const date = target.getAttribute('data-date');
      if (!date) return;
      const key = event.key;
      if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault();
        const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -7 : 7;
        const moved = shiftDate(date, delta);
        if (moved.slice(0, 7) !== shownMonth) return; // stays within the month
        cells.get(moved)?.focus();
        return;
      }
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        const cellState = target.getAttribute('data-state');
        if (cellState === 'future' || cellState === 'closed') return;
        void openDate(date);
        return;
      }
    });

    function focusTabTarget(): void {
      if (tabTarget) {
        const cell = cells.get(tabTarget);
        if (cell) {
          cell.setAttribute('tabindex', '0');
          return;
        }
      }
    }

    focusTabTarget();

    head.querySelector('#prev-month')?.addEventListener('click', () => {
      const prev = prevMonth(shownMonth);
      if (prev < '2026-01') return;
      shownMonth = prev;
      renderMonth();
    });
    head.querySelector('#next-month')?.addEventListener('click', () => {
      const next = nextMonth(shownMonth);
      if (next > today.slice(0, 7)) return;
      shownMonth = next;
      renderMonth();
    });

    calendarWrap.replaceChildren(head, calendar);

    async function openDate(date: string): Promise<void> {
      try {
        const res = await api.post<{ game: { id: string } }>(`/api/daily/${date}/game`);
        window.location.href = `/play/${res.game.id}`;
      } catch (err) {
        if (err instanceof ApiError) {
          announce(M.m56());
        }
      }
    }
  }

  renderMonth();

  const left = el('div', {}, [h1, calendarWrap]);
  page.append(left, streakPanel);
  return page;
}

function stateWordsFor(state: string): string {
  switch (state) {
    case 'solved': return 'solved';
    case 'late': return 'solved late';
    case 'missed': return 'missed';
    case 'today': return 'today';
    case 'future': return 'not open yet';
    case 'closed': return 'not available';
    default: return '';
  }
}

function streakText(n: number): string {
  return `Current streak: ${n} ${n === 1 ? 'day' : 'days'}`;
}

function bestText(n: number): string {
  return `Best streak: ${n} ${n === 1 ? 'day' : 'days'}`;
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, '0')}`;
}
