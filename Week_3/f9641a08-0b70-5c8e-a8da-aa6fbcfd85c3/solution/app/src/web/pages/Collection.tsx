import { useEffect, useMemo, useRef, useState } from "react";
import type { CollectionSummary, FacetGroup, SearchResponse } from "../../shared/api";
import { plural } from "../../shared/format";
import { Band, BAND_TONES } from "../components/Band";
import { Dialog } from "../components/Dialog";
import { FilterPanel } from "../components/FilterPanel";
import { Loading, Panel, ServerError } from "../components/Panel";
import { ProductCard } from "../components/ProductCard";
import { useBreakpoint } from "../lib/breakpoint";
import { COLLECTION_SLUGS, SORTS, collectionUrl, parseState, searchPath, type CatalogueState } from "../lib/catalogue";
import { useLive, useLiveReset } from "../lib/live";
import { Link, navigate, useLocation } from "../lib/router";
import { rememberCompare } from "../lib/store";
import { useData } from "../lib/useData";
import "../styles/store.css";
import { NotFound } from "./NotFound";

export function Collection({ slug }: { slug: string }) {
  if (!COLLECTION_SLUGS.includes(slug)) return <NotFound />;
  return <CollectionPage slug={slug} />;
}

function CollectionPage({ slug }: { slug: string }) {
  const location = useLocation();
  const breakpoint = useBreakpoint();
  const state = useMemo(() => parseState(new URLSearchParams(location.split("?")[1] ?? "")), [location]);
  const [sheet, setSheet] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [options, setOptions] = useState<SearchResponse["options"] | null>(null);
  const results = useData<SearchResponse>(searchPath(slug, state, options));
  const collections = useData<CollectionSummary[]>("/api/collections");
  const [liveUnits, setLiveUnits] = useState<Record<string, number>>({});
  const data = results.data;

  useEffect(() => {
    if (data) setOptions(data.options);
  }, [data]);

  useEffect(() => rememberCompare(state.compare.join(",")), [state.compare]);
  useLive("collection", (event) => setLiveUnits((current) => ({ ...current, [event.slug]: event.units })));
  useLiveReset(() => {
    void results.reload();
    void collections.reload();
  });

  const go = (next: CatalogueState) => navigate(collectionUrl(slug, next));

  const toggle = (group: FacetGroup, value: string, on: boolean) => {
    const current = state.filters[group];
    go({ ...state, filters: { ...state.filters, [group]: on ? [...current, value] : current.filter((v) => v !== value) }, page: 1 });
  };

  const band = useMemo((): CollectionSummary | null => {
    const list = collections.data;
    if (!list) return null;
    const found = list.find((c) => c.slug === slug);
    const base =
      found ??
      (slug === "all"
        ? { slug: "all", name: "All bags", designs: list.reduce((n, c) => n + c.designs, 0), units: list.reduce((n, c) => n + c.units, 0) }
        : null);
    return base ? { ...base, units: liveUnits[slug] ?? base.units } : null;
  }, [collections.data, liveUnits, slug]);

  if (results.error && !data) return <ServerError />;

  const total = data?.total ?? 0;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const active = data
    ? (Object.keys(state.filters) as FacetGroup[]).flatMap((group) =>
        state.filters[group].flatMap((value) => {
          const option = data.options[group].find((o) => o.value === value);
          return option && (group !== "category" || slug === "all") ? [{ group, value, label: option.label }] : [];
        }),
      )
    : [];

  const count = (
    <p role="status" aria-label="Result count" aria-live="polite" className="result-count">
      {data ? `${total} ${plural(total, "product", "products")}` : ""}
    </p>
  );
  const activeFilters = (
    <div className="active">
      <ul aria-label="Active filters" className="chips">
        {active.map((filter) => (
          <li key={`${filter.group}-${filter.value}`}>
            <button type="button" className="btn chip-button" onClick={() => toggle(filter.group, filter.value, false)}>
              Remove filter {filter.label}
            </button>
          </li>
        ))}
      </ul>
      {active.length > 0 && (
        <button
          type="button"
          className="btn"
          onClick={() => go({ ...state, filters: { category: [], colour: [], size: [], material: [], price: [], fit: [] }, page: 1 })}
        >
          Clear all filters
        </button>
      )}
    </div>
  );
  const sort = (
    <div className="sort">
      <label htmlFor="sort-by">Sort by</label>
      <select id="sort-by" value={state.sort} onChange={(event) => go({ ...state, sort: event.target.value, page: 1 })}>
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
  const panel = (asRegion: boolean) =>
    data && <FilterPanel options={data.options} facets={data.facets} state={state} showCategory={slug === "all"} asRegion={asRegion} onToggle={toggle} />;
  const pageHref = (n: number) => collectionUrl(slug, { ...state, page: n });
  const compareLink = state.compare.length > 0 && (
    <Link className="btn btn-primary compare-link" href={`/compare?compare=${state.compare.join(",")}`}>
      Compare {state.compare.length} selected
    </Link>
  );

  return (
    <div className="page collection">
      {band && <Band collection={band} tone={BAND_TONES[slug] ?? "teal"} level={1} />}
      <div className="axis">
        <div className="zone">
          {breakpoint === "desktop" ? (
            panel(true)
          ) : (
            <>
              <button ref={filtersButton} type="button" className="btn" onClick={() => setSheet(true)}>
                Filters
              </button>
              {count}
              {activeFilters}
            </>
          )}
        </div>
        <div className="main">
          {breakpoint === "desktop" && (
            <div className="results-head">
              {count}
              {sort}
            </div>
          )}
          {breakpoint === "desktop" && activeFilters}
          {breakpoint !== "desktop" && <div className="results-head">{sort}</div>}
          {compareLink}
          {data?.mode === "fallback" && data.notice && (
            <p role="status" aria-label="Search notice" className="notice tone-yellow">
              {data.notice}
            </p>
          )}
          {!data && <Loading />}
          {data && data.results.length === 0 && <Panel tone="surface">Nothing matches. Remove a filter or try another word.</Panel>}
          {data && data.results.length > 0 && (
            <div className="grid-cards" aria-busy={results.loading}>
              {data.results.map((product) => (
                <ProductCard key={product.slug} product={product} />
              ))}
            </div>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="pagination">
              {state.page > 1 && <Link href={pageHref(state.page - 1)}>Previous page</Link>}
              {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                <Link key={n} href={pageHref(n)} aria-current={n === state.page ? "page" : undefined} aria-label={`Page ${n}`} className={n === state.page ? "is-current" : undefined}>
                  {n}
                </Link>
              ))}
              {state.page < pages && <Link href={pageHref(state.page + 1)}>Next page</Link>}
            </nav>
          )}
        </div>
      </div>
      {breakpoint !== "desktop" && (
        <Dialog title="Filters" kind="sheet" open={sheet} onClose={() => setSheet(false)} openerRef={filtersButton}>
          {panel(false)}
          <button type="button" className="btn btn-primary show-results" onClick={() => setSheet(false)}>
            Show results
          </button>
        </Dialog>
      )}
    </div>
  );
}
