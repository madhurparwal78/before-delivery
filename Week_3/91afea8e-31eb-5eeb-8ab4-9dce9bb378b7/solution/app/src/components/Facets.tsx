import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { hasFilters, type SearchState } from "../pages/catalogue/query";
import { useSellerNames } from "../pages/catalogue/sellers";
import type { Facets as FacetCounts } from "../pages/catalogue/useSearchResults";

const PRICE_DEBOUNCE_MS = 350;

interface FacetsProps {
  state: SearchState;
  facets: FacetCounts;
  /** The pincode the delivery filter is for: the address bar's, or else the shopper's. */
  pin: string;
  /** Filters are off while search runs in basic mode. */
  disabled: boolean;
  /** False until the first answer is in: the groups are drawn once, with their choices, not as empty boxes that then grow. */
  ready: boolean;
  onChange: (next: SearchState) => void;
}

const words = (slug: string): string => slug.charAt(0).toUpperCase() + slug.slice(1).replace(/-/g, " ");

const keysWith = (counts: Record<string, number>, selected: string[]): string[] => [...new Set([...Object.keys(counts), ...selected])].sort((a, b) => a.localeCompare(b));

const NOTHING = <p className="facets__empty muted">nothing to filter</p>;

const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

interface ChoiceProps {
  name: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}

function Choice({ name, count, checked, onToggle }: ChoiceProps): ReactNode {
  return (
    <label className="choice facets__choice">
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="facets__name">{name}</span>
      <span className="facets__count">{count}</span>
    </label>
  );
}

/** A whole-rupee field: the address bar follows about a third of a second after typing stops. */
function PriceField({ label, value, onSettle }: { label: string; value: string; onSettle: (next: string) => void }): ReactNode {
  const id = useId();
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text === value) return undefined;
    const timer = window.setTimeout(() => onSettle(text), PRICE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, value, onSettle]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" inputMode="numeric" min={0} step={1} placeholder="₹" value={text} onChange={(event) => setText(event.target.value.replace(/\D/g, ""))} />
    </div>
  );
}

/** The facets: category, brand and seller with counts, a price range in whole rupees, a rating floor and the delivery filter. */
export function Facets({ state, facets, pin, disabled, ready, onChange }: FacetsProps): ReactNode {
  const sellerIds = keysWith(facets.seller, state.seller);
  const sellerName = useSellerNames(sellerIds);
  const categories = keysWith(facets.category, state.category ? [state.category] : []);
  const brands = keysWith(facets.brand, state.brand);

  if (!ready) return <div className="facets" aria-busy="true" />;
  return (
    <div className="facets">
      <fieldset className="facets__group" disabled={disabled}>
        <legend>Category</legend>
        {categories.length === 0 && NOTHING}
        {categories.map((slug) => (
          <Choice key={slug} name={words(slug)} count={facets.category[slug] ?? 0} checked={state.category === slug} onToggle={() => onChange({ ...state, category: state.category === slug ? "" : slug })} />
        ))}
      </fieldset>
      <fieldset className="facets__group" disabled={disabled}>
        <legend>Brand</legend>
        {brands.length === 0 && NOTHING}
        {brands.map((brand) => (
          <Choice key={brand} name={brand} count={facets.brand[brand] ?? 0} checked={state.brand.includes(brand)} onToggle={() => onChange({ ...state, brand: toggle(state.brand, brand) })} />
        ))}
      </fieldset>
      <fieldset className="facets__group" disabled={disabled}>
        <legend>Seller</legend>
        {sellerIds.length === 0 && NOTHING}
        {sellerIds
          .map((id) => ({ id, name: sellerName(id) }))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(({ id, name }) => (
            <Choice key={id} name={name} count={facets.seller[id] ?? 0} checked={state.seller.includes(id)} onToggle={() => onChange({ ...state, seller: toggle(state.seller, id) })} />
          ))}
      </fieldset>
      <fieldset className="facets__group facets__price" disabled={disabled}>
        <legend>Price in rupees</legend>
        <PriceField label="Minimum price" value={state.priceMin} onSettle={(priceMin) => onChange({ ...state, priceMin })} />
        <PriceField label="Maximum price" value={state.priceMax} onSettle={(priceMax) => onChange({ ...state, priceMax })} />
      </fieldset>
      <fieldset className="facets__group" disabled={disabled}>
        <legend>Rating</legend>
        {(["4", "3"] as const).map((floor) => (
          <label key={floor} className="choice facets__choice">
            <input type="radio" name="rating" aria-label={`${floor} stars & up`} checked={state.rating === floor} onChange={() => onChange({ ...state, rating: floor })} />
            <span className="facets__name" aria-hidden="true">
              {floor} stars &amp; up
            </span>
            <span className="facets__count" aria-hidden="true">
              {facets.rating[floor] ?? 0}
            </span>
          </label>
        ))}
      </fieldset>
      {pin !== "" && (
        <fieldset className="facets__group" disabled={disabled}>
          <legend>Delivery</legend>
          <label className="choice facets__choice">
            <input type="checkbox" checked={state.deliverable} onChange={(event) => onChange({ ...state, pin, deliverable: event.target.checked })} />
            <span className="facets__name">Only items that deliver to {pin}</span>
          </label>
        </fieldset>
      )}
      <Button onClick={() => onChange({ ...state, category: "", brand: [], seller: [], priceMin: "", priceMax: "", rating: "", deliverable: false })} disabled={disabled || !hasFilters(state)}>
        Clear filters
      </Button>
    </div>
  );
}
