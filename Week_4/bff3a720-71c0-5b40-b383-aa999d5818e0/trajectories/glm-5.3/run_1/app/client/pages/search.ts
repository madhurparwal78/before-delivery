import { h, clear } from '../lib/els.js';
import { router } from '../lib/router.js';
import { store } from '../lib/store.js';
import { api } from '../lib/api.js';
import { announce } from '../lib/announce.js';
import { openDialog } from '../lib/dialog.js';
import { combobox } from '../lib/combobox.js';
import { datePickerButton } from '../lib/datepicker.js';
import { seatsStepper } from '../lib/stepper.js';
import { plate } from '../lib/plates.js';
import { money, hhmm, longDate, count } from '../lib/fmt.js';
import type { SearchRide } from '../lib/types.js';

interface SearchState {
  from: string;
  to: string;
  date: string;
  seats: number;
  instant: boolean;
  verified: boolean;
  sort: 'earliest' | 'price' | 'shortest';
}

function readState(): SearchState {
  const q = router.query;
  const today = todayIso();
  return {
    from: q.get('from') ?? 'Kestrevel',
    to: q.get('to') ?? 'Tollemarch',
    date: q.get('date') ?? today,
    seats: Math.min(4, Math.max(1, Number(q.get('seats') ?? '1') || 1)),
    instant: q.get('instant') === '1',
    verified: q.get('verified') === '1',
    sort: (['earliest', 'price', 'shortest'].includes(q.get('sort') ?? '') ? q.get('sort') : 'earliest') as SearchState['sort'],
  };
}

function todayIso(): string {
  return store.serverNow.slice(0, 10);
}

