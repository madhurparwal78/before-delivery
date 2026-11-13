import { AMENITIES, Cur, SearchResponse, SortKey } from '../../shared/types';
import { api } from '../api';
import { Route, frame, navigate, onEvent, rateLimitedNotice } from '../app';
import { el, money, openDialog } from '../dom';
import { amount, decimal1, dayMonth, longDate, m, t } from '../i18n';
import { sheetOpen } from '../motion';
import { state } from '../state';
import { Destination, childAgeSelect, destinationCombobox, spinbutton } from '../components/controls';
import { openDatePicker } from '../components/datepicker';
import { MapPin, MapView, mapRegion } from '../components/map';
import { displayControls } from '../components/display';

let previousPageHref: string | null = null;
let centreRequest: string | null = null;
let openSheetHandle: { close: () => void; sheet: string } | null = null;

interface Context {
  destination: Destination | null;
  destinations: Destination[];
}

function paramsOf(route: Route): URLSearchParams {
  return new URLSearchParams(route.query);
}

function hrefOf(params: URLSearchParams): string {
  return `/search?${params.toString()}`;
}

function noticeText(notice: SearchResponse['notices'][number], zone: string): string {
  const params: Record<string, string | number> = {};
  if (notice.name !== undefined) params.name = notice.name;
  if (notice.date !== undefined) params.date = longDate(notice.date, zone);
  if (notice.n !== undefined) params.n = notice.n;
  if (notice.value !== undefined) params.value = notice.value;
  return m(notice.key, params);
}

