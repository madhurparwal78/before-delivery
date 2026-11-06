// Results screen: trains for a route, with class and quota filters that
// update the URL in place, the latest selection wins, and a refresh when the
// business clock reaches an opening or chart time.

import { api, fetchClock, businessNowMs } from './api.js';
import { el, statusRegion, openDialog, prefersReducedMotion, type DialogHandle } from './ui.js';
import { renderShell, setTitle, renderRibbon, getStations, stationName } from './shell.js';
import { stampHHMM, stampWords, formatPaise, travelTime } from './format.js';
import type { QuotaCode, ClassCode } from '../types.js';

interface ClassEntry {
  class: ClassCode; quota: QuotaCode; window: string; opens_at: string;
  avl: number | null; rac: number | null; wl_type: string | null; wl: number | null;
  wl_cap: number | null; label: string; adult_fare_paise: number;
}

export interface TrainEntry {
  number: string; name: string; run_date: string;
  from: { code: string; name: string; departure_at: string };
  to: { code: string; name: string; arrival_at: string };
  stops: { code: string; name: string; km: number; departure_at: string }[];
  chart_at: string; chart_prepared: boolean;
  classes: ClassEntry[];
}

interface SearchState {
  from: string; to: string; date: string; quota: QuotaCode; cls: ClassCode;
  trains: TrainEntry[];
  selected: string | null;
  /** the selection the last request was sent for; only its reply paints */
  latest: { cls: ClassCode; quota: QuotaCode; seq: number };
}

let state: SearchState | null = null;
let requestSeq = 0;
let filtersHandle: DialogHandle | null = null;

function isPhone(): boolean { return window.innerWidth < 768; }

export async function renderResults(): Promise<void> {
  setTitle('Trains');
  const params = new URLSearchParams(location.search);
  const stations = await getStations();
  const from = params.get('from') ?? stations[0].code;
  const to = params.get('to') ?? stations[5].code;
  const date = params.get('date') ?? '';
  const quota = (params.get('quota') ?? 'GN') as QuotaCode;
  const cls = (params.get('class') ?? 'SL') as ClassCode;

  state = {
    from, to, date, quota, cls,
    trains: [], selected: null,
    latest: { cls, quota, seq: 0 },
  };

  const main = el('main', { id: 'main' });
  renderShell(main, { ribbon: ribbonFor([]) });
  main.appendChild(el('h1', {}, `Trains from ${stationName(from)} to ${stationName(to)}`));

  statusRegion('Search result', 'Checking trains');
  document.getElementById('live-regions')!.appendChild(statusRegion('Search result', 'Checking trains'));
  document.getElementById('live-regions')!.appendChild(statusRegion('Availability', ''));

  const summary = el('div', { class: 'panel', id: 'search-summary' });
  main.appendChild(summary);
  const grid = el('div', { class: 'results-grid', id: 'results-grid' });
  main.appendChild(grid);

  const layout = isPhone() ? 'phone' : 'desktop';
  renderFiltersArea(grid, layout);
  const cardsCol = el('div', { id: 'cards-col' });
  grid.appendChild(cardsCol);
  if (layout === 'desktop') grid.appendChild(el('div', { id: 'details-col' }));

  await refreshTrains();
}

function attachRibbon(train: TrainEntry): void {
  const existing = document.querySelector('.ribbon');
  const fresh = ribbonFor(train.stops);
  if (existing) existing.replaceWith(fresh);
  else document.querySelector('.top-bar')?.after(fresh);
}

function ribbonFor(stops: { code: string; name: string; departure_at: string }[]): HTMLElement {
  const ribbonStops = stops.length > 0
    ? stops.map((s) => ({ code: s.code, name: s.name, time: stampHHMM(s.departure_at) }))
    : null;
  if (ribbonStops) {
    return renderRibbon(ribbonStops.map((s, i) => ({ ...s, terminal: i === 0 || i === ribbonStops.length - 1 })));
  }
  return renderRibbon([
    { code: state!.from, name: stationName(state!.from), time: null, terminal: true },
    { code: state!.to, name: stationName(state!.to), time: null, terminal: true },
  ]);
}

/** Replace the current history entry so Back leaves the results screen. */
function updateUrl(cls: ClassCode, quota: QuotaCode): void {
  const params = new URLSearchParams(location.search);
  params.set('class', cls);
  params.set('quota', quota);
  const url = `${location.pathname}?${params.toString()}`;
  history.replaceState(null, '', url);
}