export function searchPage(): HTMLElement {
  const state = readState();
  const root = h('div', null);
  let debounceTimer: number | undefined;
  let resultCount = -1;

  const runSearch = (): void => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => void doSearch(), store.config.searchDebounceMs);
  };

  const writeUrl = (): void => {
    router.go('/search', {
      from: state.from,
      to: state.to,
      date: state.date,
      seats: String(state.seats),
      instant: state.instant ? '1' : undefined,
      verified: state.verified ? '1' : undefined,
      sort: state.sort === 'earliest' ? undefined : state.sort,
    }, true, true);
  };

  const doSearch = async (): Promise<void> => {
    try {
      const params = new URLSearchParams({ from: state.from, to: state.to, date: state.date, seats: String(state.seats) });
      if (state.instant) params.set('instant', '1');
      if (state.verified) params.set('verified', '1');
      params.set('sort', state.sort);
      const res = await api<{ rides: SearchRide[] }>('GET', `/api/rides/search?${params.toString()}`);
      resultCount = res.rides.length;
      renderResults(res.rides);
      announce(resultCount === 1 ? '1 ride found' : `${resultCount} rides found`);
      writeUrl();
    } catch {
      resultCount = 0;
      renderResults([]);
      announce('No rides match. Try another date.');
    }
  };

  const results = h('div', { class: 'results' });

  const renderResults = (rides: SearchRide[]): void => {
    clear(results);
    if (rides.length === 0) {
      results.append(h('div', { class: 'empty' },
        h('div', { class: 'plate plate-square' }, plate({ seed: 'empty-search', caption: 'No rides', ratio: '1 / 1' })),
        h('p', { class: 'empty-sentence' }, 'No rides match. Try another date.'),
      ));
      return;
    }
    const groups: Array<{ label: string; rides: SearchRide[] }> = [
      { label: 'Morning rides', rides: rides.filter(r => Number(hhmm(r.boarding_time).slice(0, 2)) < 12) },
      { label: 'Afternoon rides', rides: rides.filter(r => { const h = Number(hhmm(r.boarding_time).slice(0, 2)); return h >= 12 && h < 18; }) },
      { label: 'Evening rides', rides: rides.filter(r => Number(hhmm(r.boarding_time).slice(0, 2)) >= 18) },
    ];
    let groupIndex = 0;
    for (const group of groups) {
      if (group.rides.length === 0) continue;
      const wide = groupIndex % 2 === 0;
      results.append(h('section', { class: 'results-group' },
        wide
          ? h('div', { class: 'plate-third' }, plate({ seed: `group-${group.label}`, caption: `${state.from} to ${state.to}, the road out of ${state.from}`, ratio: '4 / 5' }))
          : h('div', { class: 'plate-half-right' }, plate({ seed: `group-${group.label}`, caption: `${state.from} to ${state.to}, the straight past ${state.to}`, ratio: '16 / 10' })),
        h('h2', null, group.label),
        h('ul', { role: 'list', 'aria-label': group.label, class: 'list-plain', 'data-motion': 'result-reveal', 'data-motion-ms': '240', 'data-state': 'running' },
          group.rides.map(r => h('li', { 'data-id': r.id },
            h('a', {
              href: router.href(`/rides/${r.id}`, { from: state.from, to: state.to, seats: String(state.seats) }),
              class: 'result-link',
            }, `${hhmm(r.boarding_time)} ${r.from} to ${r.to}, ${count(r.seats_left, 'seat left', 'seats left')}, ${money(r.segment_price_cents)}`),
          )),
        ),
      ));
      groupIndex++;
    }
  };

  // ----- form -----

  let fromBox: HTMLElement;
  let toBox: HTMLElement;
  let dateBtn: HTMLButtonElement;

  const cities = ['Kestrevel', 'Vardholm', 'Brisanne', 'Oakhythe', 'Tollemarch', 'Saint Ivrel', 'Corrandy', 'Hesketh Mere'];

  const makeSearch = (): void => {
    state.from = fromBox.querySelector('input')?.value || state.from;
    state.to = toBox.querySelector('input')?.value || state.to;
    runSearch();
  };

  fromBox = combobox({
    label: 'Leaving from', towns: cities, value: state.from,
    onSelect: () => { makeSearch(); },
  });
  toBox = combobox({
    label: 'Going to', towns: cities, value: state.to,
    onSelect: () => { makeSearch(); },
  });

  const swap = h('button', { type: 'button', class: 'btn', 'aria-label': 'Swap cities', onClick: () => {
    const tmp = state.from;
    state.from = state.to;
    state.to = tmp;
    const fi = fromBox.querySelector('input');
    const ti = toBox.querySelector('input');
    if (fi) fi.value = state.from;
    if (ti) ti.value = state.to;
    const arrow = swap.querySelector('.swap-arrow');
    arrow?.setAttribute('data-state', 'running');
    window.setTimeout(() => arrow?.setAttribute('data-state', 'done'), 280);
    announce(`Leaving from ${state.from}, going to ${state.to}`);
    makeSearch();
  } },
    h('span', { class: 'swap-arrow', 'aria-hidden': 'true', 'data-motion': 'swap-rotate', 'data-motion-ms': '280', 'data-state': 'done' }, '⇄'),
  );

  dateBtn = datePickerButton({
    selected: state.date,
    today: todayIso(),
    labelForButton: iso => `Date, ${longDate(iso)}`,
    onPick: iso => {
      state.date = iso;
      dateBtn.textContent = `Date, ${longDate(iso)}`;
      makeSearch();
    },
  });

  const seats = seatsStepper(state.seats, 1, 4, v => { state.seats = v; runSearch(); });

  const filtersBtn = h('button', { type: 'button', class: 'btn', onClick: openFilters }, 'Filters');

  const form = h('div', { role: 'search', 'aria-label': 'Find a ride', class: 'search-row' },
    h('div', null, h('label', null, 'Leaving from'), fromBox),
    h('div', null, h('label', null, 'Going to'), toBox),
    h('div', { class: 'swap-cell' }, swap),
    h('div', null, h('label', null, 'Date'), dateBtn),
    h('div', null, h('label', null, 'Seats'), seats),
    h('div', { class: 'filters-cell' }, filtersBtn),
  );

  const searchBtn = h('button', { type: 'button', class: 'btn primary', onClick: () => { makeSearch(); } }, 'Search');
  form.append(searchBtn);

  function openFilters(): void {
    const instantCb = h('input', { type: 'checkbox', checked: state.instant }) as HTMLInputElement;
    instantCb.addEventListener('change', () => { state.instant = instantCb.checked; applyFilters(); });
    const verifiedCb = h('input', { type: 'checkbox', checked: state.verified }) as HTMLInputElement;
    verifiedCb.addEventListener('change', () => { state.verified = verifiedCb.checked; applyFilters(); });
    const radios: Array<HTMLInputElement> = [];
    const radioLines: HTMLElement[] = [];
    for (const [label, value] of [['Earliest departure', 'earliest'], ['Lowest price', 'price'], ['Shortest trip', 'shortest']] as const) {
      const radio = h('input', { type: 'radio', name: 'sort', value, checked: state.sort === value }) as HTMLInputElement;
      radio.addEventListener('change', () => { state.sort = value; applyFilters(); });
      radios.push(radio);
      radioLines.push(h('label', { class: 'radio-line' }, radio, label));
    }
    const applyFilters = (): void => {
      runSearch();
      window.setTimeout(() => {
        const n = resultCount;
        showBtn.textContent = n < 0 ? 'Show rides' : n === 1 ? 'Show 1 ride' : `Show ${n} rides`;
      }, store.config.searchDebounceMs + 150);
    };
    const showBtn = h('button', { type: 'button', class: 'btn primary', 'data-autofocus': true, onClick: () => dialog.close() }, state.seats >= 0 ? 'Show rides' : 'Show rides');
    const dialog = openDialog({ label: 'Filters', sheet: true, onSwipeDown: () => dialog.close() }, [
      h('div', null, h('label', null, instantCb, ' Instant booking only')),
      h('div', null, h('label', null, verifiedCb, ' Verified drivers only')),
      h('div', { role: 'radiogroup', 'aria-label': 'Sort by', class: 'sort-group' }, ...radioLines),
      showBtn,
    ]);
  }

  root.append(form, results);
  void doSearch();
  return root;
}
