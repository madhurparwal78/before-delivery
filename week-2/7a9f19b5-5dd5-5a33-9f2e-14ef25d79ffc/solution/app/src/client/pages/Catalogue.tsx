import { Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Product } from "../../shared/types";
import { CompareTray } from "../components/CompareTray";
import { Dialog } from "../components/Dialog";
import { ProductCard } from "../components/ProductCard";
import { request } from "../lib/api";
import { familyLabel, FINISH_COLOURS, LIGHT_COLOURS, shownVariant } from "../lib/format";
import { useDebounced, useDesktop } from "../lib/hooks";
import { Link, replaceQuery, useLocation } from "../lib/router";
import { useFavourites } from "../lib/favourites";
import { useSession } from "../lib/session";

const SEARCH_DELAY_MS = 250;

interface FilterOptions {
  finishes: { code: string; name: string }[];
  beams: number[];
  ccts: number[];
}

function optionsFrom(products: Product[]): FilterOptions {
  const variants = products.flatMap((p) => p.variants);
  const finishes = new Map(variants.map((v) => [v.finish, v.finish_name]));
  const order = ["WH", "BK", "BR", "BZ", "CH", "SN"];
  return {
    finishes: [...finishes].map(([code, name]) => ({ code, name })).sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code)),
    beams: [...new Set(variants.map((v) => v.beam_deg))].sort((a, b) => a - b),
    ccts: [...new Set(variants.map((v) => v.cct_k))].sort((a, b) => a - b),
  };
}

function listParam(search: URLSearchParams, name: string): string[] {
  return (search.get(name) ?? "").split(",").filter(Boolean);
}

