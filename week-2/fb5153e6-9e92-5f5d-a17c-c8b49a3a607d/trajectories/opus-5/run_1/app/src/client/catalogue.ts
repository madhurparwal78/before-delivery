import { all, announce, manageDialog, one, readState } from './dom.js';
import { call } from './api.js';
import type { Locale } from '../shared/locale.js';
import { formatAmount, formatNumber, localeFromLang } from '../shared/locale.js';
import { catalogueResultCount, pageLabel, s } from '../shared/strings.js';
import { categoryLabel, formatLabel } from '../shared/labels.js';
import type { Category, Format } from '../domain/model.js';

interface Selection {
  q: string;
  category: string[];
  licence: string[];
  format: string[];
  sort: string;
  page: number;
}

interface Card {
  slug: string;
  title: string;
  category: Category;
  formats: Format[];
  licences: string[];
  price_from_cents: number;
  preview_url: string;
  rebuilding: boolean;
}

interface CatalogueReply {
  total: number;
  page: number;
  pages: number;
  items: Card[];
  facets: Record<'category' | 'licence' | 'format', Record<string, number>>;
}

const state = readState<{ selection: Selection; lang: string | null }>('catalogue-state');
const locale: Locale = localeFromLang(state?.lang ?? null);

const selection: Selection = state?.selection ?? {
  q: '',
  category: [],
  licence: [],
  format: [],
  sort: 'newest',
  page: 1,
};

const resultsList = one<HTMLUListElement>('[data-results]');
const countStatus = one('[data-result-count]');
const paginationHost = one('[data-pagination]');
const searchBox = one<HTMLInputElement>('[data-search]');
const sortPicker = one<HTMLSelectElement>('[data-sort]');
const rail = one<HTMLElement>('[data-facet-rail]');

/** Facet values are listed in the order shown in the rail. */
function railOrder(group: string): string[] {
  return all<HTMLInputElement>(`[data-facet="${group}"]`, rail ?? document).map((box) => box.value);
}

function readFacets(): void {
  for (const group of ['category', 'licence', 'format'] as const) {
    const order = railOrder(group);
    const chosen = all<HTMLInputElement>(`[data-facet="${group}"]`, rail ?? document)
      .filter((box) => box.checked)
      .map((box) => box.value);
    selection[group] = order.filter((value) => chosen.includes(value));
  }
}

/** Defaults are left out of the address. */
function toQuery(current: Selection): URLSearchParams {
  const params = new URLSearchParams();
  if (current.q !== '') params.set('q', current.q);
  if (current.category.length > 0) params.set('category', current.category.join(','));
  if (current.licence.length > 0) params.set('licence', current.licence.join(','));
  if (current.format.length > 0) params.set('format', current.format.join(','));
  if (current.sort !== 'newest') params.set('sort', current.sort);
  if (current.page !== 1) params.set('page', String(current.page));
  return params;
}

function addressFor(current: Selection): string {
  const params = toQuery(current);
  const lang = new URL(window.location.href).searchParams.get('lang');
  if (lang !== null) params.set('lang', lang);
  const qs = params.toString();
  return qs === '' ? '/catalogue' : `/catalogue?${qs}`;
}

function readAddress(): void {
  const params = new URL(window.location.href).searchParams;
  selection.q = params.get('q') ?? '';
  selection.category = (params.get('category') ?? '').split(',').filter((v) => v !== '');
  selection.licence = (params.get('licence') ?? '').split(',').filter((v) => v !== '');
  selection.format = (params.get('format') ?? '').split(',').filter((v) => v !== '');
  selection.sort = params.get('sort') ?? 'newest';
  selection.page = Number.parseInt(params.get('page') ?? '1', 10) || 1;
}

function syncControls(): void {
  if (searchBox !== null) searchBox.value = selection.q;
  if (sortPicker !== null) sortPicker.value = selection.sort;
  for (const group of ['category', 'licence', 'format'] as const) {
    for (const box of all<HTMLInputElement>(`[data-facet="${group}"]`)) {
      box.checked = selection[group].includes(box.value);
    }
  }
}

