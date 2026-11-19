import { ReturnRecord } from '../../shared/types';
import { addDays, formatDate, longDateString, parseDate } from '../../shared/dates';
import { isPast } from '../../shared/status';
import type { App } from '../app';
import { centralInstant } from '../clock';
import { el, prefersReducedMotion } from '../dom';
import { colourOf, returnData } from './tile';

const AXIS_HOURS = 36;
const AXIS_START_HOUR = 18;
const STRIP_STAGGER_MS = 40;

/** Deadline order, then state code, client name and return id. */
export function bandOrder(records: readonly ReturnRecord[]): ReturnRecord[] {
  return [...records].sort((a, b) => {
    if (a.due_at !== b.due_at) return a.due_at < b.due_at ? -1 : 1;
    if (a.state !== b.state) return a.state < b.state ? -1 : 1;
    if (a.client.name !== b.client.name) return a.client.name < b.client.name ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}

function axisStartMs(day: string): number {
  return centralInstant(formatDate(addDays(parseDate(day), -1)), AXIS_START_HOUR);
}

function hourLabel(hour: number): string {
  const normalised = ((hour % 24) + 24) % 24;
  const suffix = normalised < 12 ? 'am' : 'pm';
  const hour12 = normalised % 12 === 0 ? 12 : normalised % 12;
  return `${hour12} ${suffix}`;
}

function axis(): HTMLElement {
  const marks: HTMLElement[] = [];
  for (let offset = 0; offset <= AXIS_HOURS; offset += 6) {
    marks.push(
      el(
        'span',
        {
          class: 'band-hour',
          style: `left:${(offset / AXIS_HOURS) * 100}%`,
        },
        hourLabel(AXIS_START_HOUR + offset),
      ),
    );
  }
  return el('div', { class: 'band-axis', 'aria-hidden': 'true' }, ...marks);
}

function stripText(record: ReturnRecord): string {
  return `${record.client.name} ${record.state} · ${record.local_deadline_label} · ${record.practice_deadline_label}`;
}

export function renderBand(
  app: App,
  day: string,
  records: readonly ReturnRecord[],
): HTMLElement {
  const nowInstant = app.state.me ? app.state.me.now : '';
  const nowMs = nowInstant ? Date.parse(nowInstant) : 0;
  const ordered = bandOrder(records);
  const reduced = prefersReducedMotion();
  const settled = reduced || app.state.bandPhase === 'settled';

  const strips = ordered.map((record, index) => {
    const past = isPast(Date.parse(record.due_at), nowMs);
    const shift = (-record.offset_hours * 100) / AXIS_HOURS;
    const bar = el(
      'div',
      {
        class: `band-bar chip-${colourOf(record)}`,
        style: settled
          ? `transform:translateX(${shift}%)`
          : 'transform:translateX(0%)',
        'data-shift': String(shift),
        'data-delay': String(index * STRIP_STAGGER_MS),
      },
      el('span', {}, stripText(record)),
      record.overdue ? el('strong', {}, 'Overdue') : null,
      record.carried_from
        ? el('span', { class: 'carried-line' }, `Carried from ${longDateString(record.carried_from)}`)
        : null,
    );
    return el(
      'li',
      {
        class: 'band-strip',
        ...returnData(record),
        'data-offset-hours': String(record.offset_hours),
        'data-past': past ? 'true' : 'false',
      },
      bar,
    );
  });

  const startMs = axisStartMs(day);
  const nowFraction = (nowMs - startMs) / (AXIS_HOURS * 3600000);
  const nowVisible = nowFraction >= 0 && nowFraction <= 1;
  const nowLine = el('div', {
    class: 'band-now',
    'data-now': nowInstant,
    style: `left:${Math.min(Math.max(nowFraction, 0), 1) * 100}%`,
    hidden: !nowVisible,
    'aria-hidden': 'true',
  });

  const table = el(
    'table',
    { class: 'deadline-table', 'aria-label': 'Deadlines' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'State'),
        el('th', { scope: 'col' }, 'Local deadline'),
        el('th', { scope: 'col' }, 'Practice deadline'),
        el('th', { scope: 'col' }, 'Status'),
      ),
    ),
    el(
      'tbody',
      {},
      ...ordered.map((record) =>
        el(
          'tr',
          returnData(record),
          el('td', {}, record.state),
          el('td', {}, record.local_deadline_label),
          el('td', {}, record.practice_deadline_label),
          el(
            'td',
            {},
            record.overdue ? `${record.status_label} · Overdue` : record.status_label,
          ),
        ),
      ),
    ),
  );

  const band = el(
    'section',
    {
      class: `band${!reduced && app.state.bandPhase === 'opening' ? ' band-growing' : ''}`,
      'aria-label': `Deadlines on ${longDateString(day)}`,
      'data-band-day': day,
    },
    el(
      'div',
      { class: 'band-inner' },
      axis(),
      el(
        'div',
        { class: 'band-track' },
        el('ul', { class: 'band-strips' }, ...strips),
        nowLine,
      ),
      table,
    ),
  );

  if (!settled) {
    app.mountTasks.push(() => {
      const track = band.querySelector('.band-track');
      if (!track) return;
      requestAnimationFrame(() => {
        track.classList.add('band-sliding');
        for (const bar of track.querySelectorAll<HTMLElement>('.band-bar')) {
          bar.style.transitionDelay = `${bar.dataset.delay ?? '0'}ms`;
          bar.style.transform = `translateX(${bar.dataset.shift ?? '0'}%)`;
        }
        const total = strips.length * STRIP_STAGGER_MS + 500;
        window.setTimeout(() => {
          app.state.bandPhase = 'settled';
        }, total);
      });
    });
  }

  return band;
}
