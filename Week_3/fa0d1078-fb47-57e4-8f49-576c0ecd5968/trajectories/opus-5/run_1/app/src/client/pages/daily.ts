import type { DailyShape, GameShape } from '../../shared/api';
import { DAY_STATE_WORDS, isOpenDayState, type DayState } from '../../shared/daily';
import {
  addMonths,
  formatLongDate,
  monthKeyOf,
  monthLabel,
  monthWeeks,
  WEEKDAY_NAMES,
  type PlainDate,
} from '../../shared/dates';
import { M, streakLine } from '../../shared/messages';
import { api, clientConfig } from '../api';
import { announce } from '../announcer';
import { apply, button, clear, el, text } from '../dom';
import type { Cleanup, PageContext } from '../main';
import { navigate, noticeFor } from '../main';

export async function renderDaily(context: PageContext): Promise<Cleanup | void> {
  const { main } = context;
  main.append(text('h1', 'Daily challenge'));
  const loading = text('p', M.preparing, { class: 'serif-sentence' });
  main.append(loading);

  let data: DailyShape;
  try {
    data = await api.get<DailyShape>('/api/daily');
  } catch (cause) {
    loading.textContent = noticeFor(cause);
    announce(noticeFor(cause));
    return;
  }
  loading.remove();

  let shown = data.month;
  let tabStop: PlainDate = data.today;
  let states = new Map(data.days.map((day) => [day.date, day] as const));

  const previous = button('Previous month', { class: 'month-button' });
  const next = button('Next month', { class: 'month-button' });
  const label = text('h2', monthLabel(shown), { class: 'month-label' });
  const calendar = el('div', { role: 'grid', id: 'calendar', class: 'calendar' });
  const streak = el('p', { id: 'streak', class: 'streak' });
  const best = el('p', { id: 'best-streak', class: 'streak' });
  const notice = el('p', { class: 'notice' });

  main.append(
    el('div', { class: 'month-bar' }, [previous, label, next]),
    el('div', { class: 'daily-layout' }, [
      el('div', { class: 'calendar-tile' }, [calendar]),
      el('div', { class: 'streak-lines' }, [streak, best]),
    ]),
    notice,
  );

  function dayOf(date: PlainDate): { state: DayState; id: string | null } | undefined {
    return states.get(date);
  }

  function renderStreaks(): void {
    streak.textContent = streakLine('Current streak', data.current_streak);
    best.textContent = streakLine('Best streak', data.best_streak);
  }

  function renderMonth(): void {
    label.textContent = monthLabel(shown);
    apply(calendar, { 'aria-label': monthLabel(shown) });
    apply(next, { 'aria-disabled': shown >= monthKeyOf(data.today) ? 'true' : 'false' });
    apply(previous, {
      'aria-disabled': shown <= monthKeyOf(clientConfig.daily_start) ? 'true' : 'false',
    });
    clear(calendar);
    const header = el('div', { role: 'row', class: 'calendar-row' });
    for (const name of WEEKDAY_NAMES) {
      header.append(el('div', { role: 'columnheader', class: 'calendar-head' }, [name]));
    }
    calendar.append(header);
    for (const week of monthWeeks(shown)) {
      const row = el('div', { role: 'row', class: 'calendar-row' });
      for (const date of week) {
        if (date === null) {
          row.append(el('div', { role: 'gridcell', class: 'calendar-blank' }));
          continue;
        }
        const day = dayOf(date);
        const state = day?.state ?? 'future';
        const cell = el(
          'div',
          {
            role: 'gridcell',
            class: 'calendar-day',
            'data-date': date,
            'data-state': state,
            'aria-label': `${formatLongDate(date)}, ${DAY_STATE_WORDS[state]}`,
            tabindex: date === tabStop ? '0' : '-1',
            ...(state === 'future' || state === 'closed' ? { 'aria-disabled': 'true' } : {}),
          },
          [String(Number(date.slice(8, 10)))],
        );
        cell.addEventListener('click', () => open(date));
        row.append(cell);
      }
      calendar.append(row);
    }
  }

  function cellFor(date: PlainDate): HTMLElement | null {
    return calendar.querySelector<HTMLElement>(`[data-date="${date}"]`);
  }

  function setTabStop(date: PlainDate, focus: boolean): void {
    if (!cellFor(date)) return;
    tabStop = date;
    for (const cell of calendar.querySelectorAll<HTMLElement>('[data-date]')) {
      cell.tabIndex = cell.dataset.date === date ? 0 : -1;
    }
    if (focus) cellFor(date)?.focus();
  }

  async function load(month: string): Promise<void> {
    try {
      const answer = await api.get<DailyShape>(`/api/daily?month=${month}`);
      data = answer;
      states = new Map(answer.days.map((day) => [day.date, day] as const));
      shown = answer.month;
      renderMonth();
      renderStreaks();
      setTabStop(monthKeyOf(data.today) === shown ? data.today : `${shown}-01`, false);
    } catch (cause) {
      notice.textContent = noticeFor(cause);
      announce(noticeFor(cause));
    }
  }

  function step(delta: number): void {
    const control = delta < 0 ? previous : next;
    if (control.getAttribute('aria-disabled') === 'true') return;
    const target = addMonths(shown, delta);
    void load(target).then(() => control.focus());
  }

  previous.addEventListener('click', () => step(-1));
  next.addEventListener('click', () => step(1));

  function open(date: PlainDate): void {
    const day = dayOf(date);
    if (!day || !isOpenDayState(day.state)) return;
    void (async () => {
      try {
        const answer = await api.post<{ game: GameShape }>(`/api/daily/${date}/game`);
        navigate(`/play/${answer.game.id}`);
      } catch (cause) {
        notice.textContent = noticeFor(cause);
        announce(noticeFor(cause));
      }
    })();
  }

  function shift(days: number): void {
    const index = Number(tabStop.slice(8, 10)) - 1 + days;
    const dates = [...states.keys()].filter((date) => date.startsWith(shown)).sort();
    const target = dates[index];
    if (target) setTabStop(target, true);
  }

  function onKeydown(event: KeyboardEvent): void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !active.dataset.date) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        shift(-1);
        return;
      case 'ArrowRight':
        event.preventDefault();
        shift(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        shift(-7);
        return;
      case 'ArrowDown':
        event.preventDefault();
        shift(7);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        open(active.dataset.date);
        return;
      default:
        return;
    }
  }

  calendar.addEventListener('keydown', onKeydown);
  renderMonth();
  renderStreaks();
  cellFor(tabStop)?.focus();
}
