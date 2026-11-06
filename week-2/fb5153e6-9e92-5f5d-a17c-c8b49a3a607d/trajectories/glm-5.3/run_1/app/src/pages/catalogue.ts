import type { PageContext } from './render.js';
import { layout, escapeHtml, withLang, langParam } from './render.js';
import { t } from '../locales.js';
import { catalogueResult, parseCatalogueParams, type Card } from '../api/public.js';
import { serviceUp } from '../providers/availability.js';
import { formatAmount } from '../locales.js';

export interface CatalogueState {
  q: string;
  category: string[];
  licence: string[];
  format: string[];
  sort: string;
  page: number;
}

export function stateFromQuery(query: URLSearchParams): CatalogueState {
  const split = (name: string): string[] =>
    (query.get(name) ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value !== '');
  return {
    q: query.get('q') ?? '',
    category: split('category'),
    licence: split('licence'),
    format: split('format'),
    sort: query.get('sort') ?? 'newest',
    page: Number.parseInt(query.get('page') ?? '1', 10) || 1,
  };
}

export function queryOf(state: CatalogueState, lang: string): string {
  const params = new URLSearchParams();
  if (state.q !== '') params.set('q', state.q);
  if (state.category.length > 0) params.set('category', state.category.join(','));
  if (state.licence.length > 0) params.set('licence', state.licence.join(','));
  if (state.format.length > 0) params.set('format', state.format.join(','));
  if (state.sort !== 'newest') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  if (lang !== '') params.set('lang', lang.replace('lang=', ''));
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

interface FacetValue {
  value: string;
  label: string;
  count: number;
}

export async function renderCatalogue(ctx: PageContext): Promise<string> {
  const l = ctx.locale;
  const state = stateFromQuery(ctx.query);
  const searchUp = serviceUp('search');
  let result: Awaited<ReturnType<typeof catalogueResult>> | null = null;
  if (searchUp) {
    try {
      result = await catalogueResult(
        parseCatalogueParams(new URLSearchParams(queryOf(state, ''))),
      );
    } catch {
      result = null;
    }
  }
  const lang = langParam(ctx);
  ctx.title = t(l, 'catalogue.heading');
  ctx.clientCopy = {
    ...ctx.clientCopy,
    'catalogue.results.n': t(l, 'catalogue.results.n'),
    'catalogue.results.one': t(l, 'catalogue.results.one'),
    'catalogue.results.none': t(l, 'catalogue.results.none'),
    'catalogue.filters': t(l, 'catalogue.filters'),
    'catalogue.show_results': t(l, 'catalogue.show_results'),
    'catalogue.from': t(l, 'catalogue.from'),
    'outage.search_catalogue': t(l, 'outage.search_catalogue'),
  };

  const categoryFacets: FacetValue[] = [
    { value: 'hard-surface', label: t(l, 'facet.hard-surface'), count: result?.facets.category['hard-surface'] ?? 0 },
    { value: 'miniature', label: t(l, 'facet.miniature'), count: result?.facets.category['miniature'] ?? 0 },
    { value: 'scan', label: t(l, 'facet.scan'), count: result?.facets.category['scan'] ?? 0 },
  ];
  const licenceFacets: FacetValue[] = [
    { value: 'personal', label: t(l, 'facet.personal'), count: result?.facets.licence['personal'] ?? 0 },
    { value: 'commercial', label: t(l, 'facet.commercial'), count: result?.facets.licence['commercial'] ?? 0 },
    { value: 'studio', label: t(l, 'facet.studio'), count: result?.facets.licence['studio'] ?? 0 },
  ];
  const formatFacets: FacetValue[] = [
    { value: 'glb', label: t(l, 'facet.glb'), count: result?.facets.format['glb'] ?? 0 },
    { value: 'stl', label: t(l, 'facet.stl'), count: result?.facets.format['stl'] ?? 0 },
  ];

  const facetGroup = (name: 'category' | 'licence' | 'format', label: string, values: FacetValue[]): string => {
    const selected = state[name];
    const options = values.map(
      value => `        <li>
          <label class="facet">
            <input type="checkbox" name="${name}" value="${value.value}"${selected.includes(value.value) ? ' checked' : ''}>
            <span class="facet-label">${escapeHtml(value.label)}</span>
            <span class="facet-count">${value.count}</span>
          </label>
        </li>`,
    );
    return `      <fieldset class="facet-group" role="group" aria-label="${escapeHtml(label)}">
        <legend>${escapeHtml(label)}</legend>
        <ul class="facet-list">
${options.join('\n')}
        </ul>
      </fieldset>`;
  };

  const cards = (result?.items ?? []).map(
    card => `    <li class="card">
      <a class="card-link" href="${withLang(`/models/${card.slug}`, lang)}">
        <span class="card-preview"><img src="${card.preview_url}" alt="${escapeHtml(t(l, 'viewer.preview_of', { title: card.title }))}" loading="lazy"></span>
        <span class="card-title">${escapeHtml(card.title)}</span>
        <span class="card-meta">${escapeHtml(categoryLabel(l, card.category))}</span>
        <span class="card-meta mono">${escapeHtml(t(l, 'catalogue.from', { amount: formatAmount(card.price_from_cents, l) }))}</span>
      </a>
    </li>`,
  );

  const pages = result?.pages ?? 1;
  const pageItems: string[] = [];
  for (let n = 1; n <= pages; n++) {
    const stateCopy = { ...state, page: n };
    pageItems.push(
      `<a href="/catalogue${queryOf(stateCopy, lang)}"${n === state.page ? ' aria-current="page"' : ''}>${t(l, 'catalogue.page_n', { n })}</a>`,
    );
  }

  const main = `<div class="catalogue">
  <h1>${t(l, 'catalogue.heading')}</h1>
  <form class="catalogue-search" role="search" data-page="catalogue">
    <label class="visually-hidden" for="catalogue-q">${t(l, 'catalogue.search')}</label>
    <input type="search" id="catalogue-q" name="q" value="${escapeHtml(state.q)}" placeholder="${t(l, 'catalogue.search')}" autocomplete="off">
  </form>
  <p class="visually-hidden" role="status" id="catalogue-results" aria-live="polite">${resultCountCopy(l, result?.total ?? 0)}</p>
  <div class="catalogue-body">
    <div class="facet-rail" id="facet-rail">
      <button type="button" class="filters-toggle" id="filters-toggle" aria-expanded="false">${t(l, 'catalogue.filters')}</button>
      <div class="facet-scroll" id="facet-scroll">
${facetGroup('category', t(l, 'group.category'), categoryFacets)}
${facetGroup('licence', t(l, 'group.licence'), licenceFacets)}
${facetGroup('format', t(l, 'group.format'), formatFacets)}
      </div>
      <label class="sort-picker">
        <span>${t(l, 'sort.label')}</span>
        <select id="catalogue-sort" aria-label="${t(l, 'sort.label')}">
          <option value="newest"${state.sort === 'newest' ? ' selected' : ''}>${t(l, 'sort.newest')}</option>
          <option value="price_asc"${state.sort === 'price_asc' ? ' selected' : ''}>${t(l, 'sort.price_asc')}</option>
          <option value="price_desc"${state.sort === 'price_desc' ? ' selected' : ''}>${t(l, 'sort.price_desc')}</option>
        </select>
      </label>
    </div>
    <div class="catalogue-results">
      <div class="results-header">
        <p class="results-count" aria-hidden="true">${resultCountCopy(l, result?.total ?? 0)}</p>
      </div>
      <ul class="card-grid" id="results" role="list" aria-label="${t(l, 'catalogue.list')}">
${cards.join('\n') || `        <li class="empty-state">${t(l, 'catalogue.results.none')}</li>`}
      </ul>
      <nav class="pagination" aria-label="${t(l, 'catalogue.pages')}">
        <a class="page-link${state.page <= 1 ? ' disabled' : ''}" href="/catalogue${queryOf({ ...state, page: state.page - 1 }, lang)}" rel="prev">${t(l, 'catalogue.previous_page')}</a>
        ${pageItems.join('\n        ')}
        <a class="page-link${state.page >= pages ? ' disabled' : ''}" href="/catalogue${queryOf({ ...state, page: state.page + 1 }, lang)}" rel="next">${t(l, 'catalogue.next_page')}</a>
      </nav>
    </div>
  </div>
</div>`;
  return layout(ctx, main);
}

export function resultCountCopy(l: 'en' | 'de', count: number): string {
  if (count === 0) return t(l, 'catalogue.results.none');
  if (count === 1) return t(l, 'catalogue.results.one');
  return t(l, 'catalogue.results.n', { n: count });
}

export function categoryLabel(l: 'en' | 'de', category: string): string {
  if (category === 'hard-surface') return t(l, 'facet.hard-surface');
  if (category === 'miniature') return t(l, 'facet.miniature');
  return t(l, 'facet.scan');
}

export type { Card };
