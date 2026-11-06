// The public drop calendar. Calendar state lives in the URL: market, status,
// type, week, search, sort and page, each change adds exactly one history entry.
import { api, apiOk, type PublicDrop, type PublicListItem } from './api.js';
import { el, buttonEl, liveRegion, announce, statusMark, swatchDots } from './ui.js';
import { route, navigate } from './router.js';
import { marketTimeWords, isoWeekOf, dateWords, parseInstant } from './format.js';
import { MARKETS } from './api.js';

interface CalendarState { market: string; status: string; type: string; week: string; q: string; sort: string; page: number; total?: number; }

function readState(params: URLSearchParams): CalendarState {
  return {
    market: params.get('market') ?? '',
    status: params.get('status') ?? '',
    type: params.get('type') ?? '',
    week: params.get('week') ?? '',
    q: params.get('q') ?? '',
    sort: params.get('sort') ?? 'soonest',
    page: Math.max(1, Number(params.get('page') ?? '1') || 1)
  };
}

function writeUrl(state: CalendarState): string {
  const p = new URLSearchParams();
  if (state.market) p.set('market', state.market);
  if (state.status) p.set('status', state.status);
  if (state.type) p.set('type', state.type);
  if (state.week) p.set('week', state.week);
  if (state.q) p.set('q', state.q);
  if (state.sort !== 'soonest') p.set('sort', state.sort);
  if (state.page > 1) p.set('page', String(state.page));
  const qs = p.toString();
  return `/${qs ? `?${qs}` : ''}`;
}

interface CalendarRefs {
  state: CalendarState;
  region: HTMLElement;
  listWrap: HTMLElement;
  weekSelect: HTMLSelectElement;
}

export function registerCalendarRoutes(): void {
  route('/', renderCalendar);
}

async function renderCalendar(root: HTMLElement, params: Record<string, string>): Promise<HTMLElement> {
  const state = readState(new URLSearchParams(Object.entries(params).map(([k, v]) => [k, v])));
  const heading = el('h1', {}, 'Drop calendar');
  const intro = el('div', { class: 'intro-band panel' });
  const tagline = el('p', { class: 'tagline display' });
  tagline.append(
    document.createTextNode('One drop. '),
    el('span', { class: 'sr-city', 'aria-hidden': 'false' }, el('span', { class: 'intro-city' }, 'Copenhagen')),
    document.createTextNode(' time. Every market.')
  );
  const todayLine = el('p', { class: 'mono', 'aria-live': 'off' });
  const filtersForm = el('form', { class: 'filters', role: 'search', 'aria-label': 'Drop filters', onsubmit: (e: Event) => e.preventDefault() });
  const refs: CalendarRefs = { state, region: liveRegion('Calendar results'), listWrap: el('div', {}), weekSelect: null as unknown as HTMLSelectElement };

  const controls: HTMLElement[] = [];
  const search = el('input', { type: 'search', name: 'q', 'aria-label': 'Search drops', placeholder: 'Search drops', value: state.q, class: 'search-input' }) as HTMLInputElement;
  const market = selectControl('Market', 'market', 'All markets', MARKETS.map(m => [m.market, m.city]), state.market);
  const statusSel = selectControl('Status', 'status', 'Any status', [['upcoming', 'Upcoming'], ['live', 'Live'], ['sold_out', 'Sold out']], state.status);
  const typeSel = selectControl('Type', 'type', 'All types', [['simultaneous', 'Simultaneous'], ['rolling', 'Rolling']], state.type);
  const weekSel = selectControl('Week', 'week', 'All weeks', [], state.week);
  refs.weekSelect = weekSel as unknown as HTMLSelectElement;
  const sortSel = selectControl('Sort', 'sort', 'Soonest first', [['soonest', 'Soonest first'], ['latest', 'Latest first'], ['name', 'Name A–Z']], state.sort);
  controls.push(search, market, statusSel, typeSel, weekSel, sortSel);

  const filtersBtn = buttonEl({ class: 'btn btn-primary', text: 'Filters', 'aria-haspopup': 'dialog', onclick: () => openFiltersSheet(controls, refs) });
  const desktopFilters = el('div', { class: 'filters-desktop' });
  controls.forEach(c => { (c as HTMLElement).classList.add('filter-control'); });
  desktopFilters.append(...controls);
  const phoneFilters = el('div', { class: 'filters-phone' }, filtersBtn);

  filtersForm.append(desktopFilters, phoneFilters);

  let searchTimer: number | undefined;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      apply(refs, { q: search.value }, false);
    }, 333);
  });
  for (const sel of [market, statusSel, typeSel, weekSel, sortSel] as HTMLSelectElement[]) {
    sel.addEventListener('change', () => {
      const patch: Partial<CalendarState> = {};
      if (sel === market) patch.market = sel.value;
      if (sel === statusSel) patch.status = sel.value;
      if (sel === typeSel) patch.type = sel.value;
      if (sel === weekSel) patch.week = sel.value;
      if (sel === sortSel) patch.sort = sel.value;
      apply(refs, patch, false);
    });
  }

  intro.append(tagline, todayLine);
  root.append(
    heading,
    el('a', { class: 'skip-link', href: '#main', text: 'Skip to content' }),
    intro,
    filtersForm,
    refs.region,
    refs.listWrap
  );

  await reload(refs, todayLine);
  return heading;
}

