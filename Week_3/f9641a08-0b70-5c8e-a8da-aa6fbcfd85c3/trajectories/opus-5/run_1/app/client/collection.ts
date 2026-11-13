import { ApiError, api, appConfig, cartAnnounce, escapeHtml, qs, qsa, rupees } from './core.js';
import { closeDialog } from './dialog.js';
import { updateHeaderCounts } from './live.js';

type ColourOption = { name: string; slug: string; image_url: string };

export type SearchItem = {
  slug: string;
  name: string;
  category: string;
  min_price: number;
  price_varies: boolean;
  compare_at: number | null;
  save_percent: number | null;
  colours: ColourOption[];
  badge: string;
};

type SearchResponse = {
  mode: string;
  total: number;
  page: number;
  page_size: number;
  results: SearchItem[];
  facets: Record<string, Record<string, number>> | null;
  notice: string | null;
};

const GROUPS = ['category', 'colour', 'size', 'material', 'price', 'fit'];

const comparedSlugs = new Set<string>();
const savedSlugs = new Set<string>();

export function compareSkus(): string[] {
  const raw = new URLSearchParams(window.location.search).get('compare') ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function queryString(params: URLSearchParams): string {
  return params.toString().replace(/%2C/g, ',');
}

function writeParams(params: URLSearchParams, replace: boolean): void {
  const query = queryString(params);
  const url = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`;
  if (replace) window.history.replaceState({}, '', url);
  else window.history.pushState({}, '', url);
}

function collectionSlug(): string {
  return document.body.dataset.collection ?? 'all';
}

function cardMarkup(item: SearchItem): string {
  const first = item.colours[0];
  return `
<article class="product-card" aria-label="${escapeHtml(item.name)}" data-card="${escapeHtml(item.slug)}">
  <img class="card-image" src="${escapeHtml(first === undefined ? '' : first.image_url)}" alt="" data-card-image>
  <a class="card-name" href="/products/${escapeHtml(item.slug)}">${escapeHtml(item.name)}</a>
  <div role="radiogroup" aria-label="Colour for ${escapeHtml(item.name)}" class="swatches" data-card-colours>
    ${item.colours
      .map(
        (colour, index) => `<button type="button" role="radio" aria-label="${escapeHtml(colour.name)}"
      aria-checked="${index === 0 ? 'true' : 'false'}" tabindex="${index === 0 ? '0' : '-1'}"
      class="swatch swatch-${escapeHtml(colour.slug)}" data-colour="${escapeHtml(colour.slug)}"
      data-image="${escapeHtml(colour.image_url)}"><span class="visually-hidden">${escapeHtml(
        colour.name
      )}</span></button>`
      )
      .join('')}
  </div>
  <p class="card-price">${escapeHtml(item.price_varies ? `From ${rupees(item.min_price)}` : rupees(item.min_price))}</p>
  ${
    item.compare_at === null
      ? ''
      : `<p class="card-save"><s>${escapeHtml(rupees(item.compare_at))}</s> Save ${item.save_percent}%</p>`
  }
  <p class="card-badge" data-card-badge>${escapeHtml(item.badge)}</p>
  <button type="button" data-quick-add="${escapeHtml(item.slug)}">Quick add ${escapeHtml(item.name)}</button>
  <button type="button" data-compare="${escapeHtml(item.slug)}" aria-pressed="${
    comparedSlugs.has(item.slug) ? 'true' : 'false'
  }">Compare ${escapeHtml(item.name)}</button>
  <button type="button" data-save="${escapeHtml(item.slug)}" aria-pressed="${
    savedSlugs.has(item.slug) ? 'true' : 'false'
  }">Save ${escapeHtml(item.name)} to wishlist</button>
