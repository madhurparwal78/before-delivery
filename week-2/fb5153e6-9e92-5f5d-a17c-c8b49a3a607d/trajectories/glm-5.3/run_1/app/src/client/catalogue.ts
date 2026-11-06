import { api, copy, escapeHtml, wireCore, announce, locale } from './app-core.js';

interface CatalogueResponse {
  total: number;
  page: number;
  page_size: number;
  pages: number;
  items: Card[];
  facets: { category: Record<string, number>; licence: Record<string, number>; format: Record<string, number> };
}

interface Card {
  slug: string;
  title: string;
  category: string;
  formats: string[];
  licences: string[];
  price_from_cents: number;
  preview_url: string;
  rebuilding: boolean;
}

const RAIL_ORDER = { category: ['hard-surface', 'miniature', 'scan'], licence: ['personal', 'commercial', 'studio'], format: ['glb', 'stl'] };
const FACET_LABELS: Record<string, Record<string, string>> = {
  category: { 'hard-surface': copy('facet.hard-surface'), miniature: copy('facet.miniature'), scan: copy('facet.scan') },
  licence: { personal: copy('facet.personal'), commercial: copy('facet.commercial'), studio: copy('facet.studio') },
  format: { glb: 'GLB', stl: 'STL' },
};

function stateOf(): { q: string; category: string[]; licence: string[]; format: string[]; sort: string; page: number } {
  const params = new URLSearchParams(window.location.search);
  const split = (name: string): string[] =>
    (params.get(name) ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value !== '');
  return {
    q: params.get('q') ?? '',
    category: split('category'),
    licence: split('licence'),
    format: split('format'),
    sort: params.get('sort') ?? 'newest',
    page: Number.parseInt(params.get('page') ?? '1', 10) || 1,
  };
}

function addressOf(state: ReturnType<typeof stateOf>): string {
  const params = new URLSearchParams();
  if (state.q !== '') params.set('q', state.q);
  if (state.category.length > 0) params.set('category', state.category.join(','));
  if (state.licence.length > 0) params.set('licence', state.licence.join(','));
  if (state.format.length > 0) params.set('format', state.format.join(','));
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const lang = new URLSearchParams(window.location.search).get('lang');
  if (lang === 'de' || lang === 'en') params.set('lang', lang);
  const text = params.toString();
  return `/catalogue${text === '' ? '' : `?${text}`}`;
}

function facetCountsOf(facets: CatalogueResponse['facets']): Record<string, Record<string, number>> {
  return {
    category: facets.category,
    licence: facets.licence,
    format: facets.format,
  };
}

function renderFacets(facets: CatalogueResponse['facets']): void {
  const counts = facetCountsOf(facets);
  for (const group of ['category', 'licence', 'format'] as const) {
    const groupEl = document.querySelector(`.facet-group input[name="${group}"]`)?.closest('fieldset');
    if (groupEl === undefined || groupEl === null) continue;
    const boxes = groupEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    for (const box of boxes) {
      const countEl = box.closest('label')?.querySelector<HTMLElement>('.facet-count');
      if (countEl !== undefined && countEl !== null) {
        countEl.textContent = String((counts[group] ?? {})[box.value] ?? 0);
      }
    }
  }
}

function cardHtml(card: Card): string {
  const lang = new URLSearchParams(window.location.search).get('lang');
  const langSuffix = lang === 'de' ? '?lang=de' : lang === 'en' ? '?lang=en' : '';
  return `    <li class="card">
      <a class="card-link" href="/models/${encodeURIComponent(card.slug)}${langSuffix}">
        <span class="card-preview"><img src="${card.preview_url}" alt="${escapeHtml(card.title)}" loading="lazy"></span>
        <span class="card-title">${escapeHtml(card.title)}</span>
        <span class="card-meta">${escapeHtml(FACET_LABELS['category']?.[card.category] ?? card.category)}</span>
        <span class="card-meta mono">${copy('catalogue.from', { amount: amountOf(card.price_from_cents) })}${card.rebuilding ? ` · ${copy('viewer.rebuilding')}` : ''}</span>
      </a>
    </li>`;
}

function amountOf(cents: number): string {
  const l = locale();
  const whole = Math.floor(cents / 100).toLocaleString(l === 'en' ? 'en-US' : 'de-DE');
  const part = String(cents % 100).padStart(2, '0');
  return l === 'en' ? `€${whole}.${part}` : `${whole},${part} €`;
}

