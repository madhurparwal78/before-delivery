import { api, ApiCallError } from './api.js';
import { app, navigate, type ChangeEvent, type Screen } from './app.js';
import { createChart } from './chart.js';
import { createRail } from './rail.js';
import { el, fieldError, keepFocus, onDragToDay, openDialog, svgEl } from './dom.js';
import {
  dataNumber,
  formatDay,
  formatDuration,
  formatLongDay,
  formatPace,
  formatPercent,
  formatTsb,
  formatTss,
} from './format.js';
import { openLogSession } from './logSession.js';
import { notFoundView } from './notFound.js';
import { onTargetPercent } from '../domain/compliance.js';
import { parsePaceText } from '../domain/display.js';
import { addDays, diffDays, isoWeekOf, isoWeekday, mondayOfWeek } from '../domain/time.js';
import type {
  AthleteDetail,
  Item,
  LibraryItem,
  SeriesDay,
  WeekView,
  Workout,
} from '../domain/types.js';

const RAIL_WINDOW = 4;
const RING_WEEKS = 11;

export async function createHomeScreen(athleteId: string): Promise<Screen> {
  const today = app.me?.today as string;
  const params = new URLSearchParams(window.location.search);
  let centre = params.get('week') ?? isoWeekOf(today);

  const weekCache = new Map<string, WeekView>();
  let windowStart = -RAIL_WINDOW;
  let windowEnd = RAIL_WINDOW;
  let athlete: AthleteDetail;
  let series: SeriesDay[] = [];
  let library: LibraryItem[] = [];
  let thresholdStatusText = '';
  let coachRequestText: string | null = null;

  const element = el('main', { class: 'home' });

  async function loadWeeks(centreWeek: string, before: number, after: number): Promise<void> {
    const response = await api.weeks(athleteId, centreWeek, before, after);
    for (const week of response.weeks) weekCache.set(week.week, week);
  }

  /** Loads every week the rail window and the compliance rings need, in API-sized chunks. */
  async function loadRange(): Promise<void> {
    const monday = mondayOfWeek(centre);
    const from = Math.min(windowStart, -RING_WEEKS);
    let offset = from;
    while (offset <= windowEnd) {
      const chunkCentre = isoWeekOf(addDays(monday, offset * 7));
      const after = Math.min(12, windowEnd - offset);
      await loadWeeks(chunkCentre, 0, after);
      offset += after + 1;
    }
  }

  async function loadAll(): Promise<void> {
    athlete = await api.athlete(athleteId);
    await loadRange();
    series = (await api.series(athleteId)).days;
    library = (await api.library()).library;
  }

  function windowWeeks(): WeekView[] {
    const monday = mondayOfWeek(centre);
    const weeks: WeekView[] = [];
    for (let offset = windowStart; offset <= windowEnd; offset += 1) {
      const week = isoWeekOf(addDays(monday, offset * 7));
      const view = weekCache.get(week);
      if (view) weeks.push(view);
    }
    return weeks;
  }

  function centreWeekView(): WeekView | undefined {
    return weekCache.get(centre);
  }

  function weeksEndingWithCentre(count: number): WeekView[] {
    const monday = mondayOfWeek(centre);
    const weeks: WeekView[] = [];
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const view = weekCache.get(isoWeekOf(addDays(monday, -offset * 7)));
      if (view) weeks.push(view);
    }
    return weeks;
  }

  function itemsOf(weeks: WeekView[]): Item[] {
    return weeks.flatMap((week) => week.days.flatMap((day) => day.items));
  }

  const chart = createChart();

  const rail = createRail({
    onCentreChange: (week) => {
      centre = week;
      const url = new URL(window.location.href);
      url.searchParams.set('week', week);
      window.history.replaceState(null, '', url);
      renderSections(false);
      void ensureWeeks();
    },
    onLoadMore: (edge) => {
      if (edge === 'earlier') windowStart -= 4;
      else windowEnd += 4;
      void ensureWeeks().then(() => renderSections(false));
    },
    onLogSession: (date) => openLog(date, null),
    onPlan: (date) => navigate(`/athletes/${athleteId}/builder?date=${date}`),
    onMove: (workoutId, title, toDate) => void moveWorkout(workoutId, title, toDate),
  });

  async function ensureWeeks(): Promise<void> {
    await loadRange();
    renderSections(false);
  }

  function plannedWorkouts(): Workout[] {
    return itemsOf(windowWeeks())
      .map((item) => item.planned)
      .filter((workout): workout is Workout => workout !== null);
  }

  async function moveWorkout(workoutId: string, title: string, toDate: string): Promise<void> {
    const workout = plannedWorkouts().find((candidate) => candidate.id === workoutId);
    if (!workout) return;
    if (workout.date === toDate) return;
    try {
      await api.patchWorkout(workoutId, { version: workout.version, date: toDate });
      rail.announceCalendar(`Moved ${title} to ${formatDay(toDate)}.`);
    } catch (error) {
      if (error instanceof ApiCallError) {
        rail.announceCalendar(error.failure.message ?? 'That move was refused.');
      }
    }
    await refresh(false);
  }

  async function placeLibraryItem(item: LibraryItem, date: string): Promise<void> {
    try {
      await api.createWorkout(athleteId, {
        date,
        sport: item.sport,
        title: item.name,
        library_id: item.id,
      });
      rail.announceCalendar(`Placed ${item.name} on ${formatDay(date)}.`);
    } catch (error) {
      if (error instanceof ApiCallError) {
        rail.announceCalendar(error.failure.message ?? 'That placement was refused.');
      }
    }
    await refresh(false);
  }

  function openLog(date: string, opener: HTMLElement | null): void {
    openLogSession({
      athleteId,
      date,
      opener,
      onSaved: () => void refresh(true),
    });
  }

  function banner(): HTMLElement {
    const todayDay = series.find((day) => day.date === today);
    const yesterday = series.find((day) => day.date === addDays(today, -1));
    const tsb = todayDay?.tsb ?? 0;
    const ctl = yesterday?.ctl ?? 0;
    const atl = yesterday?.atl ?? 0;
    const planButton = el('button', {
      class: 'pill pill-ink',
      text: 'Plan a workout',
      attrs: { type: 'button' },
      on: { click: () => navigate(`/athletes/${athleteId}/builder?date=${today}`) },
    });
    const logButton = el('button', {
      class: 'pill pill-ink',
      text: 'Log a session',
      attrs: { type: 'button' },
      on: { click: () => openLog(today, logButton) },
    });
    return el('section', {
      class: 'today-band',
      attrs: { role: 'region', 'aria-label': 'Today' },
      children: [
        el('div', {
          class: 'band-art',
          attrs: { 'aria-hidden': 'true' },
          children: [
            svgEl('svg', {
              attrs: { viewBox: '0 0 400 200', preserveAspectRatio: 'none' },
              children: [
                svgEl('polygon', { class: 'band-shape', attrs: { points: '240,0 400,0 340,200 180,200' } }),
                svgEl('polyline', { class: 'band-outline', attrs: { points: '20,200 90,0' } }),
                svgEl('polyline', { class: 'band-outline', attrs: { points: '70,200 140,0' } }),
                svgEl('polyline', { class: 'band-outline', attrs: { points: '120,200 190,0' } }),
              ],
            }),
          ],
        }),
        el('p', {
          class: 'display-line band-form',
          text: `Form ${formatTsb(tsb)}.`,
          attrs: { 'data-tsb': dataNumber(tsb, 1) },
        }),
        el('p', {
          class: 'band-sub',
          text: `Fitness ${formatTss(ctl)} · fatigue ${formatTss(atl)} coming into today`,
          attrs: { 'data-ctl': dataNumber(ctl, 1), 'data-atl': dataNumber(atl, 1) },
        }),
        el('div', { class: 'band-actions', children: [planButton, logButton] }),
      ],
    });
  }

  function sportTiles(): HTMLElement {
    const week = centreWeekView();
    const sports = week?.sports ?? { bike_tss: 0, run_tss: 0, bike_s: 0, run_s: 0, sessions: 0 };
    const tile = (label: string, value: string, data: string): HTMLElement =>
      el('div', {
        class: 'tile',
        attrs: { role: 'group', 'aria-label': label, 'data-value': data },
        children: [
          el('p', { class: 'tile-label', text: label }),
          el('p', { class: 'tile-value', text: value }),
        ],
      });
    return el('section', {
      class: 'tiles',
      children: [
        tile('Bike stress', formatTss(sports.bike_tss), dataNumber(sports.bike_tss, 1)),
        tile('Run stress', formatTss(sports.run_tss), dataNumber(sports.run_tss, 1)),
        tile('Bike time', formatDuration(sports.bike_s), String(sports.bike_s)),
        tile('Run time', formatDuration(sports.run_s), String(sports.run_s)),
        tile('Sessions', String(sports.sessions), String(sports.sessions)),
      ],
    });
  }

  function ringRow(label: string, weeks: WeekView[]): HTMLElement {
    const percent = onTargetPercent(itemsOf(weeks));
    const text = percent === null ? 'No planned sessions' : `${formatPercent(percent)}% on target`;
    const dash = percent === null ? 0 : (percent / 100) * 264;
    return el('div', {
      class: 'ring-row',
      attrs: {
        role: 'group',
        'aria-label': label,
        'data-percent': percent === null ? '0' : formatPercent(percent),
      },
      children: [
        svgEl('svg', {
          class: 'ring',
          attrs: { viewBox: '0 0 100 100', 'aria-hidden': 'true' },
          children: [
            svgEl('circle', { class: 'ring-track', attrs: { cx: 50, cy: 50, r: 42 } }),
            svgEl('circle', {
              class: 'ring-value',
              attrs: {
                cx: 50,
                cy: 50,
                r: 42,
                'stroke-dasharray': `${dash} 264`,
                transform: 'rotate(-90 50 50)',
              },
            }),
          ],
        }),
        el('div', {
          class: 'ring-text',
          children: [
            el('p', { class: 'ring-label', text: label }),
            el('p', { class: 'ring-value-text', text }),
          ],
        }),
      ],
    });
  }

  function rings(): HTMLElement {
    const centreView = centreWeekView();
    return el('section', {
      class: 'rings',
      children: [
        ringRow('This week', centreView ? [centreView] : []),
        ringRow('Last 4 weeks', weeksEndingWithCentre(4)),
        ringRow('Last 12 weeks', weeksEndingWithCentre(12)),
      ],
    });
  }

  function recentUploads(): HTMLElement {
    const completed: { workout: Workout; date: string }[] = [];
    for (const week of weekCache.values()) {
      for (const day of week.days) {
        for (const item of [...day.items].reverse()) {
          if (item.completed) completed.push({ workout: item.completed, date: day.date });
        }
      }
    }
    completed.sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0));
    const latest = completed.slice(0, 10);
    const rows = [el('div', { class: 'drift-row' }), el('div', { class: 'drift-row' })];
    latest.forEach((entry, index) => {
      (rows[index % 2] as HTMLElement).append(
        el('article', {
          class: 'drift-tile',
          children: [
            el('p', {
              class: 'drift-text',
              text: `${entry.workout.title} · ${formatDay(entry.date)} · ${formatTss(
                entry.workout.tss as number,
              )} TSS`,
            }),
          ],
        }),
      );
    });
    return el('section', {
      class: 'drift-wall',
      attrs: { role: 'region', 'aria-label': 'Recent uploads' },
      children: [
        el('h2', { class: 'section-heading', text: 'Recent uploads' }),
        latest.length === 0
          ? el('p', { class: 'display-line', text: 'No sessions yet' })
          : el('div', { class: 'drift-rows', children: rows }),
      ],
    });
  }

  function countdown(): HTMLElement {
    const next = athlete.events
      .filter((event) => event.date >= today)
      .sort((left, right) => (left.date < right.date ? -1 : 1))[0];
    const days = next ? diffDays(next.date, today) : null;
    const text =
      next === undefined
        ? 'No event on the calendar'
        : days === 0
          ? `Race day: ${next.name}`
          : days === 1
            ? `1 day to ${next.name}`
            : `${days} days to ${next.name}`;
    return el('section', {
      class: 'countdown',
      attrs: {
        role: 'region',
        'aria-label': 'Next event',
        'data-days': days === null ? null : String(days),
      },
      children: [el('p', { class: 'countdown-text', text })],
    });
  }

  function thresholds(): HTMLElement {
    const status = el('p', {
      class: 'status-line',
      text: thresholdStatusText,
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Threshold status' },
    });
    const ftpInput = el('input', { class: 'field', attrs: { type: 'text', 'aria-label': 'FTP', id: 'threshold-ftp' } });
    const paceInput = el('input', {
      class: 'field',
      attrs: { type: 'text', 'aria-label': 'Threshold pace', id: 'threshold-pace' },
    });
    const fromInput = el('input', {
      class: 'field',
      attrs: { type: 'text', value: today, 'aria-label': 'Effective from', id: 'threshold-from' },
    });
    const errors = el('div');
    const save = el('button', {
      class: 'pill pill-accent',
      text: 'Save threshold',
      attrs: { type: 'button' },
    });
    save.addEventListener('click', async () => {
      errors.replaceChildren();
      const effectiveFrom = fromInput.value.trim();
      const messages: string[] = [];
      save.disabled = true;
      save.textContent = 'Saving…';
      status.textContent = 'Saving…';
      try {
        if (ftpInput.value.trim() !== '') {
          const result = await api.saveThreshold(athleteId, {
            kind: 'ftp',
            value: Number(ftpInput.value.trim()),
            effective_from: effectiveFrom,
          });
          messages.push(
            `FTP ${result.threshold.value} W from ${formatLongDay(
              result.threshold.effective_from,
            )}. Re-scored ${result.rescored} ${result.rescored === 1 ? 'workout' : 'workouts'}.`,
          );
        }
        if (paceInput.value.trim() !== '') {
          const result = await api.saveThreshold(athleteId, {
            kind: 'pace',
            value: parsePaceText(paceInput.value) ?? 0,
            effective_from: effectiveFrom,
          });
          messages.push(
            `Threshold pace ${formatPace(result.threshold.value)} /km from ${formatLongDay(
              result.threshold.effective_from,
            )}. Re-scored ${result.rescored} ${result.rescored === 1 ? 'workout' : 'workouts'}.`,
          );
        }
        thresholdStatusText = messages.join(' ');
        status.textContent = thresholdStatusText;
        await refresh(true);
      } catch (error) {
        thresholdStatusText = '';
        status.textContent = '';
        if (error instanceof ApiCallError && error.failure.errors) {
          const fields = error.failure.errors;
          const target = fields.value !== undefined ? ftpInput : fromInput;
          const message = fields.value ?? fields.effective_from ?? 'Check the threshold.';
          errors.replaceChildren(fieldError(target, message));
          target.focus();
        }
      } finally {
        save.disabled = false;
        save.textContent = 'Save threshold';
        keepFocus(save);
      }
    });

    const history = el('ul', {
      class: 'threshold-history',
      children: athlete.thresholds.map((threshold) =>
        el('li', {
          text:
            threshold.kind === 'ftp'
              ? `FTP ${threshold.value} W from ${formatLongDay(threshold.effective_from)}`
              : `Threshold pace ${formatPace(threshold.value)} /km from ${formatLongDay(
                  threshold.effective_from,
                )}`,
        }),
      ),
    });

    return el('section', {
      class: 'card thresholds',
      attrs: { role: 'region', 'aria-label': 'Thresholds' },
      children: [
        el('h2', { class: 'card-title', text: 'Thresholds' }),
        el('div', {
          class: 'threshold-fields',
          children: [
            el('label', { class: 'field-row', children: [el('span', { text: 'FTP' }), ftpInput] }),
            el('label', {
              class: 'field-row',
              children: [el('span', { text: 'Threshold pace' }), paceInput],
            }),
            el('label', {
              class: 'field-row',
              children: [el('span', { text: 'Effective from' }), fromInput],
            }),
            save,
          ],
        }),
        errors,
        status,
        history,
      ],
    });
  }

  function libraryPanel(): HTMLElement {
    const items = library.map((item) => {
      const place = el('button', {
        class: 'pill pill-small',
        text: `Place ${item.name}`,
        attrs: { type: 'button' },
      });
      let target: string | null = null;
      place.addEventListener('keydown', (event) => {
        const keyboard = event as KeyboardEvent;
        const monday = mondayOfWeek(centre);
        if (keyboard.key === 'Enter' || keyboard.key === ' ') {
          keyboard.preventDefault();
          if (target === null) {
            target = monday;
            rail.announceCalendar(
              `Picked up ${item.name}. Use the arrow keys to choose a day, then press Enter to drop or Escape to cancel.`,
            );
            return;
          }
          const chosen = target;
          target = null;
          void placeLibraryItem(item, chosen);
          return;
        }
        if (target === null) return;
        if (keyboard.key === 'Escape') {
          keyboard.preventDefault();
          target = null;
          rail.announceCalendar(`Move of ${item.name} cancelled.`);
          return;
        }
        if (keyboard.key === 'ArrowLeft' || keyboard.key === 'ArrowRight') {
          keyboard.preventDefault();
          const index = isoWeekday(target) - 1 + (keyboard.key === 'ArrowLeft' ? -1 : 1);
          if (index < 0 || index > 6) {
            rail.announceCalendar(formatDay(target));
            return;
          }
          target = addDays(monday, index);
          rail.announceCalendar(formatDay(target));
        }
      });
      const node = el('li', {
        class: 'library-item',
        children: [
          el('p', {
            class: 'library-text',
            text: `${item.name} · ${formatDuration(item.duration_s)} · ${formatTss(
              item.planned_tss,
            )} TSS`,
          }),
          place,
        ],
      });
      onDragToDay(node, (date) => void placeLibraryItem(item, date));
      return node;
    });
    return el('section', {
      class: 'card library',
      attrs: { role: 'region', 'aria-label': 'Workout library' },
      children: [
        el('h2', { class: 'card-title', text: 'Workout library' }),
        items.length === 0
          ? el('p', { text: 'No saved workouts yet' })
          : el('ul', { class: 'library-list', children: items }),
      ],
    });
  }

  function copyWeekButton(): HTMLElement | null {
    if (app.me?.role !== 'coach') return null;
    const button = el('button', {
      class: 'pill pill-accent',
      text: 'Copy week',
      attrs: { type: 'button' },
      on: { click: () => openCopyWeek(button) },
    });
    return button;
  }

  function openCopyWeek(opener: HTMLElement): void {
    const week = centreWeekView();
    const planned = week
      ? week.days.flatMap((day) =>
          day.items
            .filter((item) => item.planned !== null)
            .map((item) => ({ workout: item.planned as Workout, date: day.date })),
        )
      : [];
    openDialog({
      label: 'Copy week',
      className: 'sheet',
      opener,
      content: (handle) => {
        const status = el('p', {
          class: 'status-line',
          attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Copy status' },
        });
        const boxes = planned.map((entry) =>
          el('input', {
            attrs: {
              type: 'checkbox',
              value: entry.workout.id,
              'aria-label': `${entry.workout.title} · ${formatDay(entry.date)}`,
            },
          }),
        );
        const list = el('div', {
          class: 'checkbox-list',
          children: planned.map((entry, index) =>
            el('label', {
              class: 'checkbox-row',
              children: [
                boxes[index] as HTMLElement,
                el('span', { text: `${entry.workout.title} · ${formatDay(entry.date)}` }),
              ],
            }),
          ),
        });
        const selectAll = el('button', {
          class: 'pill pill-quiet',
          text: 'Select all',
          attrs: { type: 'button' },
          on: {
            click: () => {
              for (const box of boxes) (box as HTMLInputElement).checked = true;
            },
          },
        });
        const athleteSelect = el('select', {
          class: 'field',
          attrs: { 'aria-label': 'Copy to athlete' },
        });
        const targetWeek = el('input', {
          class: 'field',
          attrs: { type: 'text', value: isoWeekOf(addDays(mondayOfWeek(centre), 7)), 'aria-label': 'Target week' },
        });
        void api.athletes().then((response) => {
          athleteSelect.replaceChildren(
            ...response.athletes.map((candidate) =>
              el('option', { text: candidate.name, attrs: { value: candidate.id } }),
            ),
          );
        });
        const copy = el('button', {
          class: 'pill pill-accent',
          text: 'Copy workouts',
          attrs: { type: 'button' },
        });
        copy.addEventListener('click', async () => {
          const ids = boxes
            .filter((box) => (box as HTMLInputElement).checked)
            .map((box) => (box as HTMLInputElement).value);
          copy.disabled = true;
          copy.textContent = 'Copying…';
          status.textContent = 'Copying…';
          try {
            const result = await api.copyWeek(athleteId, {
              week: centre,
              workout_ids: ids,
              to_athlete_id: athleteSelect.value,
              to_week: targetWeek.value.trim(),
            });
            const name =
              athleteSelect.options[athleteSelect.selectedIndex]?.textContent ?? 'the athlete';
            status.textContent =
              `Copied ${result.created} ${result.created === 1 ? 'workout' : 'workouts'} to ${name}. ` +
              `Skipped ${result.skipped} on ${result.skipped === 1 ? 'a day' : 'days'} that have already passed.`;
          } catch (error) {
            if (error instanceof ApiCallError) {
              status.textContent =
                Object.values(error.failure.errors ?? {})[0] ?? error.failure.message ?? '';
            }
          } finally {
            copy.disabled = false;
            copy.textContent = 'Copy workouts';
            keepFocus(copy);
          }
        });
        return [
          el('h2', { class: 'dialog-title', text: 'Copy week' }),
          list,
          selectAll,
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Copy to athlete' }), athleteSelect],
          }),
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Target week' }), targetWeek],
          }),
          copy,
          el('button', {
            class: 'pill pill-quiet',
            text: 'Cancel',
            attrs: { type: 'button' },
            on: { click: () => handle.close() },
          }),
          status,
        ];
      },
    });
  }

  function footer(): HTMLElement {
    const me = app.me;
    if (me?.role === 'coach') {
      return el('footer', {
        class: 'site-footer',
        attrs: { role: 'contentinfo' },
        children: [el('p', { text: `Your coach code: ${me.coach_code ?? ''}` })],
      });
    }
    if (coachRequestText !== null) {
      return el('footer', {
        class: 'site-footer',
        attrs: { role: 'contentinfo' },
        children: [
          el('h2', { class: 'footer-heading', text: 'Add a coach' }),
          el('p', { text: coachRequestText }),
        ],
      });
    }
    const input = el('input', {
      class: 'field',
      attrs: { type: 'text', 'aria-label': 'Coach code', id: 'coach-code' },
    });
    const errors = el('div');
    const form = el('div', { class: 'coach-code-form' });
    const send = el('button', {
      class: 'pill pill-accent',
      text: 'Send request',
      attrs: { type: 'button' },
    });
    send.addEventListener('click', async () => {
      errors.replaceChildren();
      send.disabled = true;
      send.textContent = 'Sending…';
      try {
        const result = await api.requestLink(input.value.trim());
        coachRequestText = `Request sent to ${result.link.coach_name}. They'll appear under Coaches once they accept.`;
        form.replaceChildren(el('p', { text: coachRequestText }));
      } catch (error) {
        if (error instanceof ApiCallError) {
          const message =
            error.failure.errors?.coach_code ?? error.failure.message ?? 'That code did not work.';
          errors.replaceChildren(fieldError(input, message));
          input.focus();
        }
      } finally {
        send.disabled = false;
        send.textContent = 'Send request';
        keepFocus(send);
      }
    });
    form.append(
      el('label', { class: 'field-row', children: [el('span', { text: 'Coach code' }), input] }),
      send,
      errors,
    );
    return el('footer', {
      class: 'site-footer',
      attrs: { role: 'contentinfo' },
      children: [el('h2', { class: 'footer-heading', text: 'Add a coach' }), form],
    });
  }

  const sections = {
    banner: el('div'),
    chart: el('div', { class: 'chart-holder' }),
    rail: el('div', { class: 'rail-holder' }),
    railRow: el('div', { class: 'rail-row' }),
    tiles: el('div'),
    rings: el('div'),
    uploads: el('div'),
    countdown: el('div'),
    thresholds: el('div'),
    library: el('div', { class: 'library-holder' }),
    footer: el('div'),
    actions: el('div', { class: 'home-actions' }),
  };

  sections.railRow.append(sections.rail, sections.library);
  element.append(
    sections.banner,
    sections.chart,
    sections.actions,
    sections.railRow,
    sections.tiles,
    sections.thresholds,
    sections.rings,
    sections.uploads,
    sections.countdown,
    sections.footer,
  );
  sections.chart.append(chart.element);
  sections.rail.append(rail.element);

  function renderSections(animateChart: boolean): void {
    sections.banner.replaceChildren(banner());
    sections.tiles.replaceChildren(sportTiles());
    sections.rings.replaceChildren(rings());
    sections.uploads.replaceChildren(recentUploads());
    sections.countdown.replaceChildren(countdown());
    sections.thresholds.replaceChildren(thresholds());
    sections.library.replaceChildren(libraryPanel());
    sections.footer.replaceChildren(footer());
    const copy = copyWeekButton();
    sections.actions.replaceChildren(...(copy ? [copy] : []));
    rail.update(windowWeeks(), centre);
    chart.update(series, centre, animateChart);
  }

  async function refresh(animateChart: boolean): Promise<void> {
    try {
      await loadAll();
    } catch (error) {
      if (error instanceof ApiCallError && error.failure.status === 404) {
        element.replaceChildren(notFoundView());
        return;
      }
      throw error;
    }
    renderSections(animateChart);
  }

  await refresh(false);

  return {
    element,
    onChange(event: ChangeEvent) {
      if (event.athlete_id !== athleteId) return;
      void refresh(true);
    },
  };
}
