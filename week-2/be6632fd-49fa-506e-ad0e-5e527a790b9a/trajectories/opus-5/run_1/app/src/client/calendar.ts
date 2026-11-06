import { STATUS_COPY } from '../domain/copy.ts';
import { formatMarketTime, parseInstant } from '../domain/time.ts';
import { swatchColour } from '../domain/palette.ts';
import { announce } from './feedback.ts';
import { closeDialog, openDialog } from './dialogs.ts';
import { DURATIONS, isMousePointer, reducedMotion } from './motion.ts';
import { request } from './net.ts';

interface ListItem {
  slug: string;
  name: string;
  brand: string;
  type: string;
  status: string;
  goLiveAt: string | null;
  weekLabel: string | null;
  palette: string[];
  markets: { market: string; city: string; goLiveAt: string | null; status: string }[];
}

interface ListResponse {
  items: ListItem[];
  page: number;
  pageSize: number;
  total: number;
  todayCopenhagen: string;
}

const CONTROLS = ['q', 'market', 'status', 'type', 'week', 'sort'] as const;
type ControlName = (typeof CONTROLS)[number];

const DEFAULTS: Record<ControlName, string> = {
  q: '',
  market: '',
  status: '',
  type: '',
  week: '',
  sort: 'soonest',
};

const STATUS_ICONS: Record<string, string> = {
  upcoming: 'circle',
  live: 'circle-dot',
  sold_out: 'circle-slash',
};

const STATUS_WORDS: Record<string, string> = {
  upcoming: 'Upcoming',
  live: 'Live',
  sold_out: 'Sold out',
};

export interface CalendarOptions {
  weeks: { value: string; label: string }[];
  currentWeek: string;
  today: string;
}

export function startCalendar(options: CalendarOptions): void {
  const list = document.querySelector<HTMLElement>('[data-drop-list]');
  const host = document.querySelector<HTMLElement>('[data-filter-host]');
  const sheetHost = document.querySelector<HTMLElement>('[data-sheet-host]');
  if (list === null || host === null) return;

  const weekSelect = document.querySelector<HTMLSelectElement>('[data-field-control="week"]');
  if (weekSelect !== null) {
    for (const week of options.weeks) {
      const option = document.createElement('option');
      option.value = week.value;
      option.textContent = week.label;
      weekSelect.append(option);
    }
  }

  let page = 1;
  let searchTimer = 0;

  const controlFor = (name: ControlName): HTMLInputElement | HTMLSelectElement | null =>
    document.querySelector(`[data-field-control="${name}"]`);

  const readControls = (): Record<ControlName, string> => {
    const values = { ...DEFAULTS };
    for (const name of CONTROLS) {
      const control = controlFor(name);
      if (control !== null) values[name] = control.value;
    }
    return values;
  };

  const applyAddress = (): void => {
    const params = new URLSearchParams(window.location.search);
    for (const name of CONTROLS) {
      const control = controlFor(name);
      if (control === null) continue;
      control.value = params.get(name) ?? DEFAULTS[name];
    }
    page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  };

  const addressFor = (values: Record<ControlName, string>, nextPage: number): string => {
    const params = new URLSearchParams();
    for (const name of CONTROLS) {
      if (values[name] !== DEFAULTS[name]) params.set(name, values[name]);
    }
    if (nextPage > 1) params.set('page', String(nextPage));
    const query = params.toString();
    return query === '' ? window.location.pathname : `${window.location.pathname}?${query}`;
  };

  const load = async (): Promise<void> => {
    const values = readControls();
    const params = new URLSearchParams();
    for (const name of CONTROLS) {
      if (values[name] !== DEFAULTS[name]) params.set(name, values[name]);
    }
    params.set('page', String(page));
    const data = await request<ListResponse>(`/api/public/drops?${params.toString()}`);
    renderGroups(list, data, options.currentWeek);
    announce(
      'Calendar results',
      data.total === 0
        ? STATUS_COPY.calendarNoMatch
        : data.total === 1
          ? '1 drop'
          : `${data.total} drops`,
    );
    updatePager(data, values, addressFor);
    const show = document.querySelector<HTMLElement>('[data-action="apply-filters"]');
    if (show !== null) show.textContent = `Show ${data.total} ${data.total === 1 ? 'drop' : 'drops'}`;
  };

  const push = (): void => {
    const values = readControls();
    window.history.pushState({ page }, '', addressFor(values, page));
    void load();
  };

  const onControlChange = (name: ControlName): void => {
    if (name !== 'q') page = 1;
    push();
  };

  for (const name of CONTROLS) {
    const control = controlFor(name);
    if (control === null) continue;
    if (name === 'q') {
      control.addEventListener('input', () => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          page = 1;
          push();
        }, 333);
      });
      continue;
    }
    control.addEventListener('change', () => onControlChange(name));
  }

  const filtersButton = document.querySelector<HTMLElement>('[data-action="open-filters"]');
  filtersButton?.addEventListener('click', () => {
    if (sheetHost !== null && host.firstChild !== null) sheetHost.append(...host.childNodes);
    openDialog('Filters', filtersButton);
  });
  document.querySelector<HTMLElement>('[data-action="apply-filters"]')?.addEventListener('click', () => {
    const dialog = document.querySelector<HTMLDialogElement>('[data-dialog="Filters"]');
    if (sheetHost !== null) host.append(...sheetHost.childNodes);
    if (dialog !== null) closeDialog(dialog);
  });

  window.addEventListener('popstate', () => {
    applyAddress();
    void load();
  });

  document.querySelector<HTMLElement>('[data-pager-previous]')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (page <= 1) return;
    page -= 1;
    push();
  });
  document.querySelector<HTMLElement>('[data-pager-next]')?.addEventListener('click', (event) => {
    event.preventDefault();
    page += 1;
    push();
  });

  applyAddress();
  void load();
  startIntroRoll();
}

