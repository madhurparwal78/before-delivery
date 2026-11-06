import type { Ref } from "preact";
import { Glyph, IdText } from "../ui.tsx";
import { FACETS, type FacetGroup, type SearchBody, type UrlState } from "./types.ts";

interface FacetProps {
  search: SearchBody | null;
  url: UrlState;
  where: "rail" | "sheet";
  onChoose(group: FacetGroup, value: string): void;
}

/** Each facet group is one radio group and one Tab stop, keyed by value (DP-21). */
export function Facets({ search, url, where, onChoose }: FacetProps) {
  return (
    <div class="facets">
      {FACETS.map(({ group, label }) => {
        const entries = search?.facets[group] ?? [];
        const selected = url[group];
        const options = [{ value: "", label: "Any", count: null as number | null }, ...entries.map((e) => ({ value: e.value, label: e.label, count: e.count as number | null }))];
        return (
          <fieldset key={group} class="facet">
            <legend class="facet-legend">{label}</legend>
            <div role="radiogroup" aria-label={label} class="facet-options">
              {options.map((o) => (
                <div key={o.value} class={`facet-option${selected === o.value ? " checked" : ""}`}>
                  <input
                    type="radio"
                    name={`facet-${group}-${where}`}
                    aria-label={o.label}
                    data-value={o.value}
                    data-focus-key={`facet-${where}-${group}-${o.value}`}
                    checked={selected === o.value}
                    onChange={() => onChoose(group, o.value)}
                  />
                  <span class="radio-mark" aria-hidden="true" />
                  <span class="facet-label" aria-hidden="true">
                    {group === "tag" && o.value ? <Glyph tag={o.value as "PII" | "Confidential"} /> : null}
                    {o.label}
                  </span>
                  {o.count !== null && <span class="facet-count mono" data-facet-count="">{String(o.count)}</span>}
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

interface ResultsProps {
  search: SearchBody | null;
  onClear(): void;
  onOpen(assetId: string): void;
  current: string;
}

export function Results({ search, onClear, onOpen, current }: ResultsProps) {
  return (
    <div class="results-area">
      <button type="button" class="btn btn-quiet clear" onClick={onClear}>Clear filters</button>
      {search && search.total === 0 ? (
        <p class="empty-state">No assets match these filters. Clear a filter or search a broader term.</p>
      ) : (
        <ul aria-label="Search results" class="results">
          {(search?.results ?? []).map((r) => (
            <li key={r.id} class={`result${r.id === current ? " current" : ""}`}>
              <a href={`/catalog?asset=${encodeURIComponent(r.id)}`} class="result-link mono id-wrap" aria-label={r.id} data-focus-key={`result-${r.id}`}
                aria-current={r.id === current ? "true" : undefined}
                onClick={(e) => (e.preventDefault(), onOpen(r.id))}>
                <IdText id={r.id} />
              </a>
              <span class="result-meta">
                <span>{r.kind}</span>
                <span class={`state state-${r.state}`}>{r.state}</span>
              </span>
              <span class="result-owner wrap">{r.owner.name}</span>
              <span class="result-counts mono">
                <Glyph tag="PII" /><span data-tag-count="PII">{String(r.pii_column_count)}</span>
                <Glyph tag="Confidential" /><span data-tag-count="Confidential">{String(r.confidential_column_count)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SearchBox({ value, onInput, inputRef }: { value: string; onInput(v: string): void; inputRef?: Ref<HTMLInputElement> }) {
  return (
    <div class="searchbox">
      <label for="search-catalog" class="visually-hidden">Search catalog</label>
      <input id="search-catalog" type="search" role="searchbox" aria-label="Search catalog" value={value} ref={inputRef}
        placeholder="Search assets, columns, terms" onInput={(e) => onInput(e.currentTarget.value)} />
    </div>
  );
}
