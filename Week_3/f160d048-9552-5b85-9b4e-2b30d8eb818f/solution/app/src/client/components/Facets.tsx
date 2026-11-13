import type { KeyboardEvent, RefObject } from "react";

export type FacetItem = { id: string; label: string; count?: number };

type Props = {
  label: string;
  items: readonly FacetItem[];
  selected: readonly string[];
  onToggle: (item: FacetItem) => void;
  /** Where focus goes when the last chip of the group was removed with Delete or Backspace. */
  afterLast: RefObject<HTMLElement | null>;
};

/** A group of toggle chips: Space or Enter toggles, Delete or Backspace on a pressed chip removes it and moves focus on. */
export function FacetGroup({ label, items, selected, onToggle, afterLast }: Props) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, item: FacetItem) {
    if ((event.key !== "Delete" && event.key !== "Backspace") || !selected.includes(item.id)) return;
    event.preventDefault();
    const next = event.currentTarget.closest(".facet-chip")?.nextElementSibling?.querySelector("button");
    onToggle(item);
    (next ?? afterLast.current)?.focus();
  }
  return (
    <div className="facet-group" role="group" aria-label={label}>
      <span className="legend" aria-hidden="true">{label}</span>
      {items.map((item) => (
        <span className="facet-chip" key={item.id}>
          <button type="button" className="chip" aria-pressed={selected.includes(item.id)} onClick={() => onToggle(item)} onKeyDown={(event) => onKeyDown(event, item)}>
            {item.label}
          </button>
          {item.count !== undefined ? <span className="count">{item.count}</span> : null}
        </span>
      ))}
    </div>
  );
}
