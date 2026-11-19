import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError } from '../lib/api.js';
import type { Person } from '../lib/types.js';

interface Props {
  id: 'Person' | 'New owner';
  kind: 'partner' | 'staff';
  excludeId?: string;
  value: string;
  onPick: (person: Person) => void;
  labelText: string;
}

export function PeoplePicker({ id, kind, excludeId, onPick, labelText }: Props): preact.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [outage, setOutage] = useState(false);
  const [activeId, setActiveId] = useState('');
  const timer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (query.length === 0) { setResults([]); setOpen(false); return; }
    timer.current = window.setTimeout(async () => {
      try {
        const { people } = await api.people(query, kind);
        const filtered = people.filter(p => p.id !== excludeId);
        setResults(filtered.slice(0, 20));
        setOutage(false);
        setOpen(true);
        setFocusIndex(filtered.length > 0 ? 0 : -1);
      } catch (err) {
        if (err instanceof ApiError && err.code === 'directory_unavailable') {
          setOutage(true);
          setOpen(true);
        }
      }
    }, 250);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [query]);

  const pick = (person: Person): void => {
    onPick(person);
    setInputValue(`${person.name} — ${person.firm}`);
    setActiveId(person.id);
    setQuery('');
    setOpen(false);
    setResults([]);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && results.length > 0) setOpen(true);
      else setFocusIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const person = results[focusIndex];
      if (person) pick(person);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div class="field" ref={rootRef}>
      <label for={`picker-${id}`}>{labelText}</label>
      <div class="combobox-wrap">
        <input
          ref={inputRef}
          id={`picker-${id}`}
          role="combobox"
          aria-expanded={open ? 'true' : 'false'}
          aria-controls={`list-${id}`}
          aria-autocomplete="list"
          aria-label={labelText}
          class="combobox-input"
          value={inputValue}
          onInput={e => { setInputValue((e.target as HTMLInputElement).value); setQuery((e.target as HTMLInputElement).value); setActiveId(''); }}
          onKeyDown={onKeyDown}
        />
        {open && (
          <ul id={`list-${id}`} role="listbox" class="peoplelist" aria-label="People">
            {outage && <li class="popt">The people directory is unreachable. Existing access is unchanged. Try again in a moment.</li>}
            {!outage && results.length === 0 && query.length > 0 && <li class="popt">No matches.</li>}
            {!outage && results.map((p, i) => (
              <li
                key={p.id}
                role="option"
                aria-selected={activeId === p.id}
                class={`popt${i === focusIndex ? ' focused' : ''}`}
                onMouseDown={e => { e.preventDefault(); pick(p); }}
              >
                <span class="avatar-circle">{initials(p.name)}</span>
                <span>{`${p.name} — ${p.firm}`}</span>
                <span class="tag">{p.kind === 'staff' ? 'Staff' : 'Partner'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).map(w => w[0] ?? '').join('').slice(0, 2).toUpperCase();
}
