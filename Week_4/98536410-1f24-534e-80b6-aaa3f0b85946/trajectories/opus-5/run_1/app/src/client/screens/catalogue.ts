import { announce, clear, el, on } from '../lib/dom.js';
import { LatestOnly, get } from '../lib/api.js';
import { COPY, amount } from '../lib/copy.js';
import { makeLife } from '../lib/life.js';
import type { Product } from '../lib/types.js';
import { navigate, type Screen } from '../router.js';

const SEARCH_DEBOUNCE_MILLIS = 333;

export function catalogueScreen(): Screen {
  const life = makeLife();
  const loader = new LatestOnly();
  let timer: number | null = null;

  const results = el('p', {
    class: 'live-region',
    role: 'status',
    'aria-label': 'Catalogue results',
  });

  const search = el('input', {
    type: 'search',
    class: 'text-box',
    'aria-label': 'Search products',
    'data-focus-id': 'search-products',
  });

  const grid = el('div', { class: 'product-grid' });

  async function load(): Promise<void> {
    const text = search.value.trim();
    announce(results, COPY.searching);
    try {
      await loader.run(
        () => get<{ count: number; products: Product[] }>(`/api/products?q=${encodeURIComponent(text)}`),
        (answer) => {
          clear(grid);
          for (const product of answer.products) {
            const link = el(
              'a',
              {
                class: 'product-card',
                href: `/products/${product.sku}`,
                'data-focus-id': `product-${product.sku}`,
              },
              [
                el('span', { class: 'product-name' }, product.name),
                el('span', { class: 'product-sku' }, product.sku),
                el('span', { class: 'product-price' }, amount(Math.round(product.unit_price_milli / 10))),
              ],
            );
            on(link, 'click', (event) => {
              event.preventDefault();
              void navigate(`/products/${product.sku}`);
            });
            grid.appendChild(link);
          }
          announce(results, `${answer.count} products found.`);
        },
      );
    } catch {
      announce(results, COPY.somethingWrong);
    }
  }

  on(search, 'input', () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = life.after(SEARCH_DEBOUNCE_MILLIS, () => void load());
  });

  const node = el('section', { class: 'catalogue-screen' }, [
    el('h1', { class: 'screen-title' }, 'Catalogue'),
    el('label', { class: 'field' }, [el('span', {}, 'Search products'), search]),
    results,
    grid,
  ]);

  return {
    node,
    destroy: () => life.kill(),
    afterMount: () => void load(),
  };
}
