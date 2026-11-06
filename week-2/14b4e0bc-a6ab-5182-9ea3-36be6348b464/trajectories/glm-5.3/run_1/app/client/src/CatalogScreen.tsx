import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AssetDetail, ColumnReadResponse, FacetEntry, SearchResponse } from '../../shared/api';
import type { Tag } from '../../shared/domain';
import { canWrite } from '../../shared/permissions';
import { apiGet } from './api';
import { useAuth, useActivityStream } from './App';
import { Notes, TopBar, useStatus } from './TopBar';
import { COPY, useReducedMotion, useViewport } from './hooks';
import { TagGlyphs } from './ui';
import { formatViewerZone } from './time';
import { LineageView } from './LineageView';
import { AssetPane } from './AssetPane';

export interface SearchState {
  q: string;
  tag: string;
  owner: string;
  state: string;
  term: string;
}

function searchFromParams(params: URLSearchParams): SearchState {
  return {
    q: params.get('q') ?? '',
    tag: params.get('tag') ?? '',
    owner: params.get('owner') ?? '',
    state: params.get('state') ?? '',
    term: params.get('term') ?? '',
  };
}

function paramsFromSearch(state: SearchState, asset: string | null, column: string | null, asOf: string | null): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.tag) params.set('tag', state.tag);
  if (state.owner) params.set('owner', state.owner);
  if (state.state) params.set('state', state.state);
  if (state.term) params.set('term', state.term);
  if (asset) params.set('asset', asset);
  if (column) params.set('column', column);
  if (asOf) params.set('as_of', asOf);
  return params;
}