function selectControl(label: string, name: string, defaultText: string, options: [string, string][], value: string): HTMLSelectElement {
  const sel = el('select', { 'aria-label': label, name }) as HTMLSelectElement;
  sel.append(el('option', { value: '', text: defaultText, ...(value === '' ? { selected: true } : {}) }));
  for (const [v, text] of options) {
    sel.append(el('option', { value: v, text, ...(value === v ? { selected: true } : {}) }));
  }
  return sel;
}



function openFiltersSheet(controls: HTMLElement[], refs: CalendarRefs): void {
  const sheet = el('dialog', { class: 'sheet-dialog', 'aria-label': 'Filters' }) as HTMLDialogElement;
  const body = el('div', { class: 'sheet-body' });
  const holder = el('div', { class: 'filters-sheet' });
  controls.forEach(c => {
    const field = el('label', { class: 'field' });
    field.append(el('span', { class: 'label', text: c.getAttribute('aria-label') ?? '' }), c);
    holder.append(field);
  });
  body.append(holder);
  const bar = el('div', { class: 'sticky-bar', style: 'display:flex' });
  const countBtn = buttonEl({ class: 'btn btn-primary', text: `Show ${refs.state.total ?? 0} drops`, onclick: () => { sheet.close(); } });
  bar.append(countBtn);
  sheet.append(body, bar);
  document.body.append(sheet);
  sheet.showModal();
  sheet.addEventListener('close', () => {
    sheet.remove();
    document.querySelector<HTMLButtonElement>('[aria-label="Filters"]')?.focus();
  });
  const first = sheet.querySelector<HTMLElement>('input, select, button');
  first?.focus();
}

async function reload(refs: CalendarRefs, todayLine: HTMLElement): Promise<void> {
  const state = refs.state;
  const query = writeUrl(state).replace(/^\/\?/, '');
  let data: { items: PublicListItem[]; page: number; pageSize: number; total: number; todayCopenhagen: string } | null = null;
  try {
    data = await apiOk('GET', `/api/public/drops${query ? `?${query}` : ''}`);
  } catch {
    announce(refs.region, "Hourline can't be reached. Nothing was saved. Check your connection and try again.", true);
    return;
  }
  if (!data) return;
  refs.state.total = data.total;
  todayLine.textContent = `Today in Copenhagen: ${dateWords(data.todayCopenhagen)}`;

  const count = data.total === 1 ? '1 drop' : `${data.total} drops`;
  announce(refs.region, count);

  // Week options rebuilt from the current result set.
  rebuildWeeks(refs, data.items);

  refs.listWrap.replaceChildren();
  if (data.items.length === 0) {
    refs.listWrap.append(el('p', { text: 'No drops match these filters.', class: 'note' }));
  } else {
    const list = el('ul', { 'aria-label': 'Drops', role: 'list' });
    const groups = new Map<string, { label: string; items: PublicListItem[]; thisWeek: boolean }>();
    for (const item of data.items) {
      if (!item.weekLabel) continue;
      if (!groups.has(item.weekLabel)) {
        const marketInstant = state.market ? item.markets.find(m => m.market === state.market)?.goLiveAt : item.goLiveAt;
        const iso = marketInstant ? marketInstant.slice(0, 10) : (item.goLiveAt ?? '').slice(0, 10);
        const todayWeek = isoWeekOf(data.todayCopenhagen).key;
        groups.set(item.weekLabel, { label: item.weekLabel, items: [], thisWeek: (!state.market || true) && isoWeekOf(iso).key === todayWeek });
      }
      groups.get(item.weekLabel)!.items.push(item);
    }
    for (const [label, group] of groups) {
      const li = el('li', { class: 'week-group' });
      const h2 = el('h2', {}, label);
      li.append(h2);
      if (group.thisWeek) h2.append(' ', el('span', { class: 'tag', text: 'This week' }));
      const inner = el('ul', { 'aria-label': label, role: 'list' });
      for (const item of group.items) {
        inner.append(dropCard(item, data.todayCopenhagen));
      }
      li.append(inner);
      list.append(li);
    }
    refs.listWrap.append(list);
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const nav = el('nav', { 'aria-label': 'Pages', class: 'pages' });
  const prev = el('a', { href: '#', text: 'Previous page', 'aria-disabled': state.page <= 1 ? 'true' : null, onclick: (e: Event) => { e.preventDefault(); if (state.page > 1) apply(refs, { page: state.page - 1 }, true); } });
  const next = el('a', { href: '#', text: 'Next page', onclick: (e: Event) => { e.preventDefault(); if (state.page < totalPages) apply(refs, { page: state.page + 1 }, true); } });
  nav.append(prev, el('span', { class: 'page-count mono', text: `Page ${data.page} / ${totalPages}` }), next);
  refs.listWrap.append(nav);
}

function rebuildWeeks(refs: CalendarRefs, items: PublicListItem[]): void {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!item.weekLabel) continue;
    const marketInstant = refs.state.market ? item.markets.find(m => m.market === refs.state.market)?.goLiveAt : item.goLiveAt;
    const iso = (marketInstant ?? item.goLiveAt ?? '').slice(0, 10);
    if (iso) seen.set(isoWeekOf(iso).key, isoWeekOf(iso).label);
  }
  const sel = refs.weekSelect;
  const current = sel.value;
  sel.replaceChildren(el('option', { value: '', text: 'All weeks' }));
  for (const [key, label] of seen) {
    sel.append(el('option', { value: key, text: label, ...(current === key ? { selected: true } : {}) }));
  }
}