async function refreshTrains(announceAvailability = false): Promise<void> {
  const s = state!;
  requestSeq += 1;
  const seq = requestSeq;
  const cls = s.cls;
  const quota = s.quota;
  statusRegion('Search result', 'Checking trains');
  try {
    const params = new URLSearchParams({
      from: s.from, to: s.to, date: s.date, quota, class: cls,
    });
    const d = await api<{ trains: TrainEntry[] }>('GET', `/api/trains?${params.toString()}`);
    // Only the reply for the latest selection may paint.
    if (seq !== requestSeq || cls !== state!.cls || quota !== state!.quota) return;
    s.trains = d.trains;
    const sel = d.trains.find((t) => t.number === s.selected) ?? d.trains[0];
    if (sel) attachRibbon(sel);
    renderCards();
    if (d.trains.length === 0) {
      statusRegion('Search result', `No trains run between ${stationName(s.from)} and ${stationName(s.to)} on ${stampWords(dateToStamp(s.date))}.`);
    } else {
      statusRegion('Search result', `${d.trains.length} trains from ${stationName(s.from)} to ${stationName(s.to)} on ${stampWords(dateToStamp(s.date))}`);
      if (isDesktop() && s.selected === null) {
        s.selected = d.trains[0].number;
      }
      renderSelection();
      if (announceAvailability) {
        announceAvail();
      }
    }
    scheduleClockRefresh();
  } catch {
    // leave the last painted state; a poll will retry at the next boundary
  }
}

function dateToStamp(date: string): string {
  return `${date}T00:00:00+05:30`;
}

function isDesktop(): boolean { return window.innerWidth >= 1200; }

function entryOf(train: TrainEntry): ClassEntry {
  const e = train.classes.find((c) => c.class === state!.cls && c.quota === state!.quota);
  return e ?? train.classes[0];
}

function renderFiltersArea(grid: HTMLElement, layout: 'phone' | 'desktop'): void {
  const filtersCol = el('div', { id: 'filters-col' });
  if (layout === 'phone') {
    const btn = el('button', { class: 'filters-btn', 'aria-haspopup': 'dialog' }, 'Filters');
    btn.addEventListener('click', () => openFiltersDialog(btn));
    filtersCol.appendChild(btn);
  } else {
    filtersCol.appendChild(buildRadios());
  }
  grid.insertBefore(filtersCol, grid.firstChild);
}

function buildRadios(): HTMLElement {
  const wrap = el('div', {});
  const classFs = el('fieldset');
  classFs.setAttribute('role', 'radiogroup');
  classFs.setAttribute('aria-label', 'Class');
  const classRadios = el('div', { class: 'radios' });
  for (const [code, label] of [['SL', 'Sleeper (SL)'], ['3A', 'AC 3 Tier (3A)']] as [ClassCode, string][]) {
    const id = `cls-${code}`;
    const input = el('input', { type: 'radio', id, name: 'cls', value: code });
    input.setAttribute('aria-label', label);
    if (code === state!.cls) input.checked = true;
    input.addEventListener('change', () => changeSelection(code, state!.quota));
    const lab = el('label', { for: id }, label);
    classRadios.appendChild(input);
    classRadios.appendChild(lab);
  }
  classFs.appendChild(classRadios);
  wrap.appendChild(classFs);

  const quotaFs = el('fieldset');
  quotaFs.setAttribute('role', 'radiogroup');
  quotaFs.setAttribute('aria-label', 'Quota');
  const quotaRadios = el('div', { class: 'radios' });
  for (const [code, label] of [['GN', 'General'], ['TQ', 'Tatkal'], ['LD', 'Ladies'], ['SS', 'Senior']] as [QuotaCode, string][]) {
    const id = `qta-${code}`;
    const input = el('input', { type: 'radio', id, name: 'quota', value: code });
    input.setAttribute('aria-label', label);
    if (code === state!.quota) input.checked = true;
    input.addEventListener('change', () => changeSelection(state!.cls, code));
    const lab = el('label', { for: id }, label);
    quotaRadios.appendChild(input);
    quotaRadios.appendChild(lab);
  }
  quotaFs.appendChild(quotaRadios);
  wrap.appendChild(quotaFs);
  return wrap;
}

function changeSelection(cls: ClassCode, quota: QuotaCode): void {
  state!.cls = cls;
  state!.quota = quota;
  requestSeq += 1; // any in-flight reply is now stale
  updateUrl(cls, quota);
  syncRadios();
  refreshTrains(true);
  if (filtersHandle) {
    // the list behind the sheet updates under the latest-selection rule
  }
}

function syncRadios(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="cls"]').forEach((r) => {
    r.checked = r.value === state!.cls;
  });
  document.querySelectorAll<HTMLInputElement>('input[name="quota"]').forEach((r) => {
    r.checked = r.value === state!.quota;
  });
}

let filtersOpener: HTMLElement | null = null;

function openFiltersDialog(opener: HTMLElement): void {
  filtersOpener = opener;
  const handle = openDialog((dlg) => {
    dlg.setAttribute('aria-label', 'Filters');
    const h = el('h2', {}, 'Filters');
    dlg.appendChild(h);
    dlg.appendChild(buildRadios());
    const actions = el('div', { class: 'dialog-actions' });
    const close = el('button', { class: 'btn-primary' }, 'Close filters');
    close.addEventListener('click', () => {
      handle.close();
      opener.focus();
    });
    actions.appendChild(close);
    dlg.appendChild(actions);
  }, opener, 'input[type="radio"]');
  filtersHandle = handle;
}

