import { useId } from "react";
import type { FacetCounts, FacetGroup, FilterOptions } from "../../shared/api";
import { GROUPS, GROUP_TITLES, type CatalogueState } from "../lib/catalogue";

interface Props {
  options: FilterOptions;
  facets: FacetCounts | null;
  state: CatalogueState;
  showCategory: boolean;
  /** The desktop panel is a region named Filters; the sheet's dialog already carries that name. */
  asRegion: boolean;
  onToggle: (group: FacetGroup, value: string, on: boolean) => void;
}

export function FilterPanel({ options, facets, state, showCategory, asRegion, onToggle }: Props) {
  const prefix = useId();
  const groups = GROUPS.filter((g) => (g !== "category" || showCategory) && options[g].length > 0);
  const body = groups.map((group) => (
    <fieldset key={group} className="filter-group">
      <legend>{GROUP_TITLES[group]}</legend>
      {options[group].map((option) => {
        const id = `${prefix}-${group}-${option.value}`;
        const count = facets?.[group][option.value] ?? 0;
        return (
          <div key={option.value} className="check-row">
            <input
              id={id}
              type="checkbox"
              checked={state.filters[group].includes(option.value)}
              aria-describedby={facets ? `${id}-count` : undefined}
              onChange={(event) => onToggle(group, option.value, event.target.checked)}
            />
            <label htmlFor={id}>{option.label}</label>
            {facets && (
              <span id={`${id}-count`} className="check-count">
                {count}
              </span>
            )}
          </div>
        );
      })}
    </fieldset>
  ));
  return asRegion ? (
    <section aria-label="Filters" className="filters">
      {body}
    </section>
  ) : (
    <div className="filters">{body}</div>
  );
}