</article>`;
}

function optionLabelFor(group: string, value: string): string {
  const input = qs<HTMLInputElement>(`[data-filter-group="${group}"][data-filter-value="${value}"]`);
  if (input === null) return value;
  const label = qs<HTMLElement>(`label[for="${input.id}"]`);
  return label?.textContent?.trim() ?? value;
}

async function render(params: URLSearchParams): Promise<void> {
  const query = new URLSearchParams(params);
  query.delete('compare');
  query.set('collection', collectionSlug());
  const response = await api<SearchResponse>(`/api/search?${queryString(query)}`);

  const grid = qs<HTMLElement>('[data-grid]');
  if (grid !== null) {
    grid.innerHTML =
      response.results.length === 0
        ? '<section class="panel colour-panel"><p>Nothing matches. Remove a filter or try another word.</p></section>'
        : response.results.map(cardMarkup).join('');
  }

  const count = qs<HTMLElement>('[data-result-count]');
  if (count !== null) count.textContent = response.total === 1 ? '1 product' : `${response.total} products`;

  const notice = qs<HTMLElement>('[data-search-notice]');
  if (notice !== null) {
    if (response.notice === null) {
      notice.textContent = '';
      notice.hidden = true;
    } else {
      notice.textContent = response.notice;
      notice.hidden = false;
    }
  }

  for (const input of qsa<HTMLInputElement>('[data-filter-group]')) {
    const group = input.dataset.filterGroup ?? '';
    const value = input.dataset.filterValue ?? '';
    const selected = (params.get(group) ?? '').split(',').includes(value);
    input.checked = selected;
    const counter = qs<HTMLElement>(`#${CSS.escape(`${input.id}-count`)}`);
    if (counter !== null) {
      if (response.facets === null) counter.hidden = true;
      else {
        counter.hidden = false;
        counter.textContent = String(response.facets[group]?.[value] ?? 0);
      }
    }
  }

  const activeList = qs<HTMLElement>('[data-active-filters]');
  if (activeList !== null) {
    const chips: string[] = [];
    for (const group of GROUPS) {
      for (const value of (params.get(group) ?? '').split(',').filter((item) => item !== '')) {
        chips.push(
          `<li><button type="button" data-remove-filter data-filter-group="${escapeHtml(
            group
          )}" data-filter-value="${escapeHtml(value)}">Remove filter ${escapeHtml(
            optionLabelFor(group, value)
          )}</button></li>`
        );
      }
    }
    activeList.innerHTML = chips.join('');
  }

  const pages = Math.max(1, Math.ceil(response.total / (appConfig().page_size ?? response.page_size)));
  const pagination = qs<HTMLElement>('[data-pagination]');
  if (pagination !== null) {
    const href = (page: number): string => {
      const next = new URLSearchParams(params);
      if (page === 1) next.delete('page');
      else next.set('page', String(page));
      const q = queryString(next);
      return q === '' ? window.location.pathname : `${window.location.pathname}?${q}`;
    };
    const items: string[] = [];
    if (response.page > 1) items.push(`<a href="${href(response.page - 1)}" data-page-to="${response.page - 1}">Previous page</a>`);
    for (let page = 1; page <= pages; page += 1) {
      items.push(
        `<a href="${href(page)}" data-page-to="${page}" ${page === response.page ? 'aria-current="page"' : ''}>Page ${page}</a>`
      );
    }
    if (response.page < pages) items.push(`<a href="${href(response.page + 1)}" data-page-to="${response.page + 1}">Next page</a>`);
    pagination.innerHTML = items.join('');
  }

  updateCompareLink();
}

function updateCompareLink(): void {
  const link = qs<HTMLAnchorElement>('[data-compare-link]');
  const skus = compareSkus();
  if (link === null) return;
  if (skus.length === 0) {
    link.hidden = true;
    return;
  }
  link.hidden = false;
  link.textContent = `Compare ${skus.length} selected`;
  link.href = `/compare?compare=${skus.join(',')}`;
}

function toggleFilter(group: string, value: string, on: boolean): void {
  const params = readParams();
  const values = (params.get(group) ?? '').split(',').filter((item) => item !== '');
  const next = on ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  if (next.length === 0) params.delete(group);
  else params.set(group, next.join(','));
  params.delete('page');
  writeParams(params, false);
  void render(params);
}

