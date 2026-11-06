import type { ClassEntry, QuotaCode, TrainEntry, TravelClass } from '../api';
import { api } from '../api';
import { CoachPlanView } from '../coachplan';
import { LiveRegion, Modal, icon, ribbonStopsFromTrain } from '../components';
import { clear, h, isDesktopWidth, isPhoneWidth } from '../dom';
import { QUOTA_LABEL, formatMoney, hourMinute, longDate } from '../format';
import type { Screen, ScreenContext } from '../screen';
import { quotaRadios } from './search';

const CLASS_LABEL: Readonly<Record<TravelClass, string>> = {
  SL: 'Sleeper (SL)',
  '3A': 'AC 3 Tier (3A)',
};

interface Selection {
  travelClass: TravelClass;
  quota: QuotaCode;
}

function classRadios(
  selected: TravelClass,
  onChange: (value: TravelClass) => void,
  idPrefix: string,
): HTMLElement {
  const row = h('div', { class: 'radio-row' });
  for (const value of ['SL', '3A'] as const) {
    const id = `${idPrefix}-class-${value}`;
    const input = h('input', {
      type: 'radio',
      name: `${idPrefix}-class`,
      id,
      value,
      checked: value === selected,
    });
    input.addEventListener('change', () => onChange(value));
    row.appendChild(h('span', { class: 'radio' }, [
      input,
      h('label', { for: id }, [CLASS_LABEL[value]]),
    ]));
  }
  return h('fieldset', { role: 'radiogroup', 'aria-label': 'Class' }, [
    h('legend', {}, ['Class']),
    row,
  ]);
}

