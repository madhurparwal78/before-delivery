import { useEffect, useMemo, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { api } from '../lib/api.js';
import { navigate, usePath, useReducedMotion } from '../lib/router.js';
import { announce, LoadingPanel, ErrorPanel } from '../app.js';
import { store, type Cart } from '../lib/store.js';
import { rupees, CONFIG } from '../lib/format.js';
import { ApiFailure } from '../lib/api.js';

type SearchResponse = {
  mode: 'search' | 'fallback';
  total: number;
  page: number;
  page_size: number;
  results: ProductCard[];
  facets: Record<string, Record<string, number>> | null;
  notice: string | null;
};

export type ProductCard = {
  slug: string; name: string; category: string; min_price: number; compare_at: number | null;
  save_percent: number | null; colours: { name: string; slug: string; image_url: string }[]; badge: string;
  varies_in_price: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  luggage: 'Luggage', backpacks: 'Backpacks', totes: 'Totes', wallets: 'Wallets', accessories: 'Accessories',
};
const SIZE_ORDER = ['cabin', 'check-in-medium', 'check-in-large', 'underseat', 'one-size'];
const SIZE_LABELS: Record<string, string> = {
  cabin: 'Cabin', 'check-in-medium': 'Check-in Medium', 'check-in-large': 'Check-in Large', underseat: 'Underseat', 'one-size': 'One size',
};
const PRICE_BANDS: { slug: string; label: string }[] = [
  { slug: 'under-5000', label: 'Under ₹5,000' },
  { slug: '5000-9999', label: '₹5,000 to ₹9,999' },
  { slug: '10000-19999', label: '₹10,000 to ₹19,999' },
  { slug: '20000-plus', label: '₹20,000 and over' },
];

export type UrlState = {
  q: string;
  category: string[];
  colour: string[];
  size: string[];
  material: string[];
  price: string[];
  fit: string[];
  sort: string;
  page: number;
  compare: string[];
};

/** The catalogue state lives in the address, so reload restores it. */
export function readAddress(url: URL): UrlState {
  return {
    q: url.searchParams.get('q') ?? '',
    category: list(url.searchParams.get('category')),
    colour: list(url.searchParams.get('colour')),
    size: list(url.searchParams.get('size')),
    material: list(url.searchParams.get('material')),
    price: list(url.searchParams.get('price')),
    fit: list(url.searchParams.get('fit')),
    sort: url.searchParams.get('sort') ?? 'featured',
    page: Number(url.searchParams.get('page') ?? 1) || 1,
    compare: list(url.searchParams.get('compare')),
  };
}

function list(value: string | null): string[] {
  if (value === null || value === '') return [];
  return value.split(',').filter((v) => v.length > 0);
}

export function writeAddress(slug: string, state: UrlState, replace: boolean): void {
  const params = new URLSearchParams();
  if (state.q !== '') params.set('q', state.q);
  for (const key of ['category', 'colour', 'size', 'material', 'price', 'fit', 'compare'] as const) {
    if (state[key].length > 0) params.set(key, state[key].join(','));
  }
  if (state.sort !== 'featured') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const qs = params.toString();
  navigate(`/collections/${slug}${qs === '' ? '' : `?${qs}`}`, replace);
}

export function Collection(props: { slug: string }): JSX.Element {
  const path = usePath();
  const url = useMemo(() => new URL(path, location.origin), [path]);
  const state = useMemo(() => readAddress(url), [url]);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setData(null);
    const params = new URLSearchParams();
    if (state.q !== '') params.set('q', state.q);
    for (const key of ['category', 'colour', 'size', 'material', 'price', 'fit'] as const) {
      if (state[key].length > 0) params.set(key, state[key].join(','));
    }
    if (state.sort !== 'featured') params.set('sort', state.sort);
    params.set('page', String(state.page));
    params.set('collection', props.slug);
    void api.get<SearchResponse>(`/api/search?${params.toString()}`)
      .then((d) => {
        setData(d);
        announce('result-count', `${d.total} ${d.total === 1 ? 'product' : 'products'}`);
      })
      .catch(() => setFailed(true));
  }, [path]);

  if (failed) return <ErrorPanel message="Something went wrong on our side. Try again." />;
  if (data === null) return <LoadingPanel />;

  const toggle = (group: 'category' | 'colour' | 'size' | 'material' | 'price' | 'fit', value: string): void => {
    const next = { ...state, page: 1 };
    const current = new Set(next[group]);
    if (current.has(value)) current.delete(value);
    else current.add(value);
    next[group] = [...current];
    // Each filter change adds one browser history entry.
    writeAddress(props.slug, next, false);
  };

  const pages = Math.max(1, Math.ceil(data.total / CONFIG.page_size));

  return (
    <div class="collection" data-collection={props.slug}>
      <section class="band collection-band">
        <p class="band-numeral">{data.total}</p>
        <p class="band-caption">products</p>
      </section>
      {data.mode === 'fallback' ? (
        <p role="status" aria-live="polite" id="search-notice" class="search-notice">
          Search is unavailable. You can still browse and filter, but typo matching and filter counts are off.
        </p>
      ) : null}

      <div class="collection-layout">
        <aside class="left-zone">
          <button class="filters-button" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>Filters</button>
          <p role="status" aria-live="polite" id="result-count-region">{data.total} {data.total === 1 ? 'product' : 'products'}</p>
          <ul class="active-filters" role="list" aria-label="Active filters">
            {[...state.category, ...state.colour, ...state.size, ...state.material, ...state.price, ...state.fit].map((value) => (
              <li key={value}>
                <button aria-label={`Remove filter ${value}`} onClick={() => {
                  const next = { ...state, page: 1 };
                  for (const key of ['category', 'colour', 'size', 'material', 'price', 'fit'] as const) {
                    next[key] = next[key].filter((v) => v !== value);
                  }
                  writeAddress(props.slug, next, false);
                }}>{value}</button>
              </li>
            ))}
            {[...state.category, ...state.colour, ...state.size, ...state.material, ...state.price, ...state.fit].length > 0 ? (
              <li><button class="clear-filters" onClick={() => writeAddress(props.slug, { ...state, category: [], colour: [], size: [], material: [], price: [], fit: [], page: 1 }, false)}>Clear all filters</button></li>
            ) : null}
          </ul>
          <FilterPanel state={state} facets={data.facets} mode={data.mode} onToggle={toggle} showCategory={props.slug === 'all'} />
          <div class="sort-row">
            <label>
              <span>Sort by</span>
              <select
                aria-label="Sort by"
                value={state.sort}
                onChange={(e) => writeAddress(props.slug, { ...state, sort: (e.target as HTMLSelectElement).value, page: 1 }, false)}
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="newest">Newest</option>
              </select>
            </label>
          </div>
          {state.compare.length > 0 ? (
            <a class="compare-link" href={`/compare?compare=${state.compare.join(',')}`} onClick={(e) => {
              e.preventDefault();
              navigate(`/compare?compare=${state.compare.join(',')}`);
            }}>Compare {state.compare.length} selected</a>
          ) : null}
        </aside>

        <div class="grid-zone">
          <ul class="product-grid" role="list">
            {data.results.map((product) => (
              <ProductTile key={product.slug} product={product} state={state} slug={props.slug} />
            ))}
          </ul>
          {data.total === 0 ? (
            <section class="panel empty-panel"><p>Nothing matches. Remove a filter or try another word.</p></section>
          ) : null}
          <nav aria-label="Pages" class="pagination">
            {state.page > 1 ? <a href="#" aria-label="Previous page" onClick={(e) => { e.preventDefault(); writeAddress(props.slug, { ...state, page: state.page - 1 }, false); }}>Previous page</a> : null}
            {Array.from({ length: pages }, (_, k) => (
              <a key={k} aria-label={`Page ${k + 1}`} aria-current={state.page === k + 1 ? 'page' : undefined} class={state.page === k + 1 ? 'current' : ''} href="#" onClick={(e) => { e.preventDefault(); writeAddress(props.slug, { ...state, page: k + 1 }, false); }}>{k + 1}</a>
            ))}
            {state.page < pages ? <a href="#" aria-label="Next page" onClick={(e) => { e.preventDefault(); writeAddress(props.slug, { ...state, page: state.page + 1 }, false); }}>Next page</a> : null}
          </nav>
        </div>
      </div>

      {sheetOpen ? (
        <div class="dialog-backdrop filter-sheet-backdrop">
          <div role="dialog" aria-modal="true" aria-label="Filters" class="filter-sheet"
            data-motion-ms={reduced ? '0' : '320'} data-state="open">
            <FilterPanel state={state} facets={data.facets} mode={data.mode} onToggle={toggle} showCategory={props.slug === 'all'} inSheet />
            <button class="primary show-results" onClick={() => setSheetOpen(false)}>Show results</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterPanel(props: {
  state: UrlState;
  facets: Record<string, Record<string, number>> | null;
  mode: string;
  onToggle: (group: 'category' | 'colour' | 'size' | 'material' | 'price' | 'fit', value: string) => void;
  showCategory: boolean;
  inSheet?: boolean;
}): JSX.Element {
  const { state, facets, mode } = props;
  const facetFor = (key: string): Record<string, number> | null => (mode === 'fallback' ? null : facets?.[key] ?? null);

  const optionRow = (group: 'category' | 'colour' | 'size' | 'material' | 'price' | 'fit', value: string, label: string, count: number | null): JSX.Element => (
    <li>
      <label>
        <input
          type="checkbox"
          checked={state[group].includes(value)}
          onChange={() => props.onToggle(group, value)}
          aria-describedby={count === null ? undefined : `${group}-${value}-count`}
        />
        <span>{label}</span>
        {count !== null ? <span id={`${group}-${value}-count`} class="facet-count">{count}</span> : null}
      </label>
    </li>
  );

  const colourOrder = facetFor('colour') !== null ? Object.keys(facetFor('colour')!) : [];
  const materialOrder = facetFor('material') !== null ? Object.keys(facetFor('material')!) : [];
  const fitOrder = facetFor('fit') !== null ? Object.keys(facetFor('fit')!) : [];

  return (
    <div class="filters" role={props.inSheet === true ? undefined : 'region'} aria-label={props.inSheet === true ? undefined : 'Filters'}>
      {props.showCategory && facetFor('category') !== null ? (
        <fieldset>
          <legend>Category</legend>
          <ul role="group" aria-label="Category">
            {Object.keys(CATEGORY_LABELS).filter((c) => (facetFor('category')?.[c] ?? 0) > 0).map((c) => optionRow('category', c, CATEGORY_LABELS[c], facetFor('category')?.[c] ?? 0))}
          </ul>
        </fieldset>
      ) : null}
      {facetFor('colour') !== null ? (
        <fieldset>
          <legend>Colour</legend>
          <ul role="group" aria-label="Colour">
            {colourOrder.map((c) => optionRow('colour', c, c.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()), facetFor('colour')![c]))}
          </ul>
        </fieldset>
      ) : null}
      {facetFor('size') !== null ? (
        <fieldset>
          <legend>Size</legend>
          <ul role="group" aria-label="Size">
            {SIZE_ORDER.filter((s) => (facetFor('size')?.[s] ?? 0) > 0).map((s) => optionRow('size', s, SIZE_LABELS[s], facetFor('size')?.[s] ?? 0))}
          </ul>
        </fieldset>
      ) : null}
      {facetFor('material') !== null ? (
        <fieldset>
          <legend>Material</legend>
          <ul role="group" aria-label="Material">
            {materialOrder.map((m) => optionRow('material', m, m.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()), facetFor('material')![m]))}
          </ul>
        </fieldset>
      ) : null}
      {facetFor('price') !== null ? (
        <fieldset>
          <legend>Price</legend>
          <ul role="group" aria-label="Price">
            {PRICE_BANDS.filter((b) => (facetFor('price')?.[b.slug] ?? 0) > 0).map((b) => optionRow('price', b.slug, b.label, facetFor('price')?.[b.slug] ?? 0))}
          </ul>
        </fieldset>
      ) : null}
      {facetFor('fit') !== null && fitOrder.length > 0 ? (
        <fieldset>
          <legend>Cabin fit</legend>
          <ul role="group" aria-label="Cabin fit">
            {fitOrder.map((f) => optionRow('fit', f, f.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()), facetFor('fit')![f]))}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}

function ProductTile(props: { product: ProductCard; state: UrlState; slug: string }): JSX.Element {
  const { product } = props;
  const [colour, setColour] = useState(product.colours[0]?.slug ?? '');
  const saved = store.wishlist.items.some((w) => w.slug === product.slug);
  const [busy, setBusy] = useState(false);
  const selected = product.colours.find((c) => c.slug === colour) ?? product.colours[0];

  const toggleWishlist = async (): Promise<void> => {
    setBusy(true);
    try {
      if (saved) {
        store.wishlist = await api.delete(`/api/wishlist/${product.slug}`);
        announce('cart-updates', `Removed ${product.name} from your wishlist.`);
      } else {
        store.wishlist = await api.put(`/api/wishlist/${product.slug}`);
        announce('cart-updates', `Saved ${product.name} to your wishlist.`);
      }
      store.emit();
    } finally {
      setBusy(false);
    }
  };

  const quickAdd = async (): Promise<void> => {
    setBusy(true);
    try {
      // Quick add uses the card's selected colour in its first size.
      const detail = await api.get<ProductDetail>(`/api/products/${product.slug}`);
      const firstColour = detail.variants.find((v) => v.colour_slug === colour) ?? detail.variants[0];
      const cart = await api.post<Cart>('/api/cart/lines', { sku: firstColour.sku, quantity: 1 });
      store.cart = cart;
      store.emit();
      const total = cart.totals.total;
      announce('cart-updates', `Added ${product.name} — ${firstColour.colour}, ${firstColour.size} to your bag. Bag total ${rupees(total)}.`);
    } catch (err) {
      const message = err instanceof ApiFailure ? err.body.message : 'Something went wrong.';
      announce('cart-updates', message);
    } finally {
      setBusy(false);
    }
  };

  const toggleCompare = (): void => {
    // Compare adds the same variant as quick add: the selected colour, first size.
    // The current set is read live from the address so rapid clicks stay accurate.
    const live = readAddress(new URL(location.href));
    void api.get<ProductDetail>(`/api/products/${product.slug}`).then((detail) => {
      const firstColour = detail.variants.find((v) => v.colour_slug === colour) ?? detail.variants[0];
      const next = { ...props.state, compare: live.compare, page: 1 };
      const existing = next.compare.find((sku) => detail.variants.some((v) => v.sku === sku));
      if (existing !== undefined) {
        next.compare = next.compare.filter((sku) => sku !== existing);
        announce('compare-updates', `Removed ${product.name} from comparison.`);
      } else if (next.compare.length >= CONFIG.compare_max) {
        announce('compare-updates', `You can compare up to ${CONFIG.compare_max} products.`);
        return;
      } else {
        next.compare = [...next.compare, firstColour.sku];
        announce('compare-updates', `Added ${product.name} to comparison.`);
      }
      writeAddress(props.slug, next, false);
    });
  };

  const anyCompared = props.state.compare.some((sku) => product.slug.startsWith(sku.split('-')[0]));

  return (
    <li>
      <article aria-label={product.name} class="product-card">
        <a href={`/products/${product.slug}`} onClick={(e) => { e.preventDefault(); navigate(`/products/${product.slug}`); }}>
          <img src={selected?.image_url ?? ''} alt={`${product.name} in ${selected?.name ?? ''}`} />
          <h3>{product.name}</h3>
        </a>
        {product.colours.length > 1 ? (
          <div role="radiogroup" aria-label={`Colour for ${product.name}`} class="swatches">
            {product.colours.map((c) => (
              <label key={c.slug} class="swatch">
                <input type="radio" name={`colour-${product.slug}`} value={c.slug} checked={colour === c.slug} onChange={() => setColour(c.slug)} />
                <span aria-hidden="true" style={`background: var(--${c.slug})`}>{c.name}</span>
                <span class="visually-hidden">{c.name}</span>
              </label>
            ))}
          </div>
        ) : null}
        <p class="price">
          {product.compare_at !== null ? <s>{rupees(product.compare_at)}</s> : null}
          {product.varies_in_price ? `From ${rupees(product.min_price)}` : rupees(product.min_price)}
          {product.save_percent !== null ? ` Save ${product.save_percent}%` : ''}
        </p>
        <p class={`badge ${product.badge === 'Out of stock' ? 'out' : product.badge.startsWith('Only') ? 'low' : 'in'}`}>{product.badge}</p>
        <div class="card-actions">
          <button disabled={busy} onClick={() => { void quickAdd(); }}>{busy ? 'Adding' : `Quick add ${product.name}`}</button>
          <button aria-pressed={anyCompared} onClick={toggleCompare}>Compare {product.name}</button>
          <button aria-pressed={saved} disabled={busy} onClick={() => { void toggleWishlist(); }}>Save {product.name} to wishlist</button>
        </div>
      </article>
    </li>
  );
}

export type ProductDetail = {
  slug: string; name: string; category: string; material: string; warranty_years: number; saves: number;
  variants: { sku: string; colour: string; colour_slug: string; size: string; size_slug: string; price: number; compare_at: number | null; save_percent: number | null; available: number; badge: string; dimensions_cm: { height: number; width: number; depth: number }; weight_kg: number; images: { id: string; url: string; alt: string; position: number }[] }[];
};