export function CatalogScreen(): ReactNode {
  const { user, refresh } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const viewport = useViewport();
  const reducedMotion = useReducedMotion();

  const asOf = params.get('as_of');
  const isAdmin = user?.role === 'Admin';
  const effectiveAsOf = isAdmin ? asOf : null;
  const search = searchFromParams(params);
  const assetId = params.get('asset');
  const columnId = params.get('column');

  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [searchStatus, setSearchStatus] = useState('');
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [column, setColumn] = useState<ColumnReadResponse | null>(null);
  const [activity, setActivity] = useState<{ text: string; seq: number } | null>(null);
  const [syncedSeq, setSyncedSeq] = useState<number | null>(null);
  const [newerChanges, setNewerChanges] = useState(0);
  const [asOfAt, setAsOfAt] = useState<string | null>(null);

  const searchSeqRef = useRef(0);
  const assetSeqRef = useRef(0);
  const columnSeqRef = useRef(0);
  const announcedCountRef = useRef<number | null>(null);
  const activitySeqRef = useRef(0);
  const searchTriggeredRef = useRef(false);
  const stateKeyRef = useRef('');

  const status = useStatus(!!user);
  const { events } = useActivityStream(!!user, effectiveAsOf !== null ? Number(effectiveAsOf) : null);

  const stateKey = JSON.stringify(search) + '|' + (assetId ?? '') + '|' + (columnId ?? '') + '|' + (effectiveAsOf ?? '');

  const announce = useCallback((text: string): void => {
    activitySeqRef.current += 1;
    setActivity({ text, seq: activitySeqRef.current });
  }, []);

  const searchUrl = useCallback(
    (triggered: boolean): string => {
      const p = new URLSearchParams();
      if (search.q) p.set('q', search.q);
      if (search.tag) p.set('tag', search.tag);
      if (search.owner) p.set('owner', search.owner);
      if (search.state) p.set('state', search.state);
      if (search.term) p.set('term', search.term);
      if (effectiveAsOf) p.set('as_of_seq', effectiveAsOf);
      return `/api/search?${p.toString()}`;
    },
    [search, effectiveAsOf]
  );

  const runSearch = useCallback(
    async (triggered: boolean): Promise<void> => {
      const seq = ++searchSeqRef.current;
      const url = searchUrl(triggered);
      if (triggered) {
        setSearchStatus(COPY.searching);
        searchTriggeredRef.current = true;
      }
      const res = await apiGet<SearchResponse>(url);
      if (searchSeqRef.current !== seq) return;
      if (res.status === 200) {
        setSearchResult(res.body);
        const announced = announcedCountRef.current;
        if (triggered || announced !== res.body.total) {
          setSearchStatus(COPY.matchingAssets(res.body.total));
          announcedCountRef.current = res.body.total;
        }
      } else if (triggered) {
        if (res.status === 422) {
          const fields = (res.body as { error?: { fields?: Record<string, string> } }).error?.fields;
          const first = fields ? Object.values(fields)[0] : undefined;
          setSearchStatus(first ?? COPY.searchUnavailable);
        } else {
          setSearchStatus(COPY.searchUnavailable);
        }
      }
    },
    [searchUrl]
  );

  const loadAsset = useCallback(async (): Promise<void> => {
    if (!assetId) {
      setAsset(null);
      return;
    }
    const seq = ++assetSeqRef.current;
    const suffix = effectiveAsOf ? `?as_of_seq=${effectiveAsOf}` : '';
    const res = await apiGet<AssetDetail & { asset?: AssetDetail; as_of_at?: string | null }>(
      `/api/assets/${encodeURIComponent(assetId)}${suffix}`
    );
    if (assetSeqRef.current !== seq) return;
    if (res.status === 200) {
      setAsset(res.body.asset ?? res.body);
      if (res.body.as_of_at !== undefined) setAsOfAt(res.body.as_of_at ?? null);
    } else {
      setAsset(null);
    }
  }, [assetId, effectiveAsOf]);

  const loadColumn = useCallback(async (): Promise<void> => {
    if (!columnId) {
      setColumn(null);
      return;
    }
    const seq = ++columnSeqRef.current;
    const suffix = effectiveAsOf ? `?as_of_seq=${effectiveAsOf}` : '';
    const res = await apiGet<ColumnReadResponse>(`/api/columns/${encodeURIComponent(columnId)}${suffix}`);
    if (columnSeqRef.current !== seq) return;
    if (res.status === 200) {
      setColumn(res.body);
    } else {
      setColumn(null);
    }
  }, [columnId, effectiveAsOf]);

  // The latest-input rule: only the newest search state, asset and column render.
  useEffect(() => {
    stateKeyRef.current = stateKey;
    void runSearch(true);
    void loadAsset();
    void loadColumn();
  }, [stateKey, runSearch, loadAsset, loadColumn]);

  const go = useCallback(
    (next: { search?: Partial<SearchState>; asset?: string | null; column?: string | null; replace?: boolean; keepColumn?: boolean }) => {
      const merged: SearchState = { ...search, ...(next.search ?? {}) };
      const nextAsset = 'asset' in next ? (next.asset as string | null) : assetId;
      const nextColumn = 'column' in next ? (next.column as string | null) : nextAsset === assetId ? columnId : null;
      const p = paramsFromSearch(merged, nextAsset, nextColumn, asOf);
      const qs = p.toString();
      navigate({ pathname: '/catalog', search: qs ? `?${qs}` : '' }, { replace: next.replace === true });
    },
    [search, assetId, columnId, asOf, navigate]
  );

  // The live refresh (DP-85) and the point-in-time newer-changes line.
  useEffect(() => {
    if (events.length === 0) return;
    let cancelled = false;
    const apply = async (): Promise<void> => {
      for (const event of events) {
        if (effectiveAsOf !== null) {
          if (event.seq > Number(effectiveAsOf)) {
            setNewerChanges((n) => n + 1);
            announce(`${newerChanges + 1} newer changes since seq ${effectiveAsOf}.`);
          }
          continue;
        }
        if (event.action.startsWith('user.')) continue;
        if (event.action === 'evidence.download') continue;
        await runSearch(false);
        await loadAsset();
        await loadColumn();
        if (!cancelled) setSyncedSeq(event.seq);
      }
    };
    void apply();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // A role change of this person re-reads the session so the next write uses it (DP-08, DP-95).
  useEffect(() => {
    const own = events.find((e) => e.action === 'user.role_change');
    if (!own || !user) return;
    void (async () => {
      const fresh = await refresh();
      if (!fresh) {
        navigate('/signin', { replace: true });
        return;
      }
      announce(COPY.roleChanged(fresh.role));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  if (!user) return null;

  const pointInTimeNote =
    effectiveAsOf !== null ? (
      <div role="note" aria-label="Point in time" className="point-in-time-note">
        <div>
          Catalog as of audit seq <span className="mono">{effectiveAsOf}</span>. Later changes are not shown.
        </div>
        <div data-recorded-at="">
          {asOfAt ? `Seq ${effectiveAsOf} was recorded at ${formatViewerZone(asOfAt)}.` : `Seq ${effectiveAsOf} was recorded.`}
        </div>
        {newerChanges > 0 && (
          <div data-newer-changes="">
            {newerChanges} newer changes since seq {effectiveAsOf}.
          </div>
        )}
        <button
          type="button"
          className="btn link-btn"
          onClick={() => {
            const p = new URLSearchParams(params);
            p.delete('as_of');
            navigate({ pathname: '/catalog', search: p.toString() ? `?${p.toString()}` : '' });
          }}
        >
          Back to the live catalog
        </button>
      </div>
    ) : null;

  return (
    <div className={`screen ${viewport.narrow ? 'narrow' : ''}`}>
      <TopBar user={user} />
      <Notes status={status} pointInTime={pointInTimeNote} />
      <main
        data-synced-seq={effectiveAsOf !== null ? effectiveAsOf : syncedSeq ?? undefined}
        data-motion={reducedMotion ? 'reduced' : 'full'}
      >
        <p role="status" aria-label="Activity" aria-live="polite" className="status activity-status">
          {activity?.text ?? ''}
        </p>
        <Workspace
          user={user}
          viewport={viewport}
          search={search}
          searchResult={searchResult}
          searchStatus={searchStatus}
          onSearch={(q) => go({ search: { q } })}
          onSelectFacet={(group, value) => go({ search: { [group]: value } as Partial<SearchState> })}
          onClearFilters={() => go({ search: { q: '', tag: '', owner: '', state: '', term: '' } })}
          onOpenAsset={(id) => go({ asset: id, column: null })}
          asset={asset}
          column={column}
          onOpenColumn={(id) => go({ column: id })}
          onActivity={announce}
          asOf={effectiveAsOf}
        />
      </main>
    </div>
  );
}

interface WorkspaceProps {
  user: import('../../shared/api').SessionUser;
  viewport: ReturnType<typeof useViewport>;
  search: SearchState;
  searchResult: SearchResponse | null;
  searchStatus: string;
  onSearch: (q: string) => void;
  onSelectFacet: (group: 'tag' | 'owner' | 'state' | 'term', value: string) => void;
  onClearFilters: () => void;
  onOpenAsset: (id: string) => void;
  asset: AssetDetail | null;
  column: ColumnReadResponse | null;
  onOpenColumn: (id: string) => void;
  onActivity: (text: string) => void;
  asOf: string | null;
}

function NarrowLayout(props: WorkspaceProps & {
  facetGroups: Array<{ key: 'tag' | 'owner' | 'state' | 'term'; label: string; entries: FacetEntry[]; selected: string }>;
  activeFilterCount: number;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean) => void;
  lineageOpen: boolean;
  setLineageOpen: (open: boolean) => void;
  writable: boolean;
}): ReactNode {
  const { search, searchResult, searchStatus, onSearch, onSelectFacet, onClearFilters, onOpenAsset, asset, column, onOpenColumn, onActivity, asOf, user } = props;
  const { facetGroups, activeFilterCount, filtersOpen, setFiltersOpen, lineageOpen, setLineageOpen } = props;
  const filtersBtnRef = useRef<HTMLButtonElement>(null);
  const live = asOf === null;

  return (
    <>
      <button
        ref={filtersBtnRef}
        type="button"
        className="btn sheet-btn"
        aria-expanded={filtersOpen}
        onClick={() => setFiltersOpen(!filtersOpen)}
      >
        Filters <span data-active-filters="">{activeFilterCount}</span>
      </button>
      {filtersOpen ? (
        <div
          role="dialog"
          aria-label="Filters"
          className="sheet"
          data-transition="open"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setFiltersOpen(false);
              filtersBtnRef.current?.focus();
            }
          }}
        >
          <button type="button" className="btn" onClick={() => {
            setFiltersOpen(false);
            filtersBtnRef.current?.focus();
          }}>
            Close filters
          </button>
          <SearchControls
            search={search}
            searchStatus={searchStatus}
            onSearch={onSearch}
            facetGroups={facetGroups}
            onSelectFacet={onSelectFacet}
            insideSheet
          />
        </div>
      ) : (
        <SearchControls search={search} searchStatus={searchStatus} onSearch={onSearch} facetGroups={[]} onSelectFacet={onSelectFacet} />
      )}
      {asset ? (
        <>
          <button type="button" className="link-btn" onClick={() => onOpenAsset(asset.id)}>
            Back to results
          </button>
          <AssetPane
            asset={asset}
            column={column}
            role={user.role}
            live={live}
            onOpenColumn={onOpenColumn}
            onAction={onActivity}
            onConfirmed={async () => undefined}
            onRefused={async () => undefined}
            headingRef={{ current: null }}
            onOpenAsset={onOpenAsset}
          />
        </>
      ) : (
        <ResultsArea search={search} searchResult={searchResult} onClearFilters={onClearFilters} onOpenAsset={onOpenAsset} />
      )}
      <button type="button" className="btn sheet-btn" aria-expanded={lineageOpen} onClick={() => setLineageOpen(true)}>
        Lineage
      </button>
      {lineageOpen && (
        <LineageView
          user={user}
          columnId={column?.id ?? null}
          onOpenColumn={onOpenColumn}
          onActivity={onActivity}
          asOf={asOf}
          narrow
          railOpen={lineageOpen}
          setRailOpen={setLineageOpen}
          refreshSignal={0}
          roleSignal={0}
        />
      )}
    </>
  );
}

function Workspace(props: WorkspaceProps): ReactNode {
  const { user, viewport, search, searchResult, searchStatus, onSearch, onSelectFacet, onClearFilters, onOpenAsset, asset, column, onOpenColumn, onActivity, asOf } = props;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lineageOpen, setLineageOpen] = useState(false);
  const live = asOf === null;
  const writable = live && canWrite(user.role);
  void writable;

  const facetGroups: Array<{ key: 'tag' | 'owner' | 'state' | 'term'; label: string; entries: FacetEntry[]; selected: string }> = useMemo(() => {
    const facets = searchResult?.facets;
    return [
      { key: 'tag', label: 'Tag', entries: facets?.tag ?? [], selected: search.tag },
      { key: 'owner', label: 'Owner', entries: facets?.owner ?? [], selected: search.owner },
      { key: 'state', label: 'State', entries: facets?.state ?? [], selected: search.state },
      { key: 'term', label: 'Term', entries: facets?.term ?? [], selected: search.term },
    ];
  }, [searchResult, search]);

  const activeFilterCount = [search.tag, search.owner, search.state, search.term].filter((v) => v !== '').length;

  return (
    <div className="workspace">
      {viewport.narrow ? (
        <NarrowLayout
          {...props}
          facetGroups={facetGroups}
          activeFilterCount={activeFilterCount}
          filtersOpen={filtersOpen}
          setFiltersOpen={setFiltersOpen}
          lineageOpen={lineageOpen}
          setLineageOpen={setLineageOpen}
          writable={writable}
        />
      ) : (
        <div className="panes">
          <aside className="rail" aria-label="Search and filters">
            <SearchControls
              search={search}
              searchStatus={searchStatus}
              onSearch={onSearch}
              facetGroups={facetGroups}
              onSelectFacet={onSelectFacet}
            />
            <ResultsArea
              search={search}
              searchResult={searchResult}
              onClearFilters={onClearFilters}
              onOpenAsset={onOpenAsset}
            />
          </aside>
          <div className={viewport.medium ? 'canvas-and-detail stacked' : 'canvas-and-detail'}>
            <LineageView
              user={user}
              columnId={column?.id ?? null}
              onOpenColumn={onOpenColumn}
              onActivity={onActivity}
              asOf={asOf}
              narrow={false}
              railOpen={false}
              setRailOpen={() => undefined}
              refreshSignal={0}
              roleSignal={0}
            />
            <AssetPane
              asset={asset}
              column={column}
              role={user.role}
              live={live}
              onOpenColumn={onOpenColumn}
              onAction={onActivity}
              onConfirmed={async () => undefined}
              onRefused={async () => undefined}
              headingRef={{ current: null }}
              onOpenAsset={onOpenAsset}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SearchControls({
  search,
  searchStatus,
  onSearch,
  facetGroups,
  onSelectFacet,
  insideSheet,
}: {
  search: SearchState;
  searchStatus: string;
  onSearch: (q: string) => void;
  facetGroups: Array<{ key: 'tag' | 'owner' | 'state' | 'term'; label: string; entries: FacetEntry[]; selected: string }>;
  onSelectFacet: (group: 'tag' | 'owner' | 'state' | 'term', value: string) => void;
  insideSheet?: boolean;
}): ReactNode {
  const [draft, setDraft] = useState(search.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(search.q);
  }, [search.q]);

  const onInput = (value: string): void => {
    setDraft(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(value), 300);
  };

  return (
    <div className="search-controls">
      <input
        type="search"
        className="input searchbox"
        placeholder="Search catalog"
        aria-label="Search catalog"
        value={draft}
        onChange={(e) => onInput(e.target.value)}
      />
      <p role="status" aria-label="Search status" aria-live="polite" className="status search-status">
        {searchStatus}
      </p>
      {!insideSheet &&
        facetGroups.map((group) => (
          <FacetGroup key={group.key} group={group} onSelectFacet={onSelectFacet} />
        ))}
    </div>
  );
}

function FacetGroup({
  group,
  onSelectFacet,
}: {
  group: { key: 'tag' | 'owner' | 'state' | 'term'; label: string; entries: FacetEntry[]; selected: string };
  onSelectFacet: (group: 'tag' | 'owner' | 'state' | 'term', value: string) => void;
}): ReactNode {
  const ref = useRef<HTMLFieldSetElement>(null);
  const onRadioKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>): void => {
    const radios = Array.from(ref.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? []);
    const idx = radios.findIndex((r) => r === ev.currentTarget);
    let next = -1;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') next = (idx + 1) % radios.length;
    else if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') next = (idx - 1 + radios.length) % radios.length;
    if (next >= 0) {
      ev.preventDefault();
      const target = radios[next]!;
      target.focus();
      target.click();
    }
  };
  return (
    <fieldset ref={ref} className="facet-group">
      <legend className="facet-legend">{group.label}</legend>
      <div role="radiogroup" aria-label={group.label}>
        <label className="facet-option">
          <input
            type="radio"
            name={`facet-${group.key}`}
            data-value=""
            checked={group.selected === ''}
            onChange={() => onSelectFacet(group.key, '')}
            onKeyDown={onRadioKeyDown}
          />
          <span>Any</span>
        </label>
        {group.entries.map((entry) => (
          <label key={entry.value} className="facet-option">
            <input
              type="radio"
              name={`facet-${group.key}`}
              data-value={entry.value}
              aria-label={entry.label}
              checked={group.selected === entry.value}
              onChange={() => onSelectFacet(group.key, entry.value)}
              onKeyDown={onRadioKeyDown}
            />
            <span>{entry.label}</span>
            <span data-facet-count="" className="mono facet-count">
              {entry.count}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ResultsArea({
  search,
  searchResult,
  onClearFilters,
  onOpenAsset,
}: {
  search: SearchState;
  searchResult: SearchResponse | null;
  onClearFilters: () => void;
  onOpenAsset: (id: string) => void;
}): ReactNode {
  const hasFilters = search.q !== '' || search.tag !== '' || search.owner !== '' || search.state !== '' || search.term !== '';
  return (
    <div className="results-area">
      <button type="button" className="btn" onClick={onClearFilters}>
        Clear filters
      </button>
      {searchResult && searchResult.results.length > 0 ? (
        <ul className="results-list" aria-label="Search results">
          {searchResult.results.map((r) => (
            <li key={r.id} className="result-row">
              <button type="button" className="result-link" onClick={() => onOpenAsset(r.id)}>
                <span className="result-id">{r.id}</span>
                <span className="result-kind">{r.kind}</span>
                <span className="result-state">{r.state}</span>
                <span className="result-owner">{r.owner.name}</span>
                <span className="result-counts">
                  <TagGlyphsAndCount tag="PII" count={r.pii_column_count} />
                  <TagGlyphsAndCount tag="Confidential" count={r.confidential_column_count} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : searchResult ? (
        <p className="empty-state">{COPY.emptySearch}</p>
      ) : null}
      {!searchResult && hasFilters ? null : null}
    </div>
  );
}

function TagGlyphsAndCount({ tag, count }: { tag: Tag; count: number }): ReactNode {
  return (
    <span className="glyph-count">
      <TagGlyphs tags={[tag]} />
      <span data-tag-count={tag} className="mono">
        {count}
      </span>
    </span>
  );
}