function renderResults(result: CatalogueResponse): void {
  const grid = document.getElementById('results');
  if (grid !== null) {
    grid.innerHTML =
      result.items.map(cardHtml).join('\n') || `    <li class="empty-state">${copy('catalogue.results.none')}</li>`;
  }
  const countText =
    result.total === 0
      ? copy('catalogue.results.none')
      : result.total === 1
        ? copy('catalogue.results.one')
        : copy('catalogue.results.n', { n: result.total });
  const status = document.getElementById('catalogue-results');
  announce(status, countText);
  const visible = document.querySelector('.results-count');
  if (visible !== null) visible.textContent = countText;
  renderFacets(result.facets);
  renderPagination(result.pages);
}

function renderPagination(pages: number): void {
  const nav = document.querySelector<HTMLElement>('.pagination');
  if (nav === null) return;
  const state = stateOf();
  const pageHref = (page: number): string => addressOf({ ...state, page });
  const items: string[] = [];
  for (let n = 1; n <= pages; n++) {
    items.push(
      `<a href="${pageHref(n)}"${n === state.page ? ' aria-current="page"' : ''}>${copy('catalogue.page_n', { n })}</a>`,
    );
  }
  nav.innerHTML = `<a class="page-link${state.page <= 1 ? ' disabled' : ''}" href="${pageHref(Math.max(1, state.page - 1))}">${copy('catalogue.previous_page')}</a>
${items.join('\n')}
<a class="page-link${state.page >= pages ? ' disabled' : ''}" href="${pageHref(state.page + 1)}">${copy('catalogue.next_page')}</a>`;
}

async function refresh(push: boolean, page = 1): Promise<void> {
  const state = { ...stateOf(), page };
  const params = new URLSearchParams();
  if (state.q !== '') params.set('q', state.q);
  if (state.category.length > 0) params.set('category', state.category.join(','));
  if (state.licence.length > 0) params.set('licence', state.licence.join(','));
  if (state.format.length > 0) params.set('format', state.format.join(','));
  if (state.sort !== 'newest') params.set('sort', state.sort);
  params.set('page', String(state.page));
  let result;
  try {
    result = await api<CatalogueResponse>(`/api/catalogue?${params.toString()}`);
  } catch {
    const status = document.getElementById('catalogue-results');
    announce(status, copy('outage.search_catalogue'));
    return;
  }
  renderResults(result);
  if (push) {
    window.history.pushState(null, '', addressOf(state));
  }
}

function wireCatalogue(): void {
  const searchBox = document.getElementById('catalogue-q') as HTMLInputElement | null;
  if (searchBox !== null) {
    let timer: number | undefined;
    searchBox.addEventListener('input', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const state = { ...stateOf(), q: searchBox.value, page: 1 };
        window.history.replaceState(null, '', addressOf(state));
        void refresh(false, 1);
      }, 300);
    });
  }
  document.querySelectorAll<HTMLInputElement>('.facet-group input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', () => {
      const state = stateOf();
      const group = box.name as 'category' | 'licence' | 'format';
      const values = new Set(state[group]);
      if (box.checked) values.add(box.value);
      else values.delete(box.value);
      const next = { ...state, [group]: RAIL_ORDER[group].filter(value => values.has(value)), page: 1 };
      window.history.replaceState(null, '', addressOf(next));
      void refresh(true, 1);
    });
  });
  const sort = document.getElementById('catalogue-sort') as HTMLSelectElement | null;
  if (sort !== null) {
    sort.addEventListener('change', () => {
      const state = { ...stateOf(), sort: sort.value, page: 1 };
      window.history.replaceState(null, '', addressOf(state));
      void refresh(true, 1);
    });
  }
  window.addEventListener('popstate', () => {
    const searchBox = document.getElementById('catalogue-q') as HTMLInputElement | null;
    if (searchBox !== null) searchBox.value = stateOf().q;
    document.querySelectorAll<HTMLInputElement>('.facet-group input[type="checkbox"]').forEach(box => {
      box.checked = stateOf()[box.name as 'category' | 'licence' | 'format'].includes(box.value);
    });
    const sort = document.getElementById('catalogue-sort') as HTMLSelectElement | null;
    if (sort !== null) sort.value = stateOf().sort;
    void refresh(false, stateOf().page);
  });
  document.querySelectorAll<HTMLAnchorElement>('.pagination a').forEach(link => {
    link.addEventListener('click', event => {
      if (link.classList.contains('disabled')) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const url = new URL(link.href);
      void refresh(true, Number.parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
    });
  });
  const filtersToggle = document.getElementById('filters-toggle');
  const facetScroll = document.getElementById('facet-scroll');
  if (filtersToggle !== null && facetScroll !== null) {
    filtersToggle.addEventListener('click', () => {
      const open = facetScroll.classList.toggle('open');
      filtersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
}

wireCore();
wireCatalogue();
