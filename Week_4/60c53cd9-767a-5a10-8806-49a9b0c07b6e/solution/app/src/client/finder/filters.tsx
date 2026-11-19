/** The filter controls: search box, facet chips with live counts, price bounds and Clear filters. */
import { Check, Search } from "lucide-react";
import type { ReactNode } from "react";
import { BANDS, BAND_LABEL, FACINGS, STATUS_LABEL, VIEW_LABEL, VIEW_TAGS, bedroomLabel, type CellStatus } from "../../shared/domain.js";
import { FACET_VALUES, type FacetName, type FieldErrors, type SearchFilters } from "../../shared/search-rules.js";
import type { SearchReply } from "../../shared/api-types.js";
import type { SearchActions } from "./use-search.js";

interface Props {
  readonly filters: SearchFilters;
  readonly errors: FieldErrors;
  readonly reply: SearchReply | null;
  readonly unavailable: boolean;
  readonly actions: Pick<SearchActions, "toggle" | "setText" | "setPrice" | "clear">;
  readonly idPrefix: string;
}

const GROUPS: readonly { name: FacetName; legend: string; label: (value: string) => string }[] = [
  { name: "bedrooms", legend: "Bedrooms", label: (value) => bedroomLabel(Number(value)) },
  { name: "band", legend: "Floors", label: (value) => BAND_LABEL[value as (typeof BANDS)[number]] },
  { name: "facing", legend: "Facing", label: (value) => FACINGS.find((facing) => facing === value) ?? value },
  { name: "view", legend: "View", label: (value) => VIEW_LABEL[value as (typeof VIEW_TAGS)[number]] },
  { name: "status", legend: "Availability", label: (value) => STATUS_LABEL[value as CellStatus] },
];

export const FilterControls = ({ filters, errors, reply, unavailable, actions, idPrefix }: Props): ReactNode => {
  const invalid = (key: keyof FieldErrors): { "aria-invalid"?: true; "aria-describedby"?: string } =>
    errors[key] ? { "aria-invalid": true, "aria-describedby": `${idPrefix}-${key}-error` } : {};
  const error = (key: keyof FieldErrors): ReactNode =>
    errors[key] ? (
      <p className="field-error" id={`${idPrefix}-${key}-error`}>
        {errors[key]}
      </p>
    ) : null;

  return (
    <div className="filter-controls">
      <div className="field">
        <label htmlFor={`${idPrefix}-q`}>Search homes</label>
        <div className="search-input">
          <Search size={20} aria-hidden="true" />
          <input
            id={`${idPrefix}-q`}
            type="search"
            autoComplete="off"
            value={filters.q}
            aria-disabled={unavailable ? "true" : undefined}
            readOnly={unavailable}
            onChange={(event) => actions.setText(event.target.value)}
            {...invalid("q")}
          />
        </div>
        {error("q")}
      </div>
      {GROUPS.map((group) => (
        <fieldset key={group.name} aria-label={group.legend} className="chip-group" aria-invalid={errors[group.name] ? true : undefined} aria-describedby={errors[group.name] ? `${idPrefix}-${group.name}-error` : undefined}>
          <legend>{group.legend}</legend>
          <div className="chips">
            {FACET_VALUES[group.name].map((value) => {
              const checked = filters[group.name].includes(value);
              const count = reply?.facets[group.name][value] ?? 0;
              return (
                <label key={value} className={`chip${checked ? " chip-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-disabled={unavailable ? "true" : undefined}
                    onChange={() => actions.toggle(group.name, value)}
                  />
                  {checked ? <Check size={16} strokeWidth={3} aria-hidden="true" /> : null}
                  <span>
                    {group.label(value)}
                    {` (${count})`}
                  </span>
                </label>
              );
            })}
          </div>
          {error(group.name)}
        </fieldset>
      ))}
      <div className="price-fields">
        {(["priceMin", "priceMax"] as const).map((key) => (
          <div className="field" key={key}>
            <label htmlFor={`${idPrefix}-${key}`}>{key === "priceMin" ? "Lowest price" : "Highest price"}</label>
            <input
              id={`${idPrefix}-${key}`}
              type="number"
              inputMode="numeric"
              step="1"
              value={filters[key]}
              aria-disabled={unavailable ? "true" : undefined}
              readOnly={unavailable}
              onChange={(event) => actions.setPrice(key, event.target.value)}
              {...invalid(key)}
            />
            {error(key)}
          </div>
        ))}
      </div>
      <button type="button" className="button" aria-disabled={unavailable ? "true" : undefined} onClick={actions.clear}>
        Clear filters
      </button>
    </div>
  );
};
