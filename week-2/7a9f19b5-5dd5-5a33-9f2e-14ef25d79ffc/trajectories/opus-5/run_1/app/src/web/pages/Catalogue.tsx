/**
 * The catalogue. Typing in the search box filters the cards in place a quarter of
 * a second after the last keystroke; ticking a filter does the same immediately.
 * The URL query updates without a reload.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, catalogueSearch } from "../api.js";
import { CATALOGUE, PRODUCT } from "../../shared/copy.js";
import { FILTER_BEAMS, FILTER_CCTS, FINISHES } from "../../shared/domain.js";
import type { Product } from "../../shared/types.js";
import { useAnnouncer, useBreakpoint, useRouter, useSession, useTray } from "../state/app.js";
import { Dialog } from "../components/Dialog.js";
import { ProductCard, shownVariant } from "../components/ProductCard.js";

const SEARCH_DEBOUNCE_MS = 250;

const FINISH_SWATCH: Record<string, string> = {
  WH: "#e9e6df",
  BK: "#14161a",
  BR: "#b08d4b",
  BZ: "#6d5438",
  CH: "#3a3d44",
  SN: "#b9bcc1",
};

interface Filters {
  finishes: string[];
  beams: number[];
  ccts: number[];
  clearanceOnly: boolean;
}

function readFilters(search: string): { q: string; family: string | null; filters: Filters } {
  const params = new URLSearchParams(search);
  const list = (name: string): string[] =>
    (params.get(name) ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return {
    q: params.get("q") ?? "",
    family: params.get("family"),
    filters: {
      finishes: list("finish"),
      beams: list("beam").map(Number).filter(Number.isFinite),
      ccts: list("cct").map(Number).filter(Number.isFinite),
      clearanceOnly: params.get("clearance") === "true",
    },
  };
}

function FilterGroups({ filters, family, onChange }: { filters: Filters; family: string | null; onChange: (next: Filters) => void }) {
  const toggle = <T,>(values: T[], value: T): T[] =>
    values.includes(value) ? values.filter((held) => held !== value) : [...values, value];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <fieldset className="check-set" aria-label="Finish">
        <legend>Finish</legend>
        {FINISHES.map((finish) => (
          <label className="chip" key={finish.code}>
            <input
              type="checkbox"
              checked={filters.finishes.includes(finish.code)}
              onChange={() => onChange({ ...filters, finishes: toggle(filters.finishes, finish.code) })}
            />
            <span className="swatch" style={{ background: FINISH_SWATCH[finish.code] }} aria-hidden="true" />
            <span>{finish.name}</span>
          </label>
        ))}
      </fieldset>

      <fieldset className="check-set" aria-label="Beam">
        <legend>Beam</legend>
        <div className="row">
          {FILTER_BEAMS.map((beam) => (
            <label className="chip" key={beam}>
              <input
                type="checkbox"
                checked={filters.beams.includes(beam)}
                onChange={() => onChange({ ...filters, beams: toggle(filters.beams, beam) })}
              />
              <span className="numeric">{`${beam}\u00b0`}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="check-set" aria-label="Colour temperature">
        <legend>Colour temperature</legend>
        <div className="row">
          {FILTER_CCTS.map((cct) => (
            <label className="chip" key={cct}>
              <input
                type="checkbox"
                checked={filters.ccts.includes(cct)}
                onChange={() => onChange({ ...filters, ccts: toggle(filters.ccts, cct) })}
              />
              <span className="numeric">{`${cct}K`}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="chip">
        <input
          type="checkbox"
          checked={filters.clearanceOnly || family === "clearance"}
          disabled={family === "clearance"}
          onChange={() => onChange({ ...filters, clearanceOnly: !filters.clearanceOnly })}
        />
        <span>Clearance only</span>
      </label>
    </div>
  );
}

export function CataloguePage() {
  const { search, setQuery } = useRouter();
  const { user } = useSession();
  const tray = useTray();
  const breakpoint = useBreakpoint();
  const { message, announce } = useAnnouncer();

  const initial = useMemo(() => readFilters(search), [search]);
  const [q, setQ] = useState(initial.q);
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [sheetOpen, setSheetOpen] = useState(false);

  const family = initial.family;
  // Under the clearance family the cards show each product's clearance variant.
  const preferClearance = family === "clearance" || filters.clearanceOnly;

  const loadFavourites = useCallback(async () => {
    if (!user) {
      setSaved(new Set());
      return;
    }
    try {
      const { items } = await api.favourites();
      setSaved(new Set(items.map((item) => item.code)));
    } catch {
      setSaved(new Set());
    }
  }, [user]);

  useEffect(() => {
    void loadFavourites();
  }, [loadFavourites]);

  // Debounce the search box; filters apply immediately.
  const debounced = useRef(q);
  const [appliedQ, setAppliedQ] = useState(q);
  useEffect(() => {
    debounced.current = q;
    const timer = setTimeout(() => setAppliedQ(debounced.current), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    const query = {
      q: appliedQ,
      family,
      finish: filters.finishes,
      beam: filters.beams,
      cct: filters.ccts,
      clearance: filters.clearanceOnly,
    };
    void api.catalogue(query).then((result) => {
      if (cancelled) return;
      setProducts(result.products);
      announce(CATALOGUE.resultsCount(result.products.length));
    });
    // The URL query follows the controls without a reload.
    setQuery(catalogueSearch(query));
    return () => {
      cancelled = true;
    };
  }, [appliedQ, family, filters, announce, setQuery]);

  const onCompare = (product: Product): void => {
    const variant = shownVariant(product, preferClearance);
    const accepted = tray.add({ code: variant.code, productName: product.name, productSlug: product.slug });
    announce(accepted ? PRODUCT.addedToComparison : PRODUCT.comparisonFull);
  };

  const onSave = async (product: Product): Promise<void> => {
    const variant = shownVariant(product, preferClearance);
    if (!user) {
      announce(PRODUCT.signInToSave);
      return;
    }
    try {
      if (saved.has(variant.code)) {
        await api.removeFavourite(variant.code);
        announce(PRODUCT.removedFromFavourites);
      } else {
        await api.saveFavourite(variant.code);
        announce(PRODUCT.savedToFavourites);
      }
      await loadFavourites();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      announce(PRODUCT.signInToSave);
    }
  };

  const count = products?.length ?? 0;
  const inline = breakpoint === "desktop";

  return (
    <div className="wrap section">
      <h1>{family === "clearance" ? "Clearance" : "Catalogue"}</h1>

      <div className="grid">
        {inline && (
          <div style={{ gridColumn: "span 3" }}>
            <section className="framed" aria-label="Filters">
              <FilterGroups filters={filters} family={family} onChange={setFilters} />
            </section>
          </div>
        )}

        <div style={{ gridColumn: inline ? "span 9" : "1 / -1" }}>
          <div className="row" style={{ marginBottom: 16 }}>
            <div className="field" style={{ flex: "1 1 240px" }}>
              <label htmlFor="catalogue-search">Search fittings</label>
              <input
                id="catalogue-search"
                type="text"
                role="searchbox"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </div>
            {!inline && (
              <button type="button" className="button" onClick={() => setSheetOpen(true)}>
                Filters
              </button>
            )}
          </div>

          <p role="status" aria-label="Results count" className="small muted">
            {products === null ? "" : CATALOGUE.resultsCount(count)}
          </p>
          <span className="visually-hidden" aria-live="polite">
            {message}
          </span>

          <div className="card-grid" style={{ marginTop: 16 }}>
            {(products ?? []).map((product) => {
              const variant = shownVariant(product, preferClearance);
              return (
                <ProductCard
                  key={product.slug}
                  product={product}
                  variant={variant}
                  inTray={tray.has(variant.code)}
                  saved={saved.has(variant.code)}
                  onCompare={() => onCompare(product)}
                  onSave={() => void onSave(product)}
                />
              );
            })}
          </div>
        </div>
      </div>

      {sheetOpen && (
        <Dialog title="Filters" variant="sheet" onClose={() => setSheetOpen(false)}>
          {/* The sheet applies each tick as it is made. */}
          <FilterGroups filters={filters} family={family} onChange={setFilters} />
          <div className="dialog-actions">
            <button type="button" className="button button-primary" onClick={() => setSheetOpen(false)}>
              Show results
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
