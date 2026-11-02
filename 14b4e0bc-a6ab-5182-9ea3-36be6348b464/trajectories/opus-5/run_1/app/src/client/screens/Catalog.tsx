import { type ReactNode, useEffect } from 'react';
import { COPY } from '../lib/copy.ts';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';
import { Overlay } from '../components/Dialog.tsx';
import { FacetGroups } from '../components/Facets.tsx';
import { HopList, LineageCanvas } from '../components/Canvas.tsx';
import { Detail } from '../components/Detail.tsx';
import { TagGlyph } from '../components/glyphs.tsx';

function SearchStatus(): ReactNode {
  const state = useAppState();
  return (
    <p role="status" aria-label="Search status" className="search-status">
      {state.searchStatus}
    </p>
  );
}

function Results(): ReactNode {
  const state = useAppState();
  const search = state.search;
  if (search === null) return null;
  return (
    <div className="results-area">
      <button type="button" data-focus-key="clear-filters" onClick={() => store.clearFilters()}>
        Clear filters
      </button>
      {search.results.length === 0 ? (
        <p className="empty">{COPY.emptySearch}</p>
      ) : (
        <ul role="list" aria-label="Search results" className="results">
          {search.results.map((result) => (
            <li key={result.id} className="result-row">
              <a
                href={`/catalog?asset=${encodeURIComponent(result.id)}`}
                onClick={(event) => {
                  event.preventDefault();
                  store.openAsset(result.id);
                }}
              >
                {result.id}
              </a>
              <span className="result-meta">
                <span>{result.kind}</span>
                <span>{result.state}</span>
                <span>{result.owner.name}</span>
              </span>
              <span className="result-counts">
                <TagGlyph tag="PII" />
                <span className="mono" data-tag-count="PII">
                  {result.pii_column_count}
                </span>
                <TagGlyph tag="Confidential" />
                <span className="mono" data-tag-count="Confidential">
                  {result.confidential_column_count}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchBox(): ReactNode {
  const state = useAppState();
  return (
    <input
      type="search"
      role="searchbox"
      aria-label="Search catalog"
      className="search-box"
      value={state.params.q}
      onChange={(event) => store.setQuery(event.target.value)}
    />
  );
}

function Rail(): ReactNode {
  const narrow = useAppState().width < 768;
  return (
    <div className="rail">
      <SearchBox />
      {narrow ? null : <SearchStatus />}
      {narrow ? null : <FacetGroups />}
      <Results />
    </div>
  );
}

function FiltersSheet(): ReactNode {
  const state = useAppState();
  const activeFilters = (['tag', 'owner', 'state', 'term'] as const).filter(
    (group) => state.params[group] !== null,
  ).length;
  return (
    <>
      <button
        type="button"
        aria-label="Filters"
        aria-expanded={state.filtersOpen}
        data-focus-key="filters-button"
        onClick={() => store.setFiltersOpen(!state.filtersOpen)}
      >
        Filters{' '}
        <span data-active-filters className="mono">
          {activeFilters}
        </span>
      </button>
      <Overlay
        name="Filters"
        open={state.filtersOpen}
        motion={state.motion}
        onClose={() => store.setFiltersOpen(false)}
        autoFocus={false}
        className="sheet"
      >
        <button
          type="button"
          data-focus-key="close-filters"
          onClick={() => store.setFiltersOpen(false)}
        >
          Close filters
        </button>
        {/* Exactly one Search status exists: the rail's copy is hidden while the sheet holds it. */}
        {state.filtersOpen ? <SearchStatus /> : null}
        <FacetGroups />
      </Overlay>
    </>
  );
}

function LineageRail(): ReactNode {
  const state = useAppState();
  return (
    <>
      <button
        type="button"
        aria-expanded={state.lineageOpen}
        data-focus-key="lineage-button"
        onClick={() => store.setLineageOpen(!state.lineageOpen)}
      >
        Lineage
      </button>
      <Overlay
        name="Lineage"
        role="complementary"
        open={state.lineageOpen}
        motion={state.motion}
        onClose={() => store.setLineageOpen(false)}
        autoFocus={false}
        className="lineage-rail"
        attributes={{
          'data-lineage-rail': 'true',
          'data-sweep': state.sweepState,
          'data-layout': state.layout,
        }}
      >
        <button
          type="button"
          data-focus-key="close-lineage"
          onClick={() => store.setLineageOpen(false)}
        >
          Close lineage
        </button>
        <HopList />
      </Overlay>
    </>
  );
}

function Activity(): ReactNode {
  const state = useAppState();
  return (
    <>
      <p role="status" aria-label="Activity" className="activity">
        {state.activity}
      </p>
      {state.undoBatch === null || !store.canWrite() ? null : (
        <button type="button" data-focus-key="undo-bulk" onClick={() => void store.undoBulkTag()}>
          Undo
        </button>
      )}
    </>
  );
}

export function Catalog(): ReactNode {
  const state = useAppState();
  const narrow = state.width < 768;

  useEffect(() => {
    document.body.classList.toggle('overlay-open', state.filtersOpen || state.lineageOpen || state.dialog !== null);
  }, [state.filtersOpen, state.lineageOpen, state.dialog]);

  if (narrow) {
    return (
      <div className="workspace narrow">
        <FiltersSheet />
        <SearchBox />
        {state.filtersOpen ? null : <SearchStatus />}
        {state.params.asset === null ? (
          <Results />
        ) : (
          <>
            <a
              href="/catalog"
              onClick={(event) => {
                event.preventDefault();
                store.closeAsset();
              }}
            >
              Back to results
            </a>
            <Detail />
          </>
        )}
        <LineageRail />
        <Activity />
      </div>
    );
  }

  return (
    <div className="workspace wide">
      <Activity />
      <div className="panes">
        <Rail />
        <LineageCanvas />
        <Detail />
      </div>
    </div>
  );
}
