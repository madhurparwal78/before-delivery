import { Cur, DayInfo } from '../../shared/types';
import { api } from '../api';
import { frame } from '../app';
import { DialogHandle, el, openDialog, roving } from '../dom';
import { currencyWords, isRtl, longDate, m, monthYear, t, weekdays, wholeMajor } from '../i18n';

export interface DatePickerSource {
  dest?: string;
  property?: string;
  zone: string;
  cur: Cur;
}

export interface GridOptions {
  source: DatePickerSource;
  start: string | null;
  end: string | null;
  months: number;
  onRangeComplete: (inDate: string, outDate: string) => void;
}

export interface DayGrid {
  element: HTMLElement;
  refresh: () => Promise<void>;
  focusDay: (iso: string) => void;
  moveMonths: (delta: number) => void;
  firstVisibleDay: () => string;
}

export function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
}

function dateOf(iso: string): Date {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d));
}

export function addDays(iso: string, n: number): string {
  const date = dateOf(iso);
  date.setUTCDate(date.getUTCDate() + n);
  return isoOf(date);
}

export function addMonths(iso: string, n: number): string {
  const date = dateOf(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return isoOf(date);
}

function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function endOfMonth(iso: string): string {
  const date = dateOf(startOfMonth(iso));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return isoOf(date);
}

function isoWeekday(iso: string): number {
  const day = dateOf(iso).getUTCDay();
  return day === 0 ? 7 : day;
}

export function diffDays(a: string, b: string): number {
  return Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86400000);
}

