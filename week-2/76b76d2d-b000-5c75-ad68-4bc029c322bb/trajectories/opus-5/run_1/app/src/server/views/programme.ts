import type { Locale } from '../../shared/money.ts';
import { t } from '../../shared/strings.ts';
import { torontoDate, torontoTime } from '../domain/time.ts';
import type { SeasonSummary, ScreeningSummary } from '../repo/screenings.ts';
import { esc, h, labelled, tel, text } from './html.ts';
import { heading } from './layout.ts';

export type StageSeason = { season: SeasonSummary; screenings: ScreeningSummary[] };

function railRow(locale: Locale, screening: ScreeningSummary): string {
  const date = screening.starts_local.slice(0, 10);
  const time = screening.starts_local.slice(11, 16);
  const name = t('rail_row', locale, {
    film: screening.film_title,
    date,
    time,
    code: screening.auditorium,
  });
  return h(
    'li',
    { class: 'rail-row', 'data-screening': screening.id },
    h(
      'a',
      {
        href: `/${locale}/screenings/${screening.id}`,
        class: 'rail-link',
        'aria-label': name,
        'data-i18n-aria': 'rail_row',
        'data-i18n-args': JSON.stringify({
          film: screening.film_title,
          date,
          time,
          code: screening.auditorium,
        }),
      },
      h('span', { class: 'rail-date mono' }, esc(date)),
      h('span', { class: 'rail-time mono' }, esc(time)),
      h('span', { class: 'rail-film' }, esc(screening.film_title)),
      h('span', { class: 'rail-code mono' }, esc(screening.auditorium)),
    ),
    h(
      'span',
      { class: 'rail-seats mono', 'data-seats-left': screening.id },
      screening.seats_remaining === 0
        ? text(locale, 'sold_out')
        : text(locale, 'seats_left', { count: screening.seats_remaining }),
    ),
  );
}

function seasonSegment(locale: Locale, entry: StageSeason, index: number): string {
  const { season, screenings } = entry;
  const dates =
    season.first_date === null || season.last_date === null
      ? ''
      : `${season.first_date} — ${season.last_date}`;
  const title = { en: season.title_en, fr: season.title_fr };
  return h(
    'section',
    {
      class: 'season-segment',
      'data-season': season.slug,
      'data-index': index,
      hidden: index !== 0,
    },
    tel('h2', locale, 'plain', { value: title }, { class: 'season-title', 'data-season-title': season.slug }),
    h('p', { class: 'season-dates mono' }, esc(dates)),
    season.state === 'on-sale'
      ? ''
      : tel('p', locale, 'sale_times_line', {
          priority: season.priority_opens_at.slice(0, 10),
          public: season.public_sale_date,
        }, { class: 'sale-times' }),
    h(
      'ul',
      {
        class: 'schedule-rail',
        role: 'list',
        'aria-label': t('schedule_list', locale, { title }),
        'data-i18n-aria': 'schedule_list',
        'data-i18n-args': JSON.stringify({ title }),
        'data-rail': season.slug,
      },
      ...screenings.map((screening) => railRow(locale, screening)),
    ),
  );
}

export function programmeMain(locale: Locale, stage: StageSeason[]): string {
  const tabs = stage.map((entry, index) =>
    tel(
      'button',
      locale,
      'plain',
      { value: { en: entry.season.title_en, fr: entry.season.title_fr } },
      {
        type: 'button',
        role: 'tab',
        id: `tab-${entry.season.slug}`,
        class: 'season-tab',
        'data-season': entry.season.slug,
        'data-index': index,
        'aria-selected': index === 0 ? 'true' : 'false',
        'aria-current': index === 0 ? 'true' : null,
        tabindex: index === 0 ? '0' : '-1',
      },
    ),
  );
  return [
    h('div', { class: 'stage-heading' }, heading(locale, 'programme_heading')),
    h(
      'div',
      {
        id: 'stage',
        class: 'stage',
        role: 'region',
        ...labelled(locale, 'stage_region'),
        'data-segment': '0',
        'data-iris-open': '0.000',
        'data-iris-rotation': '0.0',
        'data-iris-radius': '0',
        'data-fstop': '22',
        'data-rail-visible': '0.000',
        'data-tint-mix': '0.000',
        'data-renderer': 'svg',
        'data-context': 'none',
        'data-count': stage.length,
      },
      h('canvas', { id: 'iris-canvas', class: 'iris-canvas', 'aria-hidden': 'true' }),
      h('div', { id: 'iris-svg', class: 'iris-svg', 'aria-hidden': 'true' }),
      h(
        'div',
        { class: 'stage-overlay' },
        h(
          'div',
          { role: 'tablist', class: 'season-tabs', ...labelled(locale, 'seasons_tablist') },
          ...tabs,
        ),
        h('p', {
          id: 'season-announcer',
          role: 'status',
          'aria-live': 'polite',
          class: 'visually-hidden',
          ...labelled(locale, 'season_announcer'),
        }),
        h('p', { id: 'fstop', class: 'fstop mono' }, 'f/22'),
        h('div', { id: 'stage-segments', class: 'stage-segments' }, ...stage.map((entry, index) => seasonSegment(locale, entry, index))),
      ),
    ),
    h('div', {
      id: 'stage-scroll',
      class: 'stage-scroll',
      style: `height:calc(${Math.max(1, stage.length) * 1000}px + 100vh)`,
    }),
  ].join('');
}