async function resolveCompareSku(slug: string): Promise<string | null> {
  const card = qs<HTMLElement>(`[data-card="${slug}"]`);
  const colourSlug = card === null ? '' : qs<HTMLElement>('[role="radio"][aria-checked="true"]', card)?.dataset.colour ?? '';
  try {
    const product = await api<{ variants: Array<{ sku: string; colour_slug: string }> }>(`/api/products/${slug}`);
    const variant = product.variants.find((item) => item.colour_slug === colourSlug) ?? product.variants[0];
    return variant === undefined ? null : variant.sku;
  } catch {
    return null;
  }
}

async function productSkus(slug: string): Promise<string[]> {
  try {
    const product = await api<{ variants: Array<{ sku: string }> }>(`/api/products/${slug}`);
    return product.variants.map((item) => item.sku);
  } catch {
    return [];
  }
}

export async function toggleCompare(slug: string, name: string): Promise<void> {
  const max = appConfig().compare_max ?? 3;
  const current = compareSkus();
  const mine = await productSkus(slug);
  const alreadyIn = current.filter((sku) => mine.includes(sku));
  const params = readParams();

  if (alreadyIn.length > 0) {
    const next = current.filter((sku) => !mine.includes(sku));
    if (next.length === 0) params.delete('compare');
    else params.set('compare', next.join(','));
    comparedSlugs.delete(slug);
    writeParams(params, false);
    cartAnnounce(`Removed ${name} from comparison.`);
  } else {
    if (current.length >= max) {
      cartAnnounce(`You can compare up to ${max} products.`);
      return;
    }
    const sku = await resolveCompareSku(slug);
    if (sku === null) return;
    params.set('compare', [...current, sku].join(','));
    comparedSlugs.add(slug);
    writeParams(params, false);
    cartAnnounce(`Added ${name} to comparison.`);
  }

  for (const button of qsa<HTMLElement>(`[data-compare="${slug}"]`)) {
    button.setAttribute('aria-pressed', comparedSlugs.has(slug) ? 'true' : 'false');
  }
  updateCompareLink();
}

export async function toggleSave(slug: string, name: string): Promise<void> {
  const pressed = savedSlugs.has(slug);
  try {
    const wishlist = await api<{ count: number; items: Array<{ slug: string }> }>(`/api/wishlist/${slug}`, {
      method: pressed ? 'DELETE' : 'PUT'
    });
    savedSlugs.clear();
    for (const item of wishlist.items) savedSlugs.add(item.slug);
    updateHeaderCounts({ wishlist: wishlist.count });
    for (const button of qsa<HTMLElement>(`[data-save="${slug}"]`)) {
      button.setAttribute('aria-pressed', savedSlugs.has(slug) ? 'true' : 'false');
    }
    cartAnnounce(pressed ? `Removed ${name} from your wishlist.` : `Saved ${name} to your wishlist.`);
    if (document.body.dataset.page === 'wishlist' && pressed) {
      qs<HTMLElement>(`[data-card="${slug}"]`)?.remove();
    }
  } catch (error) {
    if (error instanceof ApiError) cartAnnounce(error.body.message);
  }
}

async function loadSavedState(): Promise<void> {
  try {
    const wishlist = await api<{ count: number; items: Array<{ slug: string }> }>('/api/wishlist');
    savedSlugs.clear();
    for (const item of wishlist.items) savedSlugs.add(item.slug);
    for (const button of qsa<HTMLElement>('[data-save]')) {
      const slug = button.dataset.save ?? '';
      button.setAttribute('aria-pressed', savedSlugs.has(slug) ? 'true' : 'false');
    }
  } catch {
    // Leave the server-rendered state alone.
  }
}

async function loadComparedState(): Promise<void> {
  const skus = compareSkus();
  if (skus.length === 0) return;
  for (const button of qsa<HTMLElement>('[data-compare]')) {
    const slug = button.dataset.compare ?? '';
    const mine = await productSkus(slug);
    if (skus.some((sku) => mine.includes(sku))) {
      comparedSlugs.add(slug);
      button.setAttribute('aria-pressed', 'true');
    }
  }
  updateCompareLink();
}