function dropCard(item: PublicListItem, todayIso: string): HTMLElement {
  const li = el('li', {});
  const card = el('div', { class: 'drop-card tone-flip' });
  const img = el('img', { src: item.coverImageUrl ?? '', alt: `${item.name} look` });
  const meta = el('div', { class: 'meta' });
  const link = el('a', { class: 'name-link', href: `/drops/${item.slug}`, text: item.name });
  meta.append(link, el('span', { class: 'brand', text: item.brand }));
  const opens = item.markets[0]?.goLiveAt ?? item.goLiveAt;
  meta.append(el('span', { class: 'type', text: item.type === 'simultaneous' ? 'Simultaneous' : 'Rolling' }));
  if (opens) {
    const inst = parseInstant(opens);
    const words = marketTimeWords(inst, item.markets[0]?.market ?? 'copenhagen', item.markets[0]?.city ?? 'Copenhagen');
    const opensSpan = el('span', { class: 'mono', text: words });
    if (opens.slice(0, 10) === todayIso) opensSpan.append(' ', el('span', { class: 'tag', text: 'Today' }));
    meta.append(el('span', { class: 'row2' }, opensSpan));
  }
  meta.append(statusMark(item.status));
  card.append(img, meta);
  li.append(card);
  swatchDots(card, item.palette);
  return li;
}

function apply(refs: CalendarRefs, patch: Partial<CalendarState>, keepPage: boolean): void {
  const next: CalendarState = { ...refs.state, ...patch };
  if (!keepPage && patch.page === undefined) next.page = 1;
  const url = writeUrl(next);
  history.pushState({}, '', url);
  refs.state = next;
  void navigate(url, { push: false, wipe: false });
}

export async function loadPublicDrop(slug: string): Promise<PublicDrop | null> {
  try {
    return await apiOk('GET', `/api/public/drops/${slug}`);
  } catch (err) {
    const fail = (err as { fail?: { status: number; code: string } }).fail;
    if (fail?.status === 410) return null;
    return null;
  }
}

export function registerDropPublicRoute(): void {
  route('/drops/:slug', async (root: HTMLElement, params: Record<string, string>) => {
    const drop = await loadPublicDrop(params.slug);
    if (!drop) {
      const { renderWithdrawn } = await import('./drop-page.js');
      return renderWithdrawn(root);
    }
    const { renderDropPage } = await import('./drop-page.js');
    return renderDropPage(root, drop, params.slug);
  });
}

export async function publicDropFor(slug: string): Promise<PublicDrop | null> { return loadPublicDrop(slug); }

export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: T | null }> {
  try {
    const res = await api<T>(method, path, body);
    return { ok: true, data: res.data };
  } catch {
    return { ok: false, data: null };
  }
}
