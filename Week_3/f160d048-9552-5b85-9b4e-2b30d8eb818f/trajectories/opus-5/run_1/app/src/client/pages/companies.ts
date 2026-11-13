import { CITIES, reviewCountText } from '../../shared/reference';
import { announce } from '../core/announce';
import { get } from '../core/api';
import { el, on } from '../core/dom';
import { replaceQuery, type Cleanup, type PageContext } from '../core/router';
import { pageAlert } from '../core/shell';
import { chipGroup } from '../widgets/chips';
import { SEARCH_DEBOUNCE_MS } from '../widgets/combobox';

interface CompanyHit {
  slug: string;
  name: string;
  city_name: string;
  verified: boolean;
  rating: number | null;
  review_count: number;
}

interface CompanySearchOutcome {
  total?: number;
  hits?: CompanyHit[];
  facets?: { city?: Record<string, number> };
  fallback?: string;
  cities?: Array<{ city: string; city_name: string; total: number; companies: CompanyHit[] }>;
}

function hitItem(hit: CompanyHit): HTMLElement {
  return el('li', { 'data-id': hit.slug }, [
    el('a', { href: `/companies/${hit.slug}`, text: hit.name }),
    el('p', {
      class: 'figures',
      text: `${hit.city_name} · ${hit.rating === null ? 'No ratings yet' : hit.rating.toFixed(1)} · ${reviewCountText(hit.review_count)}`,
    }),
  ]);
}

export async function renderCompanySearch(container: HTMLElement, ctx: PageContext): Promise<Cleanup> {
  const page = el('div', { class: 'working-screen' });
  container.append(page);
  const alert = pageAlert(page);

  const searchBox = el('input', {
    type: 'search',
    role: 'searchbox',
    'aria-label': 'Search companies',
    class: 'textbox',
  });
  searchBox.value = ctx.query.get('q') ?? '';
  const results = el('ul', { 'aria-label': 'Company results', class: 'plain-list' });
  const fallbackHost = el('div');
  const countLine = el('p', { class: 'count-line' });

  let timer = 0;
  const cities = chipGroup({
    name: 'City',
    chips: CITIES.map((city) => ({ id: city.id, label: city.name })),
    onToggle: () => schedule(),
  });
  cities.setPressed(ctx.query.getAll('city'));

  const run = async (): Promise<void> => {
    const query = new URLSearchParams();
    if (searchBox.value.trim()) query.set('q', searchBox.value.trim());
    for (const city of cities.pressed()) query.append('city', city);
    replaceQuery(query);
    const outcome = await get<CompanySearchOutcome>(`/api/companies/search?${query.toString()}`);
    fallbackHost.replaceChildren();
    if (outcome.fallback === 'by_city') {
      alert('Search is unavailable right now. Showing all companies by city instead.');
      const list = el('ul', { 'aria-label': 'Companies by city', class: 'plain-list' });
      for (const city of outcome.cities ?? []) {
        const inner = el('ul', { class: 'plain-list' });
        for (const company of city.companies) inner.append(hitItem(company));
        list.append(el('li', {}, [el('h3', { text: city.city_name }), inner]));
      }
      fallbackHost.append(list);
      results.replaceChildren();
      countLine.textContent = '';
      return;
    }
    alert(null);
    results.replaceChildren(...(outcome.hits ?? []).map(hitItem));
    cities.setCounts(outcome.facets?.city ?? {});
    const total = outcome.total ?? 0;
    countLine.textContent = total === 1 ? '1 company found' : `${total} companies found`;
    announce(countLine.textContent);
  };

  function schedule(): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), SEARCH_DEBOUNCE_MS);
  }

  on(searchBox, 'input', schedule);
  page.append(
    el('h1', { text: 'Companies' }),
    searchBox,
    el('div', { class: 'facet-group' }, [el('h2', { text: 'City' }), cities.element]),
    countLine,
    results,
    fallbackHost,
  );
  await run();
  return () => window.clearTimeout(timer);
}
