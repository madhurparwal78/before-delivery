import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Empty } from "../components/Empty";
import { Facets } from "../components/Facets";
import { ProductCard, type Field } from "../components/ProductCard";
import { useCustomCursor } from "../effects/cursor";
import { useLayout, useTitle } from "../lib/hooks";
import { usePincode } from "../lib/pincode";
import type { Hit } from "../lib/types";
import { readSearch, SORT_OPTIONS, writeSearch, type SearchState, type SortKey } from "./catalogue/query";
import { useSearchResults } from "./catalogue/useSearchResults";
import "../styles/catalogue.css";

const MAX_COMPARE = 4;
const DEGRADED = "Search is running in basic mode. Typo matching and filters are off for now.";
const FIELDS: Field[] = ["raised", "black", "pink"];

/** Spans of the 24-column grid: every row sums to 24, the splits differ from row to row and no panel drops below 7 columns. */
const SPANS = {
  phone: [[24]],
  tablet: [[12, 12], [14, 10], [10, 14], [12, 12]],
  desktop: [[8, 8, 8], [10, 7, 7], [7, 10, 7], [8, 8, 8], [7, 7, 10]],
} as const;
const PER_ROW = { phone: 1, tablet: 2, desktop: 3 } as const;

function placement(layout: keyof typeof SPANS, index: number, total: number): { row: number; span: number } {
  const perRow = PER_ROW[layout];
  const row = Math.floor(index / perRow);
  const seats = Math.min(perRow, total - row * perRow);
  if (seats === perRow) {
    const pattern = SPANS[layout][row % SPANS[layout].length] as readonly number[];
    return { row, span: pattern[index % perRow] as number };
  }
  return { row, span: seats === 1 && perRow === 3 ? 12 : 24 / seats };
}

export default function Search(): ReactNode {
  const [params] = useSearchParams();
  const state = useMemo(() => readSearch(params), [params]);
  const navigate = useNavigate();
  const layout = useLayout();
  const phone = layout === "phone";
  const { pin: shopperPin } = usePincode();
  const view = useSearchResults(state);
  const [sheet, setSheet] = useState(false);
  const [picked, setPicked] = useState<Hit[]>([]);
  const [note, setNote] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const latest = useRef(state);
  latest.current = state;
  const lastPin = useRef(shopperPin);

  useCustomCursor();
  useTitle(state.q ? `results for ${state.q}` : "all products");

  const go = (next: SearchState): void => navigate(`/search${writeSearch(next)}`);

  useEffect(() => {
    if (lastPin.current === shopperPin) return;
    lastPin.current = shopperPin;
    if (shopperPin && latest.current.pin !== shopperPin) navigate(`/search${writeSearch({ ...latest.current, pin: shopperPin })}`);
  }, [shopperPin, navigate]);

  useEffect(() => {
    if (!phone) setSheet(false);
  }, [phone]);

  const { appendedFrom, clearAppended } = view;
  useEffect(() => {
    if (appendedFrom === null) return;
    list.current?.querySelectorAll<HTMLElement>("article h2 a")[appendedFrom]?.focus();
    clearAppended();
  }, [appendedFrom, clearAppended]);

  const compare = (hit: Hit): void => {
    if (picked.some((item) => item.product_id === hit.product_id)) {
      setPicked(picked.filter((item) => item.product_id !== hit.product_id));
      setNote("");
    } else if (picked.length >= MAX_COMPARE) setNote("Compare up to 4 products.");
    else if (picked.length > 0 && (picked[0] as Hit).category !== hit.category) setNote("Compare products from one category.");
    else {
      setPicked([...picked, hit]);
      setNote("");
    }
  };

  const results = view.results;
  // Once any answer has come the facets stay drawn through the next ones, so a filter change never blanks the rail.
  const answered = useRef(false);
  if (results !== null || view.error !== null) answered.current = true;
  const hits = results?.hits ?? [];
  const count = results ? (results.total === 1 ? "1 result" : `${results.total} results`) : "";
  const facets = (
    <Facets state={state} facets={view.facets} pin={state.pin || shopperPin || ""} disabled={results?.degraded ?? false} ready={answered.current} onChange={go} />
  );
  const compareTo = `/compare?ids=${picked.map((item) => item.product_id).join(",")}&diff=0`;

  return (
    <div className="catalogue">
      {results?.degraded && (
        <section className="catalogue__banner panel--black">
          <p>{DEGRADED}</p>
        </section>
      )}
      <div className="catalogue__layout">
        {!phone && (
          <aside className="catalogue__rail panel--yellow" aria-label="Filters">
            <p className="catalogue__rail-title">filters</p>
            {facets}
          </aside>
        )}
        <section className="catalogue__results panel panel--ground">
          <h1>{state.q ? `results for ${state.q}` : "all products"}</h1>
          <div className="catalogue__tools">
            <p className="status catalogue__status" role="status" aria-label="Search results">
              {note || count}
            </p>
            {phone && (
              <Button onClick={() => setSheet(true)}>
                <SlidersHorizontal size={20} aria-hidden="true" />
                Filters
              </Button>
            )}
            <div className="field catalogue__sort">
              <label htmlFor="sort-by">Sort by</label>
              <select id="sort-by" value={state.sort} onChange={(event) => go({ ...state, sort: event.target.value as SortKey })}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="catalogue__compare">
              {picked.length >= 2 ? (
                <Link className="btn btn--dark" to={compareTo}>{`Compare (${picked.length})`}</Link>
              ) : (
                <a className="btn" role="link" aria-disabled="true" tabIndex={-1}>{`Compare (${picked.length})`}</a>
              )}
              {picked.length < 2 && <p className="muted">tick 2 to compare</p>}
            </div>
          </div>
          {view.error !== null && (
            <div role="alert">
              <Empty tone="black" sign="lost">
                {view.error}
              </Empty>
            </div>
          )}
          {view.loading && results === null && view.error === null && (
            <div className="catalogue__grid catalogue__grid--loading" aria-busy="true">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton" />
              ))}
            </div>
          )}
          {results !== null && hits.length === 0 && (
            <Empty tone="pink" sign="search">
              no match. loosen a filter.
            </Empty>
          )}
          {hits.length > 0 && (
            <ul className="catalogue__grid" role="list" aria-label="Products" ref={list}>
              {hits.map((hit, index) => {
                const { row, span } = placement(layout, index, hits.length);
                return <ProductCard key={hit.listing_id} hit={hit} field={FIELDS[row % FIELDS.length] as Field} span={span} pin={state.pin} compared={picked.some((item) => item.product_id === hit.product_id)} onCompare={compare} />;
              })}
            </ul>
          )}
          {results?.nextCursor && (
            <div className="catalogue__more">
              <Button variant="primary" busy={view.loadingMore} onClick={() => void view.loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </section>
      </div>
      {phone && sheet && (
        <Dialog title="Filters" sheet onClose={() => setSheet(false)}>
          {facets}
          <div className="dialog__actions">
            <Button variant="primary" onClick={() => setSheet(false)}>
              Show results
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