function cardMarkup(item: Card): string {
  const title = document.createElement('span');
  title.textContent = item.title;
  return `
    <img class="card-media" src="${item.preview_url}" alt="" width="1024" height="768" loading="lazy">
    <div class="card-body">
      <p class="card-title"><a href="${linkFor(item.slug)}">${title.innerHTML}</a></p>
      <p class="card-category">${escapeText(categoryLabel(item.category, locale))}</p>
      <p class="card-formats mono">${escapeText(item.formats.map((f) => formatLabel(f, locale)).join(' · '))}</p>
      ${item.rebuilding ? `<p class="notice">${escapeText(s('previewRebuilding', locale))}</p>` : ''}
      <p class="card-meta">
        <span>${escapeText(s('fromPrice', locale))}</span>
        <span class="mono">${escapeText(formatAmount(item.price_from_cents, locale))}</span>
      </p>
    </div>`;
}

function escapeText(value: string): string {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function linkFor(slug: string): string {
  const lang = new URL(window.location.href).searchParams.get('lang');
  return lang === null ? `/models/${slug}` : `/models/${slug}?lang=${lang}`;
}

function renderPagination(reply: CatalogueReply): void {
  if (paginationHost === null) return;
  const nav = document.createElement('nav');
  nav.className = 'pagination';
  nav.setAttribute('aria-label', s('pages', locale));
  const addLink = (page: number, text: string, current: boolean, rel?: string): void => {
    const anchor = document.createElement('a');
    anchor.href = addressFor({ ...selection, page });
    anchor.textContent = text;
    if (current) anchor.setAttribute('aria-current', 'page');
    if (rel !== undefined) anchor.rel = rel;
    nav.append(anchor);
  };
  if (reply.page > 1) addLink(reply.page - 1, s('previousPage', locale), false, 'prev');
  for (let page = 1; page <= reply.pages; page += 1) {
    addLink(page, pageLabel(page, locale), page === reply.page);
  }
  if (reply.page < reply.pages) addLink(reply.page + 1, s('nextPage', locale), false, 'next');
  paginationHost.replaceChildren(nav);
}

function renderResults(reply: CatalogueReply): void {
  if (resultsList !== null) {
    resultsList.replaceChildren(
      ...reply.items.map((item) => {
        const li = document.createElement('li');
        li.className = 'card';
        li.innerHTML = cardMarkup(item);
        return li;
      }),
    );
  }
  for (const group of ['category', 'licence', 'format'] as const) {
    for (const box of all<HTMLInputElement>(`[data-facet="${group}"]`)) {
      const count = reply.facets[group][box.value] ?? 0;
      const label = box.closest('label');
      const node = label?.querySelector('.facet-count');
      if (node !== null && node !== undefined) node.textContent = formatNumber(count, locale);
    }
  }
  announce(countStatus, catalogueResultCount(reply.total, locale));
  renderPagination(reply);
}

let inFlight = 0;

async function refresh(push: boolean): Promise<void> {
  const address = addressFor(selection);
  if (push) window.history.pushState({}, '', address);
  const ticket = ++inFlight;
  const params = toQuery(selection);
  const reply = await call<CatalogueReply>(
    `/api/catalogue${params.toString() === '' ? '' : `?${params.toString()}`}`,
    { locale },
  );
  if (ticket !== inFlight) return;
  renderResults(reply);
}

/** Any facet, sort or search change resets the page to 1. */
function changed(): void {
  readFacets();
  selection.page = 1;
  void refresh(true);
}

for (const box of all<HTMLInputElement>('[data-facet]')) {
  box.addEventListener('change', changed);
}

sortPicker?.addEventListener('change', () => {
  selection.sort = sortPicker.value;
  changed();
});

let searchTimer = 0;
searchBox?.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    selection.q = searchBox.value;
    changed();
  }, 300);
});

document.addEventListener('click', (event) => {
  const anchor = (event.target as Element | null)?.closest<HTMLAnchorElement>('.pagination a');
  if (anchor === null || anchor === undefined) return;
  event.preventDefault();
  window.history.pushState({}, '', anchor.href);
  readAddress();
  syncControls();
  void refresh(false);
});

window.addEventListener('popstate', () => {
  readAddress();
  syncControls();
  void refresh(false);
});

const filtersDialog = one<HTMLDialogElement>('[data-filters-dialog]');
const filtersButton = one<HTMLButtonElement>('[data-open-filters]');
if (filtersDialog !== null && filtersButton !== null && rail !== null) {
  const slot = one<HTMLElement>('[data-filters-slot]', filtersDialog);
  const home = rail.parentElement;
  const handle = manageDialog(filtersDialog, () => filtersButton);
  filtersButton.addEventListener('click', () => {
    slot?.append(rail);
    handle.open();
  });
  one<HTMLButtonElement>('[data-close-filters]', filtersDialog)?.addEventListener('click', () => {
    handle.close();
    home?.insertBefore(rail, home.children[1] ?? null);
  });
}