function updatePager(
  data: ListResponse,
  values: Record<ControlName, string>,
  addressFor: (values: Record<ControlName, string>, page: number) => string,
): void {
  const total = Math.max(1, Math.ceil(data.total / data.pageSize));
  const count = document.querySelector<HTMLElement>('[data-pager-count]');
  if (count !== null) count.textContent = `Page ${data.page} / ${total}`;
  const previous = document.querySelector<HTMLAnchorElement>('[data-pager-previous]');
  const next = document.querySelector<HTMLAnchorElement>('[data-pager-next]');
  if (previous !== null) previous.href = addressFor(values, Math.max(1, data.page - 1));
  if (next !== null) next.href = addressFor(values, Math.min(total, data.page + 1));
}

function renderGroups(list: HTMLElement, data: ListResponse, currentWeek: string): void {
  const positions = new Map<string, DOMRect>();
  for (const card of list.querySelectorAll<HTMLElement>('[data-drop-card]')) {
    positions.set(card.dataset['dropCard'] ?? '', card.getBoundingClientRect());
  }

  const groups = new Map<string, ListItem[]>();
  for (const item of data.items) {
    const label = item.weekLabel ?? 'Unscheduled';
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }

  if (groups.size === 0) {
    list.replaceChildren(emptyItem());
    return;
  }

  list.replaceChildren(
    ...[...groups.entries()].map(([label, items]) => {
      const group = document.createElement('li');
      group.className = 'drop-week';
      const heading = document.createElement('h2');
      heading.className = 'drop-week__heading';
      heading.textContent = label;
      if (isCurrentWeek(items, currentWeek)) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'This week';
        heading.append(' ', tag);
      }
      const inner = document.createElement('ul');
      inner.className = 'drop-cards';
      inner.setAttribute('aria-label', label);
      inner.append(...items.map((item) => dropCard(item, data.todayCopenhagen)));
      group.append(heading, inner);
      return group;
    }),
  );

  if (reducedMotion()) return;
  for (const card of list.querySelectorAll<HTMLElement>('[data-drop-card]')) {
    const before = positions.get(card.dataset['dropCard'] ?? '');
    if (before === undefined) continue;
    const after = card.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (dx === 0 && dy === 0) continue;
    card.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: DURATIONS.state, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
}

function isCurrentWeek(items: readonly ListItem[], currentWeek: string): boolean {
  const first = items[0];
  if (first === undefined || first.goLiveAt === null) return false;
  void currentWeek;
  return first.weekLabel === currentWeekLabel(currentWeek);
}

let cachedCurrentLabel: string | null = null;
function currentWeekLabel(currentWeek: string): string {
  if (cachedCurrentLabel !== null) return cachedCurrentLabel;
  const match = /^(\d{4})-W(\d{2})$/.exec(currentWeek);
  cachedCurrentLabel = match === null ? '' : `Week ${Number(match[2])} · ${match[1]}`;
  return cachedCurrentLabel;
}

function emptyItem(): HTMLElement {
  const item = document.createElement('li');
  item.className = 'drop-week drop-week--empty';
  item.textContent = STATUS_COPY.calendarNoMatch;
  return item;
}

