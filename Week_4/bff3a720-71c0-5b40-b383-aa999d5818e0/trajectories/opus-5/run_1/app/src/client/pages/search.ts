import { announce } from '../announce.js';
import { api } from '../api.js';
import { copy, rides as rideCount, seats as seatWord } from '../copy.js';
import { clear, h } from '../dom.js';
import { money } from '../../shared/format.js';
import { timeLabel } from '../../shared/zoned.js';
import { runMotion } from '../motion.js';
import { plate } from '../plates.js';
import { onLeave, replaceQuery, type RouteContext } from '../router.js';
import { mainRegion } from '../shell.js';
import { pageConfig, serverToday, setServerNow } from '../state.js';
import { armShutter } from '../transition.js';
import { openDialog } from '../components/dialog.js';
import { searchForm, type SearchFormState } from '../components/searchform.js';
import type { SearchRide } from '../types.js';

type Sort = 'earliest' | 'price' | 'shortest';

interface Filters {
  instant: boolean;
  verified: boolean;
  sort: Sort;
}

interface Group {
  name: 'Morning' | 'Afternoon' | 'Evening';
  ride: SearchRide[];
}

const GROUP_PLATES: Array<{ kind: 'road' | 'coast' | 'fields'; ratio: number; span: string }> = [
  { kind: 'road', ratio: 0.75, span: 'plate-tall-left' },
  { kind: 'coast', ratio: 2.2, span: 'plate-wide-right' },
  { kind: 'fields', ratio: 0.75, span: 'plate-tall-left' },
];