function travelTime(from: string, to: string): string {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function entryFor(train: TrainEntry, selection: Selection): ClassEntry | undefined {
  return train.classes.find((entry) => entry.class === selection.travelClass);
}

export async function renderResults(context: ScreenContext): Promise<Screen> {
  const { main, url, router, state } = context;
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  const date = url.searchParams.get('date') ?? '';
  const selection: Selection = {
    travelClass: url.searchParams.get('class') === '3A' ? '3A' : 'SL',
    quota: (url.searchParams.get('quota') ?? 'GN') as QuotaCode,
  };

  const searchStatus = new LiveRegion('Search result', 'status');
  const availabilityStatus = new LiveRegion('Availability', 'status');
  const trainList = h('ol', { class: 'plain-list', 'aria-label': 'Trains' });
  const detailsPane = h('div');
  const filtersSlot = h('div');
  const filtersButtonSlot = h('div');

  let trains: TrainEntry[] = [];
  let selectedTrain: string | null = null;
  let token = 0;
  let sheet: Modal | null = null;
  let detailsHost: HTMLElement | null = null;
  let planView: CoachPlanView | null = null;
  let loadedPlanKey = '';

  const phone = (): boolean => isPhoneWidth();

  const selectionKey = (): string => `${selection.travelClass}/${selection.quota}`;

  const fromName = (): string =>
    state.stations.find((station) => station.code === from)?.name ?? from;
  const toName = (): string =>
    state.stations.find((station) => station.code === to)?.name ?? to;

  function announceAvailability(): void {
    if (selectedTrain === null) return;
    const train = trains.find((entry) => entry.number === selectedTrain);
    if (train === undefined) return;
    const entry = entryFor(train, selection);
    if (entry === undefined) return;
    availabilityStatus.say(
      `${train.number} ${selection.travelClass} ${QUOTA_LABEL[selection.quota]}: ${entry.label}`,
    );
  }

  function paintRibbon(): void {
    const train = trains.find((entry) => entry.number === selectedTrain) ?? trains[0];
    if (train === undefined) {
      const stops = [from, to]
        .map((code) => state.stations.find((station) => station.code === code))
        .filter((station): station is { code: string; name: string } => station !== undefined)
        .map((station) => ({ code: station.code, name: station.name, time: null, emphasis: true }));
      context.setRibbon(stops);
      return;
    }
    context.setRibbon(ribbonStopsFromTrain(train.stops, from, to));
  }

  async function loadPlan(train: TrainEntry): Promise<void> {
    const key = `${train.number}/${train.run_date}/${selection.travelClass}`;
    if (key === loadedPlanKey || planView === null) return;
    loadedPlanKey = key;
    const query = new URLSearchParams({ class: selection.travelClass, from, to }).toString();
    const body = await api.coaches(train.number, train.run_date, query).catch(() => null);
    if (body === null || planView === null) return;
    planView.setCoaches(body.coaches);
  }

  function renderDetails(): void {
    clear(detailsPane);
    if (selectedTrain === null) return;
    const train = trains.find((entry) => entry.number === selectedTrain);
    if (train === undefined) return;
    const entry = entryFor(train, selection);
    planView = new CoachPlanView({
      vertical: phone(),
      annotations: new Map(),
      onPick: null,
      note: false,
    });
    loadedPlanKey = '';
    const lanes = h('div', { class: 'lanes', role: 'region', 'aria-label': 'Queue' }, [
      h('div', { class: 'lane' }, [
        h('h3', {}, ['WL lane']),
        h('p', { class: 'num' }, [
          entry?.wl_type === null || entry === undefined
            ? 'No waiting list'
            : `${entry.wl_type} ${entry.wl ?? 0} of ${entry.wl_cap ?? 0}`,
        ]),
      ]),
      h('div', { class: 'lane' }, [
        h('h3', {}, ['RAC lane']),
        h('p', { class: 'num' }, [
          entry?.rac === null || entry === undefined ? 'No RAC' : `${entry.rac} places free`,
        ]),
      ]),
    ]);
    detailsPane.appendChild(h('section', {
      class: 'panel',
      role: 'region',
      'aria-label': 'Train details',
    }, [
      h('h3', {}, [`${train.number} ${train.name}`]),
      h('p', { class: 'avail' }, [entry?.label ?? '']),
      planView.element,
      lanes,
    ]));
    void loadPlan(train);
  }

  function renderCards(): void {
    clear(trainList);
    for (const train of trains) {
      const entry = entryFor(train, selection);
      const selected = train.number === selectedTrain;
      const item = h('li', {
        class: `train-card${selected ? ' train-card--selected' : ''}`,
      });
      item.appendChild(h('h3', {}, [`${train.number} ${train.name}`]));
      item.appendChild(h('div', { class: 'train-card__row' }, [
        h('span', { class: 'num' }, [
          `${hourMinute(train.from.departure_at)} ${train.from.code}`,
        ]),
        h('span', {}, [icon('arrow-right')]),
        h('span', { class: 'num' }, [`${hourMinute(train.to.arrival_at)} ${train.to.code}`]),
        h('span', { class: 'num' }, [
          travelTime(train.from.departure_at, train.to.arrival_at),
        ]),
      ]));
      item.appendChild(h('p', { class: 'num' }, [
        `Chart at ${hourMinute(train.chart_at)} IST, ${longDate(train.chart_at)}`,
      ]));
      item.appendChild(h('p', { class: 'avail' }, [entry?.label ?? '']));
      if (entry !== undefined) {
        item.appendChild(h('p', { class: 'num' }, [
          `Fare per adult ${formatMoney(entry.adult_fare_paise)}`,
        ]));
      }
      const actions = h('div', { class: 'card-actions' });
      const show = h('button', { type: 'button', class: 'btn--quiet btn' }, [
        `Show details ${train.number}`,
      ]);
      show.addEventListener('click', () => {
        selectedTrain = train.number;
        paint();
        announceAvailability();
      });
      actions.appendChild(show);
      if (entry !== undefined && entry.window === 'open') {
        const params = new URLSearchParams({
          train: train.number,
          run_date: train.run_date,
          from,
          to,
          class: selection.travelClass,
          quota: selection.quota,
        });
        const link = h('a', { class: 'btn', href: `/book?${params.toString()}` }, [
          `Book ${train.number} ${selection.travelClass}`,
        ]);
        link.addEventListener('click', (event) => {
          event.preventDefault();
          router.go(`/book?${params.toString()}`);
        });
        actions.appendChild(link);
      }
      item.appendChild(actions);
      if (selected && !isDesktopWidth()) item.appendChild(detailsPane);
      trainList.appendChild(item);
    }
  }

  function filterControls(idPrefix: string): HTMLElement {
    return h('div', { class: 'stack' }, [
      classRadios(selection.travelClass, (value) => {
        selection.travelClass = value;
        onSelectionChange();
      }, idPrefix),
      quotaRadios(selection.quota, (value) => {
        selection.quota = value;
        onSelectionChange();
      }, idPrefix),
    ]);
  }

  function openSheet(): void {
    const close = h('button', { type: 'button', class: 'btn--quiet btn' }, ['Close filters']);
    const controls = filterControls('sheet');
    sheet = new Modal({
      label: 'Filters',
      onClose: () => {
        sheet = null;
      },
      initialFocus: () => controls.querySelector<HTMLElement>('input[type="radio"]'),
    }, [h('h2', {}, ['Filters']), controls, h('div', { class: 'dialog__actions' }, [close])]);
    close.addEventListener('click', () => sheet?.close());
  }

  function paintFilters(): void {
    clear(filtersSlot);
    clear(filtersButtonSlot);
    if (phone()) {
      const button = h('button', { type: 'button', class: 'btn--quiet btn' }, [
        icon('sliders-horizontal'),
        'Filters',
      ]);
      button.setAttribute('aria-label', 'Filters');
      button.addEventListener('click', openSheet);
      filtersButtonSlot.appendChild(button);
      return;
    }
    filtersSlot.appendChild(h('div', { class: 'panel' }, [filterControls('inline')]));
  }

  function paint(): void {
    renderDetails();
    renderCards();
    if (isDesktopWidth() && detailsHost !== null && detailsPane.parentElement !== detailsHost) {
      detailsHost.appendChild(detailsPane);
    }
    paintRibbon();
  }

  function updateUrl(): void {
    const params = new URLSearchParams({
      from,
      to,
      date,
      quota: selection.quota,
      class: selection.travelClass,
    });
    window.history.replaceState({}, '', `/trains?${params.toString()}`);
  }

  async function fetchTrains(announceSearch: boolean): Promise<void> {
    const mine = (token += 1);
    const wanted = selectionKey();
    if (announceSearch) searchStatus.say('Checking trains');
    const query = new URLSearchParams({
      from,
      to,
      date,
      quota: selection.quota,
      class: selection.travelClass,
    }).toString();
    const body = await api.trains(query).catch(() => null);
    if (mine !== token || wanted !== selectionKey() || body === null) return;
    trains = body.trains;
    if (selectedTrain !== null && !trains.some((train) => train.number === selectedTrain)) {
      selectedTrain = null;
    }
    if (selectedTrain === null && isDesktopWidth() && trains.length > 0) {
      selectedTrain = trains[0].number;
    }
    paint();
    if (announceSearch) {
      searchStatus.say(trains.length === 0
        ? `No trains run between ${fromName()} and ${toName()} on ${longDate(date)}.`
        : `${trains.length} trains from ${fromName()} to ${toName()} on ${longDate(date)}`);
    }
    announceAvailability();
  }

  function onSelectionChange(): void {
    updateUrl();
    void fetchTrains(false);
  }

  const summary = h('div', { class: 'panel' }, [
    h('h1', {}, ['Trains']),
    h('p', {}, [`${fromName()} to ${toName()}${date.length > 0 ? ` \u00b7 ${longDate(date)}` : ''}`]),
    filtersButtonSlot,
    searchStatus.element,
    availabilityStatus.element,
  ]);

  const listPane = h('div', {}, [trainList]);
  const detailsWrapper = h('div', { class: 'pane--details pane--sticky' });
  const layout = h('div', { class: 'layout layout--results' }, [
    filtersSlot,
    listPane,
    detailsWrapper,
  ]);
  detailsHost = detailsWrapper;

  main.append(summary, layout);
  paintFilters();
  await fetchTrains(true);

  let lastEdge = state.clock.ready ? state.clock.now() : 0;
  const clockTimer = window.setInterval(() => {
    if (!state.clock.ready || trains.length === 0) return;
    const now = state.clock.now();
    const edges: number[] = [];
    for (const train of trains) {
      const entry = entryFor(train, selection);
      if (entry !== undefined) edges.push(Date.parse(entry.opens_at));
      edges.push(Date.parse(train.chart_at));
    }
    if (edges.some((edge) => edge <= now && edge > lastEdge)) {
      lastEdge = now;
      void fetchTrains(false);
    }
  }, 1_000);

  const onResize = (): void => {
    paintFilters();
    if (sheet !== null && !phone()) sheet.close();
    paint();
  };
  window.addEventListener('resize', onResize);

  return {
    ribbon: [],
    cleanup: () => {
      window.clearInterval(clockTimer);
      window.removeEventListener('resize', onResize);
      sheet?.close();
    },
  };
}
