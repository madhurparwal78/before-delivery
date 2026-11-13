import { useEffect, useRef, useState } from 'preact/hooks';
import { get } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { go } from '../lib/router.js';
import { useOverlay } from '../lib/overlay.js';
import { useWidth } from '../lib/viewport.js';
import type { RailPiece } from '../lib/types.js';
import { CATEGORIES, PRICE_BANDS, SIZES } from '../../shared/options.js';
import { SEARCH_PAUSE_MS } from '../../shared/shop.js';
import { Overlay } from '../components/Overlay.js';
import { PieceCard } from '../components/PieceCard.js';
import { PublicTopBar } from '../components/chrome.js';
import { Garment } from '../components/Garment.js';
import { Icon } from '../components/Icon.js';
import { BottomBar } from '../components/layout.js';

interface RailData {
  filtered: RailPiece[];
  brands: string[];
}

function paramsOf(search: string): URLSearchParams {
  return new URLSearchParams(search);
}

/** Each filter change writes the choice into the address as one new history entry. */
function withParam(search: string, key: string, value: string | null): string {
  const params = paramsOf(search);
  if (value === null || value === '') params.delete(key);
  else params.set(key, value);
  const query = params.toString();
  return query === '' ? '/' : `/?${query}`;
}

export function RailScreen({ search }: { search: string }) {
  const params = paramsOf(search);
  const category = params.get('category');
  const size = params.get('size');
  const brand = params.get('brand');
  const price = params.get('price');
  const query = params.get('q') ?? '';

  const width = useWidth();
  const filters = useOverlay();
  const [typed, setTyped] = useState(query);
  const lastPushed = useRef(query);

  // The search box always shows the latest input; Back and Forward reset it.
  useEffect(() => {
    if (query !== lastPushed.current) {
      lastPushed.current = query;
      setTyped(query);
    }
  }, [query]);

  // Typing waits until typing pauses for 300 milliseconds, then runs one search.
  useEffect(() => {
    if (typed === query) return;
    const timer = setTimeout(() => {
      lastPushed.current = typed;
      go(withParam(window.location.search, 'q', typed));
    }, SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [typed, query]);

  const rail = usePolling<RailData>(async () => {
    const [filtered, all] = await Promise.all([
      get<{ pieces: RailPiece[] }>(`/api/rail${search === '' ? '' : search}`),
      get<{ pieces: RailPiece[] }>('/api/rail'),
    ]);
    return {
      filtered: filtered.pieces,
      brands: [...new Set(all.pieces.map((piece) => piece.brand))].sort((left, right) =>
        left.localeCompare(right),
      ),
    };
  }, search, { keepWhileLoading: true });

  const pieces = rail.data?.filtered ?? [];
  const brands = rail.data?.brands ?? [];

  const setFilter = (key: string, value: string | null): void => {
    go(withParam(window.location.search, key, value));
  };

  const filterControls = (idPrefix: string) => (
    <>
      <p class="field">
        <label class="field__label" for={`${idPrefix}-q`}>
          <Icon name="search" />
          Search the rail
        </label>
        <input
          id={`${idPrefix}-q`}
          class="field__input"
          type="search"
          role="searchbox"
          value={typed}
          onInput={(event) => setTyped((event.currentTarget as HTMLInputElement).value)}
        />
      </p>

      <fieldset class="radiogroup" role="radiogroup" aria-label="Category">
        <legend class="radiogroup__legend">Category</legend>
        <label class="radio">
          <input
            type="radio"
            name={`${idPrefix}-category`}
            checked={category === null}
            onChange={() => setFilter('category', null)}
          />
          <span class="radio__label">All</span>
        </label>
        {CATEGORIES.map((option) => (
          <label key={option.value} class="radio radio--swatch">
            <input
              type="radio"
              name={`${idPrefix}-category`}
              checked={category === option.value}
              onChange={() => setFilter('category', option.value)}
            />
            <span class="radio__label">
              <Garment category={option.value} seed={option.value} tile />
              {option.label}
            </span>
          </label>
        ))}
      </fieldset>

      <div class="size-pills" role="group" aria-label="Size">
        {SIZES.map((option) => (
          <button
            key={option.value}
            type="button"
            class="pill"
            aria-pressed={size === option.value}
            onClick={() => setFilter('size', size === option.value ? null : option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p class="field">
        <label class="field__label" for={`${idPrefix}-brand`}>
          Brand
        </label>
        <select
          id={`${idPrefix}-brand`}
          class="field__input"
          value={brand ?? ''}
          onChange={(event) =>
            setFilter('brand', (event.currentTarget as HTMLSelectElement).value || null)
          }
        >
          <option value="">All brands</option>
          {brands.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </p>

      <fieldset class="radiogroup" role="radiogroup" aria-label="Price">
        <legend class="radiogroup__legend">Price</legend>
        <label class="radio">
          <input
            type="radio"
            name={`${idPrefix}-price`}
            checked={price === null}
            onChange={() => setFilter('price', null)}
          />
          <span class="radio__label">Any price</span>
        </label>
        {PRICE_BANDS.map((option) => (
          <label key={option.value} class="radio">
            <input
              type="radio"
              name={`${idPrefix}-price`}
              checked={price === option.value}
              onChange={() => setFilter('price', option.value)}
            />
            <span class="radio__label">{option.label}</span>
          </label>
        ))}
      </fieldset>
    </>
  );

  return (
    <div class="screen screen--rail">
      <PublicTopBar />
      <main class="rail">
        <h1 class="heading heading--1">The rail</h1>
        {width === 'wide' ? (
          <div class="rail__filters">{filterControls('rail')}</div>
        ) : (
          <BottomBar>
            <button
              type="button"
              class="button button--primary"
              ref={filters.openerRef}
              aria-expanded={filters.isOpen}
              onClick={() => (filters.isOpen ? filters.close() : filters.open())}
            >
              <Icon name="filters" />
              Filters
            </button>
          </BottomBar>
        )}

        <div class="rail__grid">
          {pieces.length === 0 ? (
            <p class="rail__empty">Nothing on the rail matches those choices yet.</p>
          ) : (
            <ul class="rail__list" role="list" aria-label="Pieces">
              {pieces.map((piece) => (
                <li key={piece.id}>
                  <PieceCard piece={piece} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {filters.mounted ? (
          <Overlay
            state={filters}
            name="Filters"
            kind={width === 'narrow' ? 'sheet-bottom' : 'sheet-side'}
          >
            <div class="sheet__body">{filterControls('sheet')}</div>
            <div class="sheet__footer">
              <button type="button" class="button button--quiet" onClick={() => filters.close()}>
                Close filters
              </button>
              <button type="button" class="button button--primary" onClick={() => filters.close()}>
                {`Show ${pieces.length} pieces`}
              </button>
            </div>
          </Overlay>
        ) : null}
      </main>
    </div>
  );
}