function groupOf(boardingIso: string): Group['name'] {
  const hour = Number(timeLabel(boardingIso).slice(0, 2));
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

function queryString(form: SearchFormState, filters: Filters): string {
  const query = new URLSearchParams({
    from: form.from,
    to: form.to,
    date: form.date,
    seats: String(form.seats),
  });
  if (filters.instant) query.set('instant', '1');
  if (filters.verified) query.set('verified', '1');
  if (filters.sort !== 'earliest') query.set('sort', filters.sort);
  return query.toString();
}

export function renderSearch(ctx: RouteContext): void {
  const main = mainRegion();
  clear(main);

  const form: SearchFormState = {
    from: ctx.query.get('from') ?? 'Kestrevel',
    to: ctx.query.get('to') ?? 'Tollemarch',
    date: ctx.query.get('date') ?? serverToday(),
    seats: Number(ctx.query.get('seats') ?? '1') || 1,
  };
  const filters: Filters = {
    instant: ctx.query.get('instant') === '1',
    verified: ctx.query.get('verified') === '1',
    sort: (ctx.query.get('sort') as Sort) ?? 'earliest',
  };

  let latest: SearchRide[] = [];
  let showCountButton: HTMLButtonElement | null = null;
  let timer = 0;
  onLeave(() => window.clearTimeout(timer));

  const resultsBox = h('div', { class: 'results' });
  const alertSlot = h('div', { class: 'alert-slot' });

  const filtersButton = h('button', {
    type: 'button',
    class: 'filters-button',
    text: 'Filters',
  });

  const paint = () => {
    clear(resultsBox);
    if (latest.length === 0) {
      resultsBox.append(
        plate({
          seed: 'empty-search',
          leg: `${form.from} to ${form.to}`,
          kind: 'fields',
          ratio: 1,
          className: 'plate-empty',
        }),
        h('p', { class: 'empty-line', text: copy.noRides }),
      );
      return;
    }
    const groups: Group[] = [
      { name: 'Morning', ride: [] },
      { name: 'Afternoon', ride: [] },
      { name: 'Evening', ride: [] },
    ];
    for (const ride of latest) {
      const group = groups.find((candidate) => candidate.name === groupOf(ride.boarding_time));
      group?.ride.push(ride);
    }
    let shown = 0;
    for (const group of groups) {
      if (group.ride.length === 0) continue;
      const style = GROUP_PLATES[shown % GROUP_PLATES.length] as (typeof GROUP_PLATES)[number];
      const section = h('section', { class: `results-group ${style.span}` });
      section.appendChild(
        plate({
          seed: `${group.name}-${form.from}-${form.to}`,
          leg: `${form.from} to ${form.to}`,
          kind: style.kind,
          ratio: style.ratio,
        }),
      );
      const list = h('ul', { class: 'ride-list', 'aria-label': `${group.name} rides` });
      for (const ride of group.ride) {
        const label =
          `${timeLabel(ride.boarding_time)} ${ride.from} to ${ride.to}, ` +
          `${seatWord(ride.seats_left)} left, ${money(ride.segment_price_cents)}`;
        const link = h('a', {
          href: `/rides/${ride.id}?from=${encodeURIComponent(ride.from)}&to=${encodeURIComponent(
            ride.to,
          )}`,
          'data-id': ride.id,
          class: 'ride-entry',
          text: label,
          onclick: () => armShutter(),
        });
        list.appendChild(h('li', { 'data-id': ride.id }, link));
      }
      section.appendChild(list);
      resultsBox.appendChild(section);
      runMotion(list, 'result-reveal');
      shown += 1;
    }
  };

  const run = async (speak: boolean) => {
    const result = await api<{ rides: SearchRide[]; server_now: string }>(
      'GET',
      `/api/rides/search?${queryString(form, filters)}`,
    );
    if (!result.ok) {
      alertSlot.setAttribute('role', 'alert');
      alertSlot.textContent = result.failure.message;
      return;
    }
    alertSlot.removeAttribute('role');
    alertSlot.textContent = '';
    setServerNow(result.data.server_now);
    latest = result.data.rides;
    paint();
    if (showCountButton) showCountButton.textContent = `Show ${rideCount(latest.length)}`;
    if (speak) {
      announce(latest.length === 0 ? copy.noRides : copy.ridesFound(latest.length));
    }
  };

  const schedule = () => {
    replaceQuery(`/search?${queryString(form, filters)}`);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(true), pageConfig().search_debounce_ms);
  };

  const formHandle = searchForm({
    initial: form,
    withSearchButton: false,
    onChange: (next) => {
      Object.assign(form, next);
      schedule();
    },
  });

  filtersButton.addEventListener('click', () => {
    openDialog({
      name: 'Filters',
      opener: filtersButton,
      sheet: true,
      onClose: () => {
        showCountButton = null;
      },
      build: ({ close }) => {
        const instant = h('input', { type: 'checkbox', 'aria-label': 'Instant booking only' });
        instant.checked = filters.instant;
        instant.addEventListener('change', () => {
          filters.instant = instant.checked;
          schedule();
        });
        const verified = h('input', {
          type: 'checkbox',
          'aria-label': 'Verified drivers only',
        });
        verified.checked = filters.verified;
        verified.addEventListener('change', () => {
          filters.verified = verified.checked;
          schedule();
        });

        const sortBox = h('div', { role: 'radiogroup', 'aria-label': 'Sort by', class: 'sorts' });
        const sortOptions: Array<{ value: Sort; label: string }> = [
          { value: 'earliest', label: 'Earliest departure' },
          { value: 'price', label: 'Lowest price' },
          { value: 'shortest', label: 'Shortest trip' },
        ];
        for (const option of sortOptions) {
          const radio = h('div', {
            role: 'radio',
            'aria-label': option.label,
            'aria-checked': filters.sort === option.value ? 'true' : 'false',
            tabindex: '0',
            class: 'radio',
            text: option.label,
          });
          const choose = () => {
            filters.sort = option.value;
            for (const sibling of sortBox.querySelectorAll('[role="radio"]')) {
              sibling.setAttribute(
                'aria-checked',
                sibling === radio ? 'true' : 'false',
              );
            }
            schedule();
          };
          radio.addEventListener('click', choose);
          radio.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              choose();
            }
          });
          sortBox.appendChild(radio);
        }

        showCountButton = h('button', {
          type: 'button',
          class: 'show-count',
          text: `Show ${rideCount(latest.length)}`,
          onclick: () => close(),
        });

        return [
          h('label', { class: 'check-row' }, instant, h('span', { text: 'Instant booking only' })),
          h('label', { class: 'check-row' }, verified, h('span', { text: 'Verified drivers only' })),
          sortBox,
          showCountButton,
        ];
      },
    });
  });

  main.append(
    h('div', { class: 'results-top' }, formHandle.element, filtersButton, alertSlot),
    resultsBox,
  );
  void run(true);
}