function FilterGroups({ options, search, onToggle }: { options: FilterOptions; search: URLSearchParams; onToggle: (name: string, value: string) => void }) {
  const finish = listParam(search, "finish");
  const beam = listParam(search, "beam");
  const cct = listParam(search, "cct");
  return (
    <div className="filter-groups">
      <fieldset className="filter-group">
        <legend>Finish</legend>
        <div className="filter-group__options filter-group__options--two">
          {options.finishes.map((option) => (
            <label key={option.code} className="check check--chip">
              <input type="checkbox" checked={finish.includes(option.code)} onChange={() => onToggle("finish", option.code)} />
              <span className="swatch" style={{ background: FINISH_COLOURS[option.code] }} aria-hidden="true" />
              <span>{option.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="filter-group">
        <legend>Beam</legend>
        <div className="filter-group__options filter-group__options--four">
          {options.beams.map((value) => (
            <label key={value} className="check check--chip">
              <input type="checkbox" checked={beam.includes(String(value))} onChange={() => onToggle("beam", String(value))} />
              <span className="mono">{value}°</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="filter-group">
        <legend>Colour temperature</legend>
        <div className="filter-group__options filter-group__options--two">
          {options.ccts.map((value) => (
            <label key={value} className="check check--chip">
              <input type="checkbox" checked={cct.includes(String(value))} onChange={() => onToggle("cct", String(value))} />
              <span className="swatch swatch--light" style={{ background: LIGHT_COLOURS[value] }} aria-hidden="true" />
              <span className="mono">{value}K</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="check check--chip filter-clearance">
        <input type="checkbox" checked={search.get("clearance") === "true"} onChange={() => onToggle("clearance", "true")} />
        <span>Clearance only</span>
      </label>
    </div>
  );
}

export function Catalogue() {
  const { search } = useLocation();
  const desktop = useDesktop();
  const { seesTrade } = useSession();
  const favourites = useFavourites();
  const [query, setQuery] = useState(search.get("q") ?? "");
  const settledQuery = useDebounced(query, SEARCH_DELAY_MS);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const family = search.get("family");
  const clearance = family === "clearance" || search.get("clearance") === "true";
  const apiQuery = useMemo(() => {
    const params = new URLSearchParams();
    for (const name of ["family", "finish", "beam", "cct", "clearance"]) {
      const value = search.get(name);
      if (value) params.set(name, value);
    }
    if (settledQuery.trim()) params.set("q", settledQuery.trim());
    return params.toString();
  }, [search, settledQuery]);

  useEffect(() => {
    document.title = `${family ? (family === "clearance" ? "Clearance" : familyLabel(family)) : "Catalogue"} · Lightfall`;
  }, [family]);

  useEffect(() => {
    void request<{ products: Product[] }>("/api/catalogue").then((reply) => reply.ok && setOptions(optionsFrom(reply.data.products)));
  }, []);

  // Search narrows the cards a quarter of a second after the last keystroke; the URL follows without a reload.
  useEffect(() => {
    const current = (new URLSearchParams(location.search).get("q") ?? "").trim();
    if (current === settledQuery.trim()) return;
    const next = new URLSearchParams(location.search);
    if (settledQuery.trim()) next.set("q", settledQuery.trim());
    else next.delete("q");
    replaceQuery(next);
  }, [settledQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void request<{ products: Product[] }>(`/api/catalogue${apiQuery ? `?${apiQuery}` : ""}`).then((reply) => {
      if (cancelled || !reply.ok) return;
      setProducts(reply.data.products);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [apiQuery]);

  const toggleFilter = (name: string, value: string) => {
    const next = new URLSearchParams(location.search);
    if (name === "clearance") {
      if (next.get("clearance") === "true") next.delete("clearance");
      else next.set("clearance", "true");
    } else {
      const values = listParam(next, name);
      const updated = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
      if (updated.length) next.set(name, updated.join(","));
      else next.delete(name);
    }
    replaceQuery(next);
  };

  const count = products?.length ?? 0;
  const title = family === "clearance" ? "Clearance" : family ? familyLabel(family) : "Catalogue";

  return (
    <div className="catalogue page-docked">
      <header className="page-head">
        <p className="eyebrow">Southerly Light Works</p>
        <h1>{title}</h1>
        {family && (
          <p className="page-head__aside">
            <Link href="/catalogue">All fittings</Link>
          </p>
        )}
      </header>
      <div className="catalogue__toolbar">
        <div className="search-field">
          <Search aria-hidden="true" size={18} strokeWidth={1.5} />
          <label htmlFor="catalogue-search" className="visually-hidden">
            Search fittings
          </label>
          <input
            id="catalogue-search"
            type="search"
            placeholder="Search by name, description or code"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {!desktop && (
          <button type="button" className="button button--quiet filters-button" onClick={() => setSheetOpen(true)}>
            <SlidersHorizontal aria-hidden="true" size={18} strokeWidth={1.5} />
            Filters
          </button>
        )}
        <p role="status" aria-label="Results count" className="results-count mono">
          {products ? `${count} ${count === 1 ? "fitting" : "fittings"}` : ""}
        </p>
      </div>
      <div className="catalogue__body">
        {desktop && (
          <section aria-label="Filters" className="filters-rail">
            <h2 className="filters-rail__title">Filters</h2>
            {options && <FilterGroups options={options} search={search} onToggle={toggleFilter} />}
          </section>
        )}
        <div className={`card-grid ${loading && products ? "card-grid--busy" : ""}`} aria-busy={loading}>
          {!products && Array.from({ length: 6 }, (_, index) => <div key={index} className="card card--skeleton" aria-hidden="true" />)}
          {products?.map((product) => {
            const variant = shownVariant(product, clearance);
            return (
              <ProductCard
                key={product.slug}
                product={product}
                variant={variant}
                seesTrade={seesTrade}
                saved={favourites.isSaved(product.slug)}
                onToggleSave={(v) => void favourites.toggle(product.slug, v).then(setNotice)}
              />
            );
          })}
          {products && count === 0 && (
            <p className="empty-note">No fittings match these filters. Clear a filter to see more.</p>
          )}
        </div>
      </div>
      <p role="status" className="page-notice">
        {notice}
      </p>
      {!desktop && (
        <Dialog title="Filters" open={sheetOpen} onClose={() => setSheetOpen(false)} variant="sheet">
          {options && <FilterGroups options={options} search={search} onToggle={toggleFilter} />}
          <button type="button" className="button button--primary sheet-done" onClick={() => setSheetOpen(false)}>
            Show results
          </button>
        </Dialog>
      )}
      <CompareTray />
    </div>
  );
}