export async function searchPage(main: HTMLElement, route: Route): Promise<void> {
  const params = paramsOf(route);
  const destinations = await api<Destination[]>('/api/destinations');
  const context: Context = {
    destinations,
    destination: destinations.find((d) => d.code === params.get('dest')) ?? null,
  };
  const zone = context.destination?.zone ?? 'UTC';

  const rowsRegion = el('div', { class: 'results', 'aria-busy': 'true' });
  const heading = el('h1', { tabindex: '-1', 'data-results-heading': 'true', class: 'results-heading' }, [
    t('ui.results'),
  ]);
  const formHolder = el('div', { class: 'form-holder' });
  main.append(formHolder, heading);

  let current = paramsOf(route);
  const update = async (mutate: (next: URLSearchParams) => void, push: boolean): Promise<void> => {
    const next = new URLSearchParams(current);
    mutate(next);
    const focusKey = (document.activeElement as HTMLElement | null)?.getAttribute('data-focus-key') ?? null;
    const scrollY = window.scrollY;
    await navigate(hrefOf(next), push ? 'push' : 'replace');
    window.scrollTo({ top: scrollY });
    if (focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  };

  let result: SearchResponse;
  try {
    result = await api<SearchResponse>(`/api/search?${params.toString()}`);
  } catch (err) {
    rowsRegion.removeAttribute('aria-busy');
    if (rateLimitedNotice(err)) return;
    throw err;
  }
  rowsRegion.removeAttribute('aria-busy');

  if (result.canonical !== params.toString()) {
    history.replaceState(history.state, '', `/search?${result.canonical}`);
  }
  // Every control reads the canonical settings the server answered with.
  const canonical = new URLSearchParams(result.canonical);
  current = canonical;
  formHolder.append(buildForm(context, canonical, update));
  frame.regions.linkNotice.textContent = result.notices.map((notice) => noticeText(notice, zone)).join(' ');
  frame.regions.search.textContent = m('count.found', { n: result.count });

  const currency = (canonical.get('cur') ?? state.cur) as Cur;
  const controls = buildDisplayControls(canonical, update);
  const filters = buildFilters(result, canonical, update);
  const mapPanel = buildMap(result, canonical, update, currency, context.destination);
  const rows = buildRows(result, canonical, currency);
  rowsRegion.append(...rows);

  const paging = el('div', { class: 'paging' });
  if (canonical.get('cursor') && previousPageHref) {
    const previous = el('a', { href: previousPageHref, 'data-focus-key': 'paging:prev' }, [t('ui.prev_page')]);
    previous.addEventListener('click', (event) => {
      event.preventDefault();
      history.back();
    });
    paging.append(previous);
  }
  if (result.next_cursor) {
    const nextParams = new URLSearchParams(canonical);
    nextParams.set('cursor', result.next_cursor);
    const next = el('a', { href: hrefOf(nextParams), 'data-focus-key': 'paging:next' }, [t('ui.next_page')]);
    next.addEventListener('click', (event) => {
      event.preventDefault();
      previousPageHref = hrefOf(canonical);
      void update((query) => query.set('cursor', result.next_cursor as string), true);
    });
    paging.append(next);
  }

  const phone = window.innerWidth < 768;
  if (phone) {
    const filtersButton = el('button', { type: 'button', 'data-focus-key': 'sheet:filters' }, [t('ui.filters')]);
    const mapButton = el('button', { type: 'button', 'data-focus-key': 'sheet:map' }, [t('ui.map')]);
    filtersButton.addEventListener('click', () => openSheet(t('ui.filters'), filtersButton, filters, 'filters'));
    mapButton.addEventListener('click', () => openSheet(t('ui.map'), mapButton, mapPanel, 'map'));
    main.append(
      controls,
      el('div', { class: 'sheet-buttons' }, [filtersButton, mapButton]),
      result.count === 0 ? emptyResults() : rowsRegion,
      paging,
    );
  } else {
    main.append(
      controls,
      el('div', { class: 'search-columns' }, [
        el('div', { class: 'column-filters' }, [filters]),
        el('div', { class: 'column-rows' }, [result.count === 0 ? emptyResults() : rowsRegion, paging]),
        el('div', { class: 'column-map' }, [mapPanel]),
      ]),
    );
  }

  const entry = history.state as { scrollY?: number; focusKey?: string | null } | null;
  if (!entry || (!entry.focusKey && !entry.scrollY)) heading.focus();

  onEvent('availability', (data) => {
    if (context.destination && data.property) {
      void (async () => {
        const focusKey = (document.activeElement as HTMLElement | null)?.getAttribute('data-focus-key') ?? null;
        const scrollY = window.scrollY;
        await navigate(hrefOf(canonical), 'none');
        window.scrollTo({ top: scrollY });
        if (focusKey) document.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
      })();
    }
  });
}

function openSheet(name: string, opener: HTMLElement, content: HTMLElement, sheet: string): void {
  const handle = openDialog(
    { name, opener, sheet, className: 'sheet', onClose: () => (openSheetHandle = null) },
    (body, dialog) => {
      body.append(content);
      sheetOpen(dialog.root);
    },
  );
  openSheetHandle = { close: handle.close, sheet };
}

function emptyResults(): HTMLElement {
  return el('div', { class: 'empty' }, [
    el('p', { class: 'huge-word' }, [m('empty.results.word')]),
    el('p', {}, [m('empty.results')]),
  ]);
}

function buildForm(
  context: Context,
  params: URLSearchParams,
  update: (mutate: (next: URLSearchParams) => void, push: boolean) => Promise<void>,
): HTMLElement {
  let destCode = params.get('dest') ?? '';
  let inDate = params.get('in') ?? '';
  let outDate = params.get('out') ?? '';
  let adults = Number(params.get('adults') ?? '2');
  let ages = (params.get('ages') ?? '')
    .split(',')
    .filter((part) => part !== '')
    .map(Number);

  let zone = context.destinations.find((d) => d.code === destCode)?.zone ?? 'UTC';
  const combobox = destinationCombobox({
    label: t('ui.destination'),
    value: context.destination?.name ?? '',
    focusKey: 'form:dest',
    load: async (text) => api<Destination[]>(`/api/destinations?q=${encodeURIComponent(text)}`),
    onPick: (destination) => {
      destCode = destination.code;
      zone = destination.zone;
      paintDates();
    },
  });

  const datesButton = el('button', { type: 'button', 'data-focus-key': 'form:dates' }, []);
  const paintDates = (): void => {
    const nights =
      inDate && outDate
        ? Math.round((Date.parse(`${outDate}T00:00:00Z`) - Date.parse(`${inDate}T00:00:00Z`)) / 86400000)
        : 0;
    datesButton.textContent =
      inDate && outDate
        ? t('ui.dates_range', {
            in: dayMonth(inDate, zone),
            out: dayMonth(outDate, zone),
            count: nights,
          })
        : t('ui.dates');
  };
  paintDates();
  datesButton.addEventListener('click', () => {
    openDatePicker({
      source: { dest: destCode, zone, cur: (params.get('cur') ?? state.cur) as Cur },
      start: inDate,
      end: outDate,
      opener: datesButton,
      onPicked: (picked, pickedOut) => {
        inDate = picked;
        outDate = pickedOut;
        paintDates();
        datesButton.focus();
      },
    });
  });

  const agesWrap = el('div', { class: 'ages' });
  const paintAges = (): void => {
    agesWrap.replaceChildren(
      ...ages.map((age, index) =>
        childAgeSelect(index + 1, age, (value) => {
          ages[index] = value;
        }),
      ),
    );
  };

  const adultsSpin = spinbutton({
    label: t('ui.adults'),
    min: 1,
    max: 16,
    value: adults,
    focusKey: 'form:adults',
    onChange: (value) => {
      adults = value;
    },
  });
  const childrenSpin = spinbutton({
    label: t('ui.children'),
    min: 0,
    max: 8,
    value: ages.length,
    focusKey: 'form:children',
    onChange: (value) => {
      while (ages.length < value) ages.push(8);
      while (ages.length > value) ages.pop();
      paintAges();
    },
  });
  paintAges();

  const searchButton = el('button', { type: 'submit', 'data-focus-key': 'form:search' }, [t('ui.search')]);
  const form = el('form', { class: 'search-form' }, [
    combobox,
    datesButton,
    adultsSpin,
    childrenSpin,
    agesWrap,
    searchButton,
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void update((next) => {
      next.set('dest', destCode);
      if (inDate) next.set('in', inDate);
      if (outDate) next.set('out', outDate);
      next.set('adults', String(adults));
      if (ages.length > 0) next.set('ages', [...ages].sort((a, b) => a - b).join(','));
      else next.delete('ages');
      next.delete('cursor');
    }, true);
  });
  return form;
}

function buildDisplayControls(
  params: URLSearchParams,
  update: (mutate: (next: URLSearchParams) => void, push: boolean) => Promise<void>,
): HTMLElement {
  const controls = displayControls(params, (next) => {
    void update((query) => {
      for (const key of ['display', 'tax']) {
        const value = next.get(key);
        if (value === null) query.delete(key);
        else query.set(key, value);
      }
    }, true);
  });
  const sorts: SortKey[] = ['rank', 'price_asc', 'price_desc', 'score_desc', 'distance_asc'];
  const sort = el(
    'select',
    { 'aria-label': t('ui.sort_by'), 'data-focus-key': 'sort' },
    sorts.map((key) =>
      el('option', { value: key, selected: (params.get('sort') ?? 'rank') === key }, [t(`ui.sort.${key}`)]),
    ),
  );
  sort.addEventListener('change', () => {
    void update((next) => {
      if (sort.value === 'rank') next.delete('sort');
      else next.set('sort', sort.value);
      next.delete('cursor');
    }, true);
  });
  controls.append(sort);
  return controls;
}

function buildFilters(
  result: SearchResponse,
  params: URLSearchParams,
  update: (mutate: (next: URLSearchParams) => void, push: boolean) => Promise<void>,
): HTMLElement {
  const starsSelected = (params.get('stars') ?? '').split(',').filter((part) => part !== '');
  const amenSelected = (params.get('amen') ?? '').split(',').filter((part) => part !== '');

  const checkbox = (
    label: string,
    checked: boolean,
    countValue: number,
    focusKey: string,
    onToggle: (next: boolean) => void,
  ): HTMLElement => {
    const button = el(
      'button',
      {
        type: 'button',
        role: 'checkbox',
        'aria-checked': checked ? 'true' : 'false',
        'data-count': countValue,
        'data-focus-key': focusKey,
        class: 'filter',
      },
      [label],
    );
    button.addEventListener('click', () => onToggle(!checked));
    return button;
  };

  const starsGroup = el('div', { role: 'group', 'aria-label': t('ui.stars') });
  for (const stars of [3, 4, 5]) {
    const checked = starsSelected.includes(String(stars));
    starsGroup.append(
      checkbox(
        t('ui.stars_option', { n: stars, count: result.counts.stars[String(stars)] ?? 0 }),
        checked,
        result.counts.stars[String(stars)] ?? 0,
        `filter:stars:${stars}`,
        (next) => {
          void update((query) => {
            const set = new Set(starsSelected);
            if (next) set.add(String(stars));
            else set.delete(String(stars));
            const list = [...set].sort();
            if (list.length > 0) query.set('stars', list.join(','));
            else query.delete('stars');
            query.delete('cursor');
          }, true);
        },
      ),
    );
  }

  const amenGroup = el('div', { role: 'group', 'aria-label': t('ui.amenities') });
  for (const amenity of AMENITIES) {
    const checked = amenSelected.includes(amenity);
    const amenityCount = result.counts.amen[amenity] ?? 0;
    amenGroup.append(
      checkbox(
        t('ui.option_count', { label: t(`ui.amen.${amenity}`), count: amenityCount }),
        checked,
        amenityCount,
        `filter:amen:${amenity}`,
        (next) => {
          void update((query) => {
            const set = new Set(amenSelected);
            if (next) set.add(amenity);
            else set.delete(amenity);
            const list = [...set].sort();
            if (list.length > 0) query.set('amen', list.join(','));
            else query.delete('amen');
            query.delete('cursor');
          }, true);
        },
      ),
    );
  }

  const cancelGroup = el('div', { role: 'group', 'aria-label': t('ui.cancellation_group') }, [
    checkbox(
      t('ui.option_count', { label: t('ui.free_cancellation'), count: result.counts.free }),
      params.get('free') === '1',
      result.counts.free,
      'filter:free',
      (next) => {
        void update((query) => {
          if (next) query.set('free', '1');
          else query.delete('free');
          query.delete('cursor');
        }, true);
      },
    ),
  ]);

  const lowest = spinbutton({
    label: t('ui.lowest_price'),
    min: 0,
    max: 100000,
    value: Number(params.get('min') ?? '0'),
    focusKey: 'filter:min',
    onChange: (value) => {
      void update((query) => {
        if (value > 0) query.set('min', String(value));
        else query.delete('min');
        query.delete('cursor');
      }, true);
    },
  });
  const highest = spinbutton({
    label: t('ui.highest_price'),
    min: 0,
    max: 100000,
    value: Number(params.get('max') ?? '0'),
    focusKey: 'filter:max',
    onChange: (value) => {
      void update((query) => {
        if (value > 0) query.set('max', String(value));
        else query.delete('max');
        query.delete('cursor');
      }, true);
    },
  });

  const histogram = el('div', { class: 'histogram' });
  result.histogram.forEach((bar, index) => {
    const from = 50 * index;
    const to = 50 * (index + 1);
    const label =
      index === result.histogram.length - 1
        ? t('ui.histogram_last', { from, n: bar.count, count: bar.count })
        : t('ui.histogram_bar', { from, to, n: bar.count, count: bar.count });
    histogram.append(
      el('div', {
        role: 'img',
        'aria-label': label,
        'data-from': bar.from_minor,
        'data-count': bar.count,
        class: 'histogram-bar',
        style: `--bar:${bar.count}`,
      }),
    );
  });

  return el('div', { class: 'filters' }, [starsGroup, amenGroup, cancelGroup, lowest, highest, histogram]);
}

function buildRows(result: SearchResponse, params: URLSearchParams, currency: Cur): HTMLElement[] {
  const selected = params.get('sel');
  return result.results.map((row) => {
    const total = amount(row.display_minor, currency);
    const article = el('article', {
      'aria-label': t('ui.result_row', {
        name: row.name,
        stars: row.stars,
        score: decimal1(row.score),
        distance: decimal1(row.distance_km),
        amount: total,
      }),
      'aria-current': selected === row.code ? 'true' : null,
      'data-code': row.code,
      class: 'result-row',
    });
    const propertyParams = new URLSearchParams(params);
    propertyParams.delete('cursor');
    const link = el(
      'a',
      { href: `/properties/${row.code}?${propertyParams.toString()}`, 'data-focus-key': `row:${row.code}` },
      [row.name],
    );
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void navigate(`/properties/${row.code}?${propertyParams.toString()}`);
    });
    const mapButton = el(
      'button',
      { type: 'button', 'data-focus-key': `row-map:${row.code}` },
      [t('ui.show_on_map', { name: row.name })],
    );
    mapButton.addEventListener('click', () => {
      const next = new URLSearchParams(params);
      next.set('sel', row.code);
      centreRequest = row.code;
      void navigate(`/search?${next.toString()}`);
    });
    article.append(
      el('h2', {}, [link]),
      money(row.display_minor, currency, total, { class: 'row-total' }),
      el('p', { class: 'row-meta' }, [`${row.stars} ★ · ${decimal1(row.score)} · ${decimal1(row.distance_km)} km`]),
      mapButton,
    );
    if (row.refundable) article.append(el('p', { class: 'sage-block' }, [t('ui.refundable')]));
    return article;
  });
}