export function setupCardControls(): void {
  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const swatch = target.closest<HTMLElement>('[data-card-colours] [role="radio"]');
    if (swatch !== null) {
      event.preventDefault();
      const group = swatch.closest<HTMLElement>('[data-card-colours]');
      const card = swatch.closest<HTMLElement>('[data-card]');
      if (group === null || card === null) return;
      for (const radio of qsa<HTMLElement>('[role="radio"]', group)) {
        radio.setAttribute('aria-checked', radio === swatch ? 'true' : 'false');
        radio.setAttribute('tabindex', radio === swatch ? '0' : '-1');
      }
      const image = qs<HTMLImageElement>('[data-card-image]', card);
      if (image !== null && swatch.dataset.image !== undefined) image.src = swatch.dataset.image;
      return;
    }

    const compare = target.closest<HTMLElement>('[data-compare]');
    if (compare !== null) {
      event.preventDefault();
      const card = compare.closest<HTMLElement>('[data-card]');
      const name = qs<HTMLElement>('.card-name', card ?? document)?.textContent ?? '';
      void toggleCompare(compare.dataset.compare ?? '', name);
      return;
    }

    const save = target.closest<HTMLElement>('[data-save]');
    if (save !== null) {
      event.preventDefault();
      const label = save.textContent ?? '';
      const name = label.replace(/^Save /, '').replace(/ to wishlist$/, '');
      void toggleSave(save.dataset.save ?? '', name);
    }
  });

  document.addEventListener('keydown', (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;
    const group = target.closest<HTMLElement>('[data-card-colours]');
    if (group === null) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const radios = qsa<HTMLElement>('[role="radio"]', group);
    const index = radios.indexOf(target);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = radios[(index + step + radios.length) % radios.length];
    for (const radio of radios) {
      radio.setAttribute('aria-checked', radio === next ? 'true' : 'false');
      radio.setAttribute('tabindex', radio === next ? '0' : '-1');
    }
    next.focus();
    const card = group.closest<HTMLElement>('[data-card]');
    const image = card === null ? null : qs<HTMLImageElement>('[data-card-image]', card);
    if (image !== null && next.dataset.image !== undefined) image.src = next.dataset.image;
  });

  void loadSavedState();
  void loadComparedState();
}

export function setupCollection(): void {
  document.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement | null;
    if (target === null) return;
    if (target.matches('[data-filter-group]')) {
      toggleFilter(target.dataset.filterGroup ?? '', target.dataset.filterValue ?? '', target.checked);
      return;
    }
    if (target.matches('[data-sort]')) {
      const params = readParams();
      if (target.value === 'featured') params.delete('sort');
      else params.set('sort', target.value);
      params.delete('page');
      writeParams(params, false);
      void render(params);
    }
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    if (target === null) return;

    const removeFilter = target.closest<HTMLElement>('[data-remove-filter]');
    if (removeFilter !== null) {
      event.preventDefault();
      toggleFilter(removeFilter.dataset.filterGroup ?? '', removeFilter.dataset.filterValue ?? '', false);
      return;
    }

    if (target.closest('[data-clear-filters]') !== null) {
      event.preventDefault();
      const params = readParams();
      for (const group of GROUPS) params.delete(group);
      params.delete('page');
      writeParams(params, false);
      void render(params);
      return;
    }

    if (target.closest('[data-show-results]') !== null) {
      closeDialog('filters');
      return;
    }

    const pageLink = target.closest<HTMLElement>('[data-page-to]');
    if (pageLink !== null) {
      event.preventDefault();
      const params = readParams();
      const page = Number(pageLink.dataset.pageTo);
      if (page === 1) params.delete('page');
      else params.set('page', String(page));
      writeParams(params, false);
      void render(params);
    }
  });

  window.addEventListener('popstate', () => {
    void render(readParams());
  });
}
