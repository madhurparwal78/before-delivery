/** Search: the address bar holds the query, the filters, the pincode and the sort. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link, useRouter } from '../router.tsx';
import { usePincode } from '../state.tsx';
import { Dialog, StatusRegion, useWideViewport } from '../components/ui.tsx';
import { ProductCard } from '../components/ProductCard.tsx';
import { categoryName } from '../../shared/catalogue.js';
import { COPY, resultCount } from '../../shared/messages.js';
import type { SearchResponse } from '../../shared/types.js';

type Filters = {
  q: string;
  category: string;
  brand: string[];
  seller: string[];
  priceMin: string;
  priceMax: string;
  rating: string;
  pin: string;
  deliverable: boolean;
  sort: string;
};

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Rating' },
  { value: 'newest', label: 'Newest' },
];

function readFilters(search: string): Filters {
  const params = new URLSearchParams(search);
  const list = (name: string): string[] => {
    const raw = params.get(name);
    return raw === null || raw === '' ? [] : raw.split(',');
  };
  return {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    brand: list('brand'),
    seller: list('seller'),
    priceMin: params.get('price_min') ?? '',
    priceMax: params.get('price_max') ?? '',
    rating: params.get('rating') ?? '',
    pin: params.get('pin') ?? '',
    deliverable: params.get('deliverable') === '1',
    sort: params.get('sort') ?? '',
  };
}

function writeFilters(filters: Filters): string {
  const params = new URLSearchParams();
  const add = (name: string, value: string): void => {
    if (value !== '') params.set(name, value);
  };
  add('q', filters.q);
  add('category', filters.category);
  add('brand', filters.brand.join(','));
  add('seller', filters.seller.join(','));
  add('price_min', filters.priceMin);
  add('price_max', filters.priceMax);
  add('rating', filters.rating);
  add('pin', filters.pin);
  if (filters.deliverable) params.set('deliverable', '1');
  add('sort', filters.sort);
  const query = params.toString();
  return query === '' ? '/search' : `/search?${query}`;
}

const sellerNames = new Map<string, string>();

export function SearchPage(): ReactNode {
  const { search, navigate } = useRouter();
  const [pincode, setPincode] = usePincode();
  const filters = useMemo(() => readFilters(search), [search]);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [extra, setExtra] = useState<SearchResponse['hits']>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [compareMessage, setCompareMessage] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [priceDraft, setPriceDraft] = useState({ min: filters.priceMin, max: filters.priceMax });
  const wide = useWideViewport();
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setPriceDraft({ min: filters.priceMin, max: filters.priceMax });
  }, [filters.priceMin, filters.priceMax]);

  useEffect(() => {
    const mine = ++requestId.current;
    const params = new URLSearchParams(search);
    void api<SearchResponse>(`/api/search?${params.toString()}`)
      .then((response) => {
        if (mine !== requestId.current) return;
        for (const hit of response.hits) sellerNames.set(hit.seller_id, hit.seller_name);
        setResults(response);
        setExtra([]);
        setCursor(response.next_cursor);
      })
      .catch(() => {
        if (mine === requestId.current) setResults(null);
      });
  }, [search]);

  const update = (next: Partial<Filters>): void => {
    navigate(writeFilters({ ...filters, ...next }));
  };

  const hits = [...(results?.hits ?? []), ...extra];
  const categoryFacets = Object.entries(results?.facets.category ?? {});
  const brandFacets = Object.entries(results?.facets.brand ?? {});
  const sellerFacets = Object.entries(results?.facets.seller ?? {});
  const ratingFacets = results?.facets.rating ?? {};

  const toggleCompare = (hit: SearchResponse['hits'][number]): void => {
    if (compare.includes(hit.product_id)) {
      setCompare(compare.filter((id) => id !== hit.product_id));
      setCompareMessage('');
      return;
    }
    if (compare.length >= 4) {
      setCompareMessage(COPY.compareOverFour);
      return;
    }
    const chosen = hits.filter((entry) => compare.includes(entry.product_id));
    if (chosen.some((entry) => entry.category !== hit.category)) {
      setCompareMessage(COPY.compareMixedCategories);
      return;
    }
    setCompare([...compare, hit.product_id]);
    setCompareMessage('');
  };

  const loadMore = async (): Promise<void> => {
    if (cursor === null) return;
    const params = new URLSearchParams(search);
    params.set('cursor', cursor);
    const response = await api<SearchResponse>(`/api/search?${params.toString()}`);
    for (const hit of response.hits) sellerNames.set(hit.seller_id, hit.seller_name);
    const firstNewIndex = (results?.hits.length ?? 0) + extra.length;
    setExtra((previous) => [...previous, ...response.hits]);
    setCursor(response.next_cursor);
    setPendingFocus(firstNewIndex);
  };

  const facetPanel = (
    <div className="facet-rail">
      <h3>filters</h3>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>category</legend>
        {categoryFacets.map(([slug, count]) => (
          <div className="check-row" key={slug}>
            <input
              id={`facet-category-${slug}`}
              type="checkbox"
              aria-label={categoryName(slug)}
              checked={filters.category === slug}
              onChange={() => update({ category: filters.category === slug ? '' : slug })}
            />
            <label htmlFor={`facet-category-${slug}`}>{`${categoryName(slug)} (${count})`}</label>
          </div>
        ))}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>brand</legend>
        {brandFacets.map(([brand, count]) => (
          <div className="check-row" key={brand}>
            <input
              id={`facet-brand-${brand}`}
              type="checkbox"
              aria-label={brand}
              checked={filters.brand.includes(brand)}
              onChange={() =>
                update({
                  brand: filters.brand.includes(brand)
                    ? filters.brand.filter((entry) => entry !== brand)
                    : [...filters.brand, brand],
                })
              }
            />
            <label htmlFor={`facet-brand-${brand}`}>{`${brand} (${count})`}</label>
          </div>
        ))}
      </fieldset>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>seller</legend>
        {sellerFacets.map(([sellerId, count]) => (
          <div className="check-row" key={sellerId}>
            <input
              id={`facet-seller-${sellerId}`}
              type="checkbox"
              aria-label={sellerNames.get(sellerId) ?? sellerId}
              checked={filters.seller.includes(sellerId)}
              onChange={() =>
                update({
                  seller: filters.seller.includes(sellerId)
                    ? filters.seller.filter((entry) => entry !== sellerId)
                    : [...filters.seller, sellerId],
                })
              }
            />
            <label htmlFor={`facet-seller-${sellerId}`}>
              {`${sellerNames.get(sellerId) ?? sellerId} (${count})`}
            </label>
          </div>
        ))}
      </fieldset>
      <label htmlFor="facet-price-min">Minimum price</label>
      <input
        id="facet-price-min"
        type="number"
        role="spinbutton"
        aria-label="Minimum price"
        min={0}
        value={priceDraft.min}
        onChange={(event) => setPriceDraft({ ...priceDraft, min: event.target.value })}
      />
      <label htmlFor="facet-price-max">Maximum price</label>
      <input
        id="facet-price-max"
        type="number"
        role="spinbutton"
        aria-label="Maximum price"
        min={0}
        value={priceDraft.max}
        onChange={(event) => setPriceDraft({ ...priceDraft, max: event.target.value })}
      />
      <fieldset style={{ border: 0, padding: 0, margin: 0 }} role="radiogroup" aria-label="Rating">
        <legend>rating</legend>
        <div className="radio-row">
          <input
            id="facet-rating-4"
            type="radio"
            name="rating"
            aria-label="4 stars &amp; up"
            checked={filters.rating === '4'}
            onChange={() => update({ rating: '4' })}
          />
          <label htmlFor="facet-rating-4">{`4 stars & up (${ratingFacets['4'] ?? 0})`}</label>
        </div>
        <div className="radio-row">
          <input
            id="facet-rating-3"
            type="radio"
            name="rating"
            aria-label="3 stars &amp; up"
            checked={filters.rating === '3'}
            onChange={() => update({ rating: '3' })}
          />
          <label htmlFor="facet-rating-3">{`3 stars & up (${ratingFacets['3'] ?? 0})`}</label>
        </div>
      </fieldset>
      {filters.pin === '' && pincode === null ? null : (
        <div className="check-row">
          <input
            id="facet-deliverable"
            type="checkbox"
            aria-label={`Only items that deliver to ${filters.pin === '' ? (pincode ?? '') : filters.pin}`}
            checked={filters.deliverable}
            onChange={() =>
              update({
                deliverable: !filters.deliverable,
                pin: filters.pin === '' ? (pincode ?? '') : filters.pin,
              })
            }
          />
          <label htmlFor="facet-deliverable">
            {`Only items that deliver to ${filters.pin === '' ? (pincode ?? '') : filters.pin}`}
          </label>
        </div>
      )}
      <label htmlFor="facet-pin">pincode</label>
      <input
        id="facet-pin"
        type="text"
        aria-label="Pincode"
        inputMode="numeric"
        defaultValue={filters.pin}
        onBlur={(event) => {
          const value = event.target.value.trim();
          if (/^[1-9][0-9]{5}$/.test(value)) {
            setPincode(value);
            update({ pin: value });
          }
        }}
      />
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() =>
          navigate(
            writeFilters({
              q: filters.q,
              category: '',
              brand: [],
              seller: [],
              priceMin: '',
              priceMax: '',
              rating: '',
              pin: '',
              deliverable: false,
              sort: filters.sort,
            }),
          )
        }
      >
        Clear filters
      </button>
    </div>
  );

  useEffect(() => {
    if (pendingFocus === null) return;
    itemRefs.current[pendingFocus]?.querySelector<HTMLElement>('a, input, button')?.focus();
    setPendingFocus(null);
  }, [pendingFocus, extra.length]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (priceDraft.min !== filters.priceMin || priceDraft.max !== filters.priceMax) {
        update({ priceMin: priceDraft.min, priceMax: priceDraft.max });
      }
    }, 330);
    return () => clearTimeout(timer);
  }, [priceDraft.min, priceDraft.max]);

  return (
    <>
      <h1>{filters.q === '' ? COPY.allProducts : `results for ${filters.q}`}</h1>
      {results?.degraded === true ? (
        <div className="panel panel-black" role="note">
          {COPY.searchDegraded}
        </div>
      ) : null}
      <div className="row">
        {wide ? null : (
          <button type="button" className="btn btn-yellow" onClick={() => setFiltersOpen(true)}>
            Filters
          </button>
        )}
        <label htmlFor="sort-by" className="sr-only">
          Sort by
        </label>
        <select
          id="sort-by"
          aria-label="Sort by"
          value={filters.sort === '' ? (filters.q === '' ? 'newest' : 'relevance') : filters.sort}
          onChange={(event) => update({ sort: event.target.value })}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="spacer" />
        <Link
          to={`/compare?ids=${compare.join(',')}&diff=0`}
          className={compare.length >= 2 ? 'btn' : 'btn btn-quiet'}
          ariaLabel={`Compare (${compare.length})`}
        >
          {`Compare (${compare.length})`}
        </Link>
      </div>
      <StatusRegion
        name="Search results"
        message={
          compareMessage !== ''
            ? compareMessage
            : results === null
              ? ''
              : resultCount(results.total)
        }
      />
      <div className="search-layout">
        {wide ? (
          <aside role="complementary" aria-label="Filters">
            {facetPanel}
          </aside>
        ) : null}
        <div>
          {results !== null && results.total === 0 ? (
            <div className="panel panel-pink">
              <p className="shout">{COPY.noResults}</p>
            </div>
          ) : null}
          <ul className="plain grid results-grid" role="list" aria-label="Products">
            {hits.map((hit, index) => (
              <li
                key={`${hit.listing_id}-${index}`}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
              >
                <ProductCard
                  hit={hit}
                  pincode={filters.pin === '' ? pincode : filters.pin}
                  compare={{
                    checked: compare.includes(hit.product_id),
                    onToggle: () => toggleCompare(hit),
                  }}
                />
              </li>
            ))}
          </ul>
          {cursor === null ? null : (
            <button type="button" className="btn" onClick={() => void loadMore()}>
              Load more
            </button>
          )}
        </div>
      </div>
      {wide ? null : (
        <Dialog name="Filters" open={filtersOpen} onClose={() => setFiltersOpen(false)}>
          {facetPanel}
          <button type="button" className="btn" onClick={() => setFiltersOpen(false)}>
            Done
          </button>
        </Dialog>
      )}
    </>
  );
}