function buildMap(
  result: SearchResponse,
  params: URLSearchParams,
  update: (mutate: (next: URLSearchParams) => void, push: boolean) => Promise<void>,
  currency: Cur,
  destination: Destination | null,
): HTMLElement {
  const zoom = Number(params.get('zoom') ?? '2');
  const cx = Number(params.get('cx') ?? String(destination?.cx ?? 500));
  const cy = Number(params.get('cy') ?? String(destination?.cy ?? 500));
  const searched: MapView | null =
    params.get('zoom') !== null ? { zoom, cx, cy } : null;
  const pins: MapPin[] = result.pins;
  return mapRegion({
    pins,
    view: { zoom, cx, cy },
    currency,
    selected: params.get('sel'),
    searchedView: searched,
    centreOnSelected: centreRequest !== null && centreRequest === params.get('sel'),
    onSelect: (code) => {
      const inSheet = openSheetHandle?.sheet === 'map';
      if (inSheet) openSheetHandle?.close();
      void update((next) => next.set('sel', code), true).then(() => {
        const row = document.querySelector<HTMLElement>(`.result-row[data-code="${code}"]`);
        row?.scrollIntoView({ block: 'nearest' });
        if (inSheet) document.querySelector<HTMLElement>(`[data-focus-key="row-map:${code}"]`)?.focus();
      });
    },
    onOpen: (code) => {
      const propertyParams = new URLSearchParams(params);
      propertyParams.delete('cursor');
      void navigate(`/properties/${code}?${propertyParams.toString()}`);
    },
    onSearchArea: (view) => {
      void update((next) => {
        next.set('zoom', String(view.zoom));
        next.set('cx', view.cx.toFixed(1));
        next.set('cy', view.cy.toFixed(1));
        next.delete('cursor');
      }, true);
    },
  });
}