export function screeningMain(
  locale: Locale,
  screening: {
    id: string;
    film_title: string;
    format: string;
    auditorium: { code: string; name: string; venue: string };
    starts_at: Date;
    notes: string;
    capacity: number;
    seats_remaining: number;
    rows: string[][];
    seatStates: Map<string, string>;
  },
  options: { signedIn: boolean },
): string {
  const rows = screening.rows.map((row) =>
    h(
      'div',
      { role: 'row', class: 'seat-row' },
      ...row.map((seat, seatIndex) => {
        const state = screening.seatStates.get(seat) ?? 'available';
        const unavailable = state === 'sold' || state === 'held';
        const first = row === screening.rows[0] && seatIndex === 0;
        return h(
          'div',
          {
            role: 'gridcell',
            class: 'seat',
            'data-seat': seat,
            'data-state': state,
            'aria-label': t('seat_cell', locale, { seat }),
            'data-i18n-aria': 'seat_cell',
            'data-i18n-args': JSON.stringify({ seat }),
            'aria-selected': state === 'mine' ? 'true' : 'false',
            'aria-disabled': unavailable ? 'true' : null,
            tabindex: first ? '0' : '-1',
          },
          h('span', { class: 'seat-code mono' }, esc(seat)),
        );
      }),
    ),
  );
  return [
    h(
      'div',
      { class: 'screening-head' },
      h('h1', { id: 'main-heading', tabindex: '-1', class: 'film-title' }, esc(screening.film_title)),
      h(
        'p',
        { class: 'screening-meta mono' },
        esc(
          `${screening.format} · ${screening.auditorium.code} · ${torontoDate(screening.starts_at)} ${torontoTime(
            screening.starts_at,
          )}`,
        ),
      ),
    ),
    h(
      'div',
      { class: 'screening-body' },
      h(
        'div',
        { class: 'film-notes-column' },
        tel('button', locale, 'film_notes', undefined, {
          type: 'button',
          id: 'film-notes-button',
          class: 'disclosure',
          'aria-expanded': 'false',
          'aria-controls': 'film-notes',
        }),
        h(
          'section',
          { id: 'film-notes', class: 'film-notes', role: 'region', ...labelled(locale, 'film_notes') },
          tel('h2', locale, 'film_notes'),
          h('p', {}, esc(screening.notes)),
          h('p', { class: 'mono' }, esc(`${screening.auditorium.name} · ${screening.auditorium.venue}`)),
        ),
      ),
      h(
        'div',
        { class: 'seat-column' },
        h(
          'p',
          { class: 'seats-remaining mono', id: 'seats-remaining' },
          screening.seats_remaining === 0
            ? text(locale, 'sold_out')
            : text(locale, 'seats_left', { count: screening.seats_remaining }),
        ),
        h(
          'div',
          {
            role: 'grid',
            id: 'seat-map',
            class: 'seat-map',
            ...labelled(locale, 'seat_map'),
            'data-screening': screening.id,
          },
          ...rows,
        ),
        options.signedIn
          ? h(
              'div',
              { class: 'group-toggle' },
              h('input', { type: 'checkbox', id: 'group-booking', class: 'checkbox' }),
              tel('label', locale, 'group_booking', undefined, { for: 'group-booking' }),
            )
          : '',
        tel('button', locale, 'hold_seats', undefined, {
          type: 'button',
          id: 'hold-seats',
          class: 'primary',
        }),
        h('p', {
          id: 'booking-status',
          role: 'status',
          'aria-live': 'polite',
          ...labelled(locale, 'booking_status'),
        }),
        h('p', {
          id: 'booking-error',
          role: 'alert',
          class: 'error-text',
          ...labelled(locale, 'booking_error'),
        }),
      ),
    ),
  ].join('');
}
