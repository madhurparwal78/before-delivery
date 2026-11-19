import { ReturnRecord } from '../../shared/types';
import {
  CivilDate,
  addDays,
  dayOfWeek,
  formatDate,
  lastDayOfMonth,
  longDate,
  longDateString,
  monthCaption,
  parseDate,
} from '../../shared/dates';
import type { App } from '../app';
import { monthWeeks, shiftMonth } from '../clock';
import { el, svg } from '../dom';
import { iconSvg } from '../../shared/icons';
import { renderBand } from '../components/band';
import { emptyState, statusChip } from '../components/tile';
import { countsRow } from './form';

const WEEKDAY_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function returnsOn(app: App, date: string): ReturnRecord[] {
  return app.state.returns.filter((record) => record.due_date === date);
}

function ghostsOn(app: App, date: string): ReturnRecord[] {
  return app.state.ghosts.filter((record) => record.carried_from === date);
}

function dayCell(app: App, month: string, day: CivilDate | null): HTMLElement {
  if (!day) return el('div', { role: 'gridcell', class: 'day-blank' });
  const date = formatDate(day);
  const records = returnsOn(app, date);
  const ghosts = ghostsOn(app, date);
  const focused = app.state.focusedDate === date;
  const isToday = app.todayDate() === date;

  return el(
    'div',
    {
      role: 'gridcell',
      class: 'day',
      'aria-label': longDate(day),
      'data-date': date,
      'data-count': String(records.length),
      'data-today': isToday ? 'true' : null,
      'data-focus-key': `day:${date}`,
      tabindex: focused ? '0' : '-1',
      onClick: () => app.toggleBand(date, records.length),
      onKeydown: (event: KeyboardEvent) => handleKey(app, month, date, records.length, event),
    },
    el('span', { class: 'day-number' }, String(day.d)),
    el('span', { class: 'day-count' }, `${records.length} due`),
    el(
      'div',
      { class: 'day-chips' },
      ...records.map((record) => statusChip(record)),
    ),
    ...records
      .filter((record) => record.carried_from !== null)
      .map((record) =>
        el(
          'span',
          { class: 'carried-line' },
          `Carried from ${longDateString(record.carried_from as string)}`,
        ),
      ),
    ...ghosts.map((record) =>
      el(
        'span',
        { class: 'ghost-chip', 'data-ghost-for': record.id },
        `${record.state} · Carried from ${longDateString(date)}`,
      ),
    ),
  );
}

function handleKey(
  app: App,
  month: string,
  date: string,
  count: number,
  event: KeyboardEvent,
): void {
  const civil = parseDate(date);
  const move = (next: CivilDate): void => {
    event.preventDefault();
    app.focusDay(formatDate(next), month);
  };
  switch (event.key) {
    case 'ArrowLeft':
      move(addDays(civil, -1));
      return;
    case 'ArrowRight':
      move(addDays(civil, 1));
      return;
    case 'ArrowUp':
      move(addDays(civil, -7));
      return;
    case 'ArrowDown':
      move(addDays(civil, 7));
      return;
    case 'Home': {
      const weekday = dayOfWeek(civil);
      const monday = addDays(civil, -(weekday === 0 ? 6 : weekday - 1));
      move(formatDate(monday).slice(0, 7) === month ? monday : { ...civil, d: 1 });
      return;
    }
    case 'End': {
      const weekday = dayOfWeek(civil);
      const sunday = addDays(civil, weekday === 0 ? 0 : 7 - weekday);
      move(
        formatDate(sunday).slice(0, 7) === month
          ? sunday
          : { ...civil, d: lastDayOfMonth(civil.y, civil.m) },
      );
      return;
    }
    case 'PageUp':
    case 'PageDown': {
      event.preventDefault();
      const target = shiftMonth(month, event.key === 'PageDown' ? 1 : -1);
      const year = Number(target.slice(0, 4));
      const monthNumber = Number(target.slice(5, 7));
      const day = Math.min(civil.d, lastDayOfMonth(year, monthNumber));
      app.focusDay(`${target}-${String(day).padStart(2, '0')}`, month);
      return;
    }
    case 'Enter':
      event.preventDefault();
      app.toggleBand(date, count);
      return;
    case 'Escape':
      if (app.state.openDay !== null) {
        event.preventDefault();
        app.closeBand();
      }
      return;
    default:
  }
}

export function renderMonth(app: App, month: string): HTMLElement {
  const weeks = monthWeeks(month);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const openDay = app.state.openDay;

  const rows: HTMLElement[] = [
    el(
      'div',
      { role: 'row', class: 'grid-row grid-head' },
      ...WEEKDAY_HEADS.map((name) => el('span', { role: 'columnheader' }, name)),
    ),
  ];

  for (const week of weeks) {
    rows.push(
      el('div', { role: 'row', class: 'grid-row' }, ...week.map((day) => dayCell(app, month, day))),
    );
    if (openDay && week.some((day) => day !== null && formatDate(day) === openDay)) {
      // The band sits in its own full-width row so the grid keeps only rows
      // and cells as children.
      rows.push(
        el(
          'div',
          { role: 'row', class: 'band-row' },
          el(
            'div',
            { role: 'gridcell', 'aria-colspan': '7', class: 'band-cell' },
            renderBand(app, openDay, returnsOn(app, openDay)),
          ),
        ),
      );
    }
  }

  const pending = app.state.pendingDayFocus;
  if (pending) {
    app.state.pendingDayFocus = null;
    app.mountTasks.push(() => {
      document.querySelector<HTMLElement>(`[data-focus-key="day:${pending}"]`)?.focus();
    });
  }

  return el(
    'main',
    { class: 'screen' },
    countsRow(app.state.counts.overdue, app.state.counts.awaiting_approval),
    el(
      'div',
      { class: 'month-caption' },
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': 'previous-month',
          onClick: () => app.goToMonth(shiftMonth(month, -1), null),
        },
        svg(iconSvg('chevron-left')),
        'Previous month',
      ),
      el('h2', {}, monthCaption(year, monthNumber)),
      el(
        'button',
        {
          type: 'button',
          'data-focus-key': 'next-month',
          onClick: () => app.goToMonth(shiftMonth(month, 1), null),
        },
        'Next month',
        svg(iconSvg('chevron-right')),
      ),
    ),
    el('div', { role: 'grid', 'aria-label': 'Due dates', class: 'grid' }, ...rows),
    app.state.returns.length === 0 ? emptyState('No returns due this month.') : null,
  );
}