/** The day grid: every day labelled with availability, price and minimum stay. */
export function buildDayGrid(options: GridOptions): DayGrid {
  const container = el('div', { class: 'daygrid' });
  const zone = options.source.zone;
  let firstMonth = startOfMonth(options.start ?? isoOf(new Date()));
  let active = options.start ?? firstMonth;
  let pickedStart: string | null = null;
  let days = new Map<string, DayInfo>();

  const load = async (): Promise<void> => {
    const query = new URLSearchParams();
    if (options.source.property) query.set('property', options.source.property);
    else if (options.source.dest) query.set('dest', options.source.dest);
    query.set('from', firstMonth);
    query.set('to', endOfMonth(addMonths(firstMonth, options.months - 1)));
    query.set('cur', options.source.cur);
    if (pickedStart) query.set('start', pickedStart);
    container.setAttribute('aria-busy', 'true');
    const result = await api<{ days: DayInfo[] }>(`/api/dates?${query.toString()}`).catch(() => ({ days: [] }));
    container.removeAttribute('aria-busy');
    days = new Map(result.days.map((day) => [day.date, day]));
  };

  const labelOf = (iso: string): string => {
    const date = longDate(iso, zone);
    const day = days.get(iso);
    if (!day) return m('day.blocked', { date, reason: m('reason.stop_sell', { date }) });
    if (day.after_start === 'before') return m('day.before', { date });
    if (day.after_start === 'short') return m('day.short', { date, count: day.min_stay });
    if (day.available) {
      return m('day.available', {
        date,
        n: day.from_minor === null ? '0' : wholeMajor(day.from_minor, options.source.cur),
        'currency words': currencyWords(options.source.cur),
        count: day.min_stay,
      });
    }
    const reason = day.reason
      ? m(`reason.${day.reason.code}`, {
          date: day.reason.date ? longDate(day.reason.date, zone) : date,
          n: day.reason.n ?? 0,
        })
      : m('reason.stop_sell', { date });
    return m('day.blocked', { date, reason });
  };

  const dateHelp = (): void => {
    frame.regions.dateHelp.textContent = pickedStart
      ? m('date.end', { date: longDate(pickedStart, zone), n: days.get(pickedStart)?.min_stay ?? 1 })
      : m('date.start');
  };

  const paint = (): void => {
    container.replaceChildren();
    const buttons: HTMLElement[] = [];
    const weekStart = weekdays()[0].iso;
    for (let monthIndex = 0; monthIndex < options.months; monthIndex++) {
      const monthStart = startOfMonth(addMonths(firstMonth, monthIndex));
      const grid = el('table', { role: 'grid', 'aria-label': monthYear(monthStart, zone), class: 'month' });
      grid.append(
        el('thead', {}, [
          el(
            'tr',
            { role: 'row' },
            weekdays().map((day) => el('th', { scope: 'col' }, [day.name.slice(0, 2)])),
          ),
        ]),
      );
      const rows: HTMLElement[] = [];
      let cells: HTMLElement[] = [];
      const leading = (isoWeekday(monthStart) - weekStart + 7) % 7;
      for (let i = 0; i < leading; i++) cells.push(el('td', { role: 'gridcell', class: 'empty' }));
      const last = endOfMonth(monthStart);
      for (let iso = monthStart; iso <= last; iso = addDays(iso, 1)) {
        const day = days.get(iso);
        const rangeStart = pickedStart ?? options.start;
        const rangeEnd = pickedStart ? null : options.end;
        const inRange = rangeStart !== null && rangeEnd !== null && iso >= rangeStart && iso <= rangeEnd;
        const button = el(
          'button',
          {
            type: 'button',
            'data-date': iso,
            'aria-label': labelOf(iso),
            class: `day${day?.available ? '' : ' blocked'}`,
            tabindex: '-1',
          },
          [String(dateOf(iso).getUTCDate())],
        );
        button.addEventListener('click', () => pick(iso));
        button.addEventListener('keydown', (event) => onKeyDown(event, iso));
        buttons.push(button);
        cells.push(
          el('td', { role: 'gridcell', 'aria-selected': inRange || iso === pickedStart ? 'true' : null }, [button]),
        );
        if (cells.length === 7) {
          rows.push(el('tr', { role: 'row' }, cells));
          cells = [];
        }
      }
      if (cells.length > 0) {
        while (cells.length < 7) cells.push(el('td', { role: 'gridcell', class: 'empty' }));
        rows.push(el('tr', { role: 'row' }, cells));
      }
      grid.append(el('tbody', {}, rows));
      container.append(grid);
    }
    const activeIndex = Math.max(
      0,
      buttons.findIndex((button) => button.getAttribute('data-date') === active),
    );
    roving(buttons, activeIndex);
    dateHelp();
  };

  const focusDay = (iso: string): void => {
    active = iso;
    const inside = iso >= firstMonth && iso <= endOfMonth(addMonths(firstMonth, options.months - 1));
    if (!inside) {
      firstMonth = startOfMonth(iso);
      void load().then(() => {
        paint();
        container.querySelector<HTMLElement>(`button.day[data-date="${iso}"]`)?.focus();
      });
      return;
    }
    const button = container.querySelector<HTMLElement>(`button.day[data-date="${iso}"]`);
    if (!button) return;
    container.querySelectorAll<HTMLElement>('button.day').forEach((node) => {
      node.tabIndex = node === button ? 0 : -1;
    });
    button.focus();
  };

  const pick = (iso: string): void => {
    const day = days.get(iso);
    if (!day || !day.available) {
      frame.regions.dateHelp.textContent = labelOf(iso);
      focusDay(iso);
      return;
    }
    if (pickedStart === null) {
      pickedStart = iso;
      active = iso;
      void load().then(() => {
        paint();
        focusDay(iso);
      });
      return;
    }
    const inDate = pickedStart;
    pickedStart = null;
    options.onRangeComplete(inDate, iso);
  };

  const onKeyDown = (event: KeyboardEvent, iso: string): void => {
    const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
    const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
    const weekStart = weekdays()[0].iso;
    let next: string | null = null;
    if (event.key === forward) next = addDays(iso, 1);
    else if (event.key === back) next = addDays(iso, -1);
    else if (event.key === 'ArrowDown') next = addDays(iso, 7);
    else if (event.key === 'ArrowUp') next = addDays(iso, -7);
    else if (event.key === 'PageDown') next = addMonths(iso, event.shiftKey ? 12 : 1);
    else if (event.key === 'PageUp') next = addMonths(iso, event.shiftKey ? -12 : -1);
    else if (event.key === 'Home') next = addDays(iso, -((isoWeekday(iso) - weekStart + 7) % 7));
    else if (event.key === 'End') next = addDays(iso, 6 - ((isoWeekday(iso) - weekStart + 7) % 7));
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(iso);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    focusDay(next);
  };

  paint();

  return {
    element: container,
    refresh: async () => {
      const held = container.contains(document.activeElement)
        ? (document.activeElement as HTMLElement).getAttribute('data-date')
        : null;
      await load();
      paint();
      if (held) focusDay(held);
    },
    focusDay,
    moveMonths: (delta: number) => {
      firstMonth = startOfMonth(addMonths(firstMonth, delta));
      void load().then(() => {
        paint();
        focusDay(firstMonth);
      });
    },
    firstVisibleDay: () => firstMonth,
  };
}

export interface DatePickerOptions {
  source: DatePickerSource;
  start: string | null;
  end: string | null;
  opener: HTMLElement | null;
  onPicked: (inDate: string, outDate: string) => void;
}

/** `dialog "Choose dates"`: one month on a phone, two above it. */
export function openDatePicker(options: DatePickerOptions): DialogHandle {
  const months = window.innerWidth < 768 ? 1 : 2;
  let handle: DialogHandle | null = null;
  const grid = buildDayGrid({
    source: options.source,
    start: options.start,
    end: options.end,
    months,
    onRangeComplete: (inDate, outDate) => {
      handle?.close();
      options.onPicked(inDate, outDate);
    },
  });
  handle = openDialog({ name: t('ui.choose_dates'), opener: options.opener, className: 'datepicker' }, (body) => {
    const previous = el('button', { type: 'button' }, [t('ui.prev_month')]);
    const next = el('button', { type: 'button' }, [t('ui.next_month')]);
    previous.addEventListener('click', () => grid.moveMonths(-1));
    next.addEventListener('click', () => grid.moveMonths(1));
    body.append(el('div', { class: 'month-nav' }, [previous, next]), grid.element);
    void grid.refresh().then(() => grid.focusDay(options.start ?? isoOf(new Date())));
  });
  return handle;
}