function renderCards(): void {
  const s = state!;
  const col = document.getElementById('cards-col')!;
  col.innerHTML = '';
  const list = el('ul', { 'aria-label': 'Trains' });
  for (const t of s.trains) {
    const entry = entryOf(t);
    const li = el('li', { 'data-train': t.number });
    const card = el('div', { class: 'train-card' + (s.selected === t.number ? ' selected' : '') });
    const row1 = el('div', { class: 'row1' });
    const heading = el('h2', {}, `${t.number} ${t.name}`);
    heading.setAttribute('aria-label', `${t.number} ${t.name}`);
    row1.appendChild(heading);
    const avail = el('span', { class: 'avail' }, entry.label);
    row1.appendChild(avail);
    card.appendChild(row1);
    const meta = el('div', { class: 'meta' });
    meta.textContent = `${stampHHMM(t.from.departure_at)} → ${stampHHMM(t.to.arrival_at)} · ${travelTime(t.from.departure_at, t.to.arrival_at)} · chart ${stampHHMM(t.chart_at)} · adult ${formatPaise(entry.adult_fare_paise)}`;
    card.appendChild(meta);
    const links = el('div', { class: 'links' });
    const detailsBtn = el('button', { class: 'details-btn' }, `Show details ${t.number}`);
    detailsBtn.addEventListener('click', () => {
      s.selected = t.number;
      renderCards();
      renderSelection();
      announceAvail();
    });
    links.appendChild(detailsBtn);
    if (entry.window === 'open') {
      const book = el('a', { href: bookingHref(t) }, `Book ${t.number} ${state!.cls}`);
      links.appendChild(book);
    }
    card.appendChild(links);

    // phone and tablet: the selected card opens its details inside the card
    if (!isDesktop() && s.selected === t.number) {
      card.appendChild(renderTrainDetails(t));
    }
    li.appendChild(card);
    list.appendChild(li);
  }
  col.appendChild(list);
}

function bookingHref(t: TrainEntry): string {
  const params = new URLSearchParams({
    train: t.number, run_date: t.run_date, from: state!.from, to: state!.to,
    class: state!.cls, quota: state!.quota,
  });
  return `/book?${params.toString()}`;
}

function renderSelection(): void {
  const s = state!;
  if (isDesktop()) {
    renderCards();
    const detailsCol = document.getElementById('details-col');
    if (detailsCol) {
      detailsCol.innerHTML = '';
      const region = el('div', { role: 'region', 'aria-label': 'Train details' });
      const t = s.trains.find((x) => x.number === s.selected);
      if (t) region.appendChild(renderTrainDetails(t));
      detailsCol.appendChild(region);
    }
  } else {
    renderCards();
  }
}

function renderTrainDetails(t: TrainEntry): HTMLElement {
  const wrap = el('div', { class: 'panel' });
  const entry = entryOf(t);
  wrap.appendChild(el('h3', {}, `Train details`));
  const dl = el('dl', { class: 'kv' });
  const add = (k: string, v: string) => {
    dl.appendChild(el('dt', {}, k));
    dl.appendChild(el('dd', {}, v));
  };
  add('Availability', entry.label);
  add('Chart', `${stampHHMM(t.chart_at)}`);
  add('Booking window', entry.window === 'open' ? 'open' : (entry.window === 'chart_prepared' ? 'chart prepared' : `opens ${stampWords(entry.opens_at)}`));
  wrap.appendChild(dl);
  // coach plan preview: a link to the booking page carries the stretch
  const queueLane = el('div', { class: 'queue-cols' });
  queueLane.appendChild(el('div', { class: 'queue-lane' }, `WL lane: ${entry.wl ?? 0} · RAC lane: ${entry.rac ?? 0}`));
  wrap.appendChild(queueLane);
  return wrap;
}

function announceAvail(): void {
  const s = state!;
  const t = s.trains.find((x) => x.number === s.selected);
  if (!t) return;
  const entry = entryOf(t);
  const quotaLabel = ({ GN: 'General', TQ: 'Tatkal', LD: 'Ladies', SS: 'Senior' } as Record<string, string>)[s.quota];
  statusRegion('Availability', `${t.number} ${s.cls} ${quotaLabel}: ${entry.label}`);
}

/** Refresh within 5 real seconds of the next opening or chart time among the
 * cards shown, reading the clock from the server, never the device date. */
let refreshTimer: number | null = null;

function scheduleClockRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  const s = state!;
  let earliestBusinessMs = Infinity;
  for (const t of s.trains) {
    const entry = entryOf(t);
    for (const stamp of [entry.opens_at, t.chart_at]) {
      const ms = Date.parse(stamp.replace('+05:30', 'Z'));
      if (ms > businessNowMs()) earliestBusinessMs = Math.min(earliestBusinessMs, ms);
    }
  }
  if (earliestBusinessMs === Infinity) return;
  const rate = Math.max(1, window.__pakkaClockRate ?? 1);
  const realDelayMs = (earliestBusinessMs - businessNowMs()) / rate + 300;
  refreshTimer = window.setTimeout(() => {
    void refreshTrains(true);
  }, Math.max(50, Math.min(realDelayMs, 60 * 60 * 1000)));
}