function dropCard(item: ListItem, today: string): HTMLElement {
  const card = document.createElement('li');
  card.className = 'drop-card';
  card.dataset['dropCard'] = item.slug;
  card.style.setProperty('--swatch-a', swatchColour(item.palette[0] ?? 'stone'));
  card.style.setProperty('--swatch-b', swatchColour(item.palette[1] ?? 'ink'));
  card.style.setProperty('--swatch-c', swatchColour(item.palette[2] ?? 'vermilion'));

  const link = document.createElement('a');
  link.className = 'drop-card__link';
  link.href = `/drops/${item.slug}`;
  link.textContent = item.name;

  const brand = document.createElement('p');
  brand.className = 'drop-card__brand';
  brand.textContent = item.brand;

  const type = document.createElement('p');
  type.className = 'drop-card__type';
  type.textContent = item.type === 'simultaneous' ? 'Simultaneous' : 'Rolling';

  const opens = document.createElement('p');
  opens.className = 'drop-card__opens mono';
  const instant = item.goLiveAt === null ? null : parseInstant(item.goLiveAt);
  opens.textContent = instant === null ? '—' : formatMarketTime(instant, 'copenhagen');

  const status = document.createElement('p');
  status.className = 'drop-card__status';
  status.innerHTML = `<span class="status-mark" data-status="${item.status}"><svg class="icon" aria-hidden="true"><use href="/assets/icons.svg#icon-${STATUS_ICONS[item.status] ?? 'circle'}"></use></svg><span class="status-mark__word">${STATUS_WORDS[item.status] ?? item.status}</span></span>`;

  card.append(link, brand, type, opens, status);
  if (item.goLiveAt !== null && opensToday(item.goLiveAt, today)) {
    const tag = document.createElement('p');
    tag.className = 'tag';
    tag.textContent = 'Today';
    card.append(tag);
  }

  card.addEventListener('pointerenter', (event) => {
    if (!isMousePointer(event)) return;
    scatterSwatchDots(card, event);
  });
  return card;
}

function opensToday(goLiveAt: string, today: string): boolean {
  const instant = parseInstant(goLiveAt);
  if (instant === null) return false;
  return formatMarketTime(instant, 'copenhagen').startsWith(copenhagenDateHead(today));
}

function copenhagenDateHead(today: string): string {
  const parts = today.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weekday = names[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  return `${weekday} ${day} ${months[month - 1] ?? ''} ${year}`;
}

/** Three dots in the drop's palette colours scatter from a mouse pointer and shrink away. */
function scatterSwatchDots(card: HTMLElement, event: PointerEvent): void {
  if (reducedMotion()) return;
  const box = card.getBoundingClientRect();
  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'swatch-dot';
    dot.style.setProperty('--dot-colour', `var(--swatch-${['a', 'b', 'c'][index] as string})`);
    dot.style.left = `${event.clientX - box.left}px`;
    dot.style.top = `${event.clientY - box.top}px`;
    card.append(dot);
    const angle = (index / 3) * Math.PI * 2;
    dot
      .animate(
        [
          { transform: 'translate(-50%, -50%) scale(1)', opacity: '1' },
          {
            transform: `translate(calc(-50% + ${Math.cos(angle) * 26}px), calc(-50% + ${Math.sin(angle) * 26}px)) scale(0)`,
            opacity: '0',
          },
        ],
        { duration: DURATIONS.feedback, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      )
      .addEventListener('finish', () => dot.remove());
  }
}

const CITIES = ['Stockholm', 'Paris', 'London', 'New York', 'Tokyo', 'Copenhagen'];

/** On the first visit of a browser session the tagline rolls its city word. */
function startIntroRoll(): void {
  const city = document.querySelector<HTMLElement>('[data-intro-city]');
  if (city === null) return;
  city.setAttribute('aria-hidden', 'true');
  const seen = window.sessionStorage.getItem('hourline.intro') === 'seen';
  if (seen || reducedMotion()) {
    city.textContent = 'Copenhagen time.';
    return;
  }
  window.sessionStorage.setItem('hourline.intro', 'seen');
  let index = 0;
  const step = (): void => {
    const name = CITIES[index];
    if (name === undefined) return;
    city.textContent = `${name} time.`;
    city.classList.remove('is-rolling');
    void city.offsetWidth;
    city.classList.add('is-rolling');
    index += 1;
    if (index < CITIES.length) window.setTimeout(step, DURATIONS.entrance);
  };
  step();
}
