import type { ReactNode } from 'react';
import type { FacetEntry } from '../lib/api.ts';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';

type FacetGroup = 'tag' | 'owner' | 'state' | 'term';

const GROUPS: { group: FacetGroup; label: string }[] = [
  { group: 'tag', label: 'Tag' },
  { group: 'owner', label: 'Owner' },
  { group: 'state', label: 'State' },
  { group: 'term', label: 'Term' },
];

function Radio({
  group,
  value,
  label,
  count,
  checked,
  onChoose,
}: {
  group: FacetGroup;
  value: string;
  label: string;
  count: number | null;
  checked: boolean;
  onChoose: (value: string) => void;
}): ReactNode {
  return (
    <div className="facet-option">
      <span
        role="radio"
        aria-checked={checked}
        aria-label={label}
        tabIndex={checked ? 0 : -1}
        data-value={value}
        data-focus-key={`radio:${group}:${value}`}
        onClick={() => onChoose(value)}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            onChoose(value);
          }
        }}
      >
        {label}
      </span>
      {count === null ? null : (
        <span className="mono" data-facet-count>
          {count}
        </span>
      )}
    </div>
  );
}

/** Each facet group is one Tab stop keyed by value; arrow keys choose and search at once. */
export function FacetGroups(): ReactNode {
  const state = useAppState();
  const facets = state.search?.facets;
  if (facets === undefined) return null;

  return (
    <>
      {GROUPS.map(({ group, label }) => {
        const entries: FacetEntry[] = facets[group];
        const selected = state.params[group] ?? '';
        const values = ['', ...entries.map((entry) => entry.value)];
        const choose = (value: string): void => {
          store.setFacet(group, value === '' ? null : value);
          store.requestFocus(`radio:${group}:${value}`);
        };
        const move = (direction: 1 | -1): void => {
          const index = values.indexOf(selected);
          const next = values[(index + direction + values.length) % values.length];
          choose(next);
        };
        return (
          <div
            key={group}
            role="radiogroup"
            aria-label={label}
            className="facet-group"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                move(1);
              }
              if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                move(-1);
              }
            }}
          >
            <h3>{label}</h3>
            <Radio
              group={group}
              value=""
              label="Any"
              count={null}
              checked={selected === ''}
              onChoose={choose}
            />
            {entries.map((entry) => (
              <Radio
                key={entry.value}
                group={group}
                value={entry.value}
                label={entry.label}
                count={entry.count}
                checked={selected === entry.value}
                onChoose={choose}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
