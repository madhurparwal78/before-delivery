// The quote picker: searches blocks of other notes, only ever showing the answer for the text now
// in the box; Enter picks the active option.
import { useEffect, useRef, useState } from 'react';
import { get, NetworkError } from '../api.ts';
import { Dialog } from '../Dialog.tsx';
import { plural } from '../feedback.ts';

export interface PickedBlock { block_id: string; object_id: string; object_title: string; excerpt: string }
import { SEARCH_DELAY_MS } from '../../shared/motion.ts';

export function PickerDialog({ objectId, onPick, onClose }: {
  objectId: string;
  onPick: (picked: PickedBlock, row: DOMRect) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedBlock[] | null>(null);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const latest = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const search = (text: string) => {
    latest.current = text;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const query = new URLSearchParams({ q: text, exclude_object_id: objectId });
      get<{ results: PickedBlock[]; errors?: Record<string, string> }>(`/api/blocks/search?${query.toString()}`).then((r) => {
        if (latest.current !== text) return; // an earlier search answering late is thrown away
        if (r.status === 200) {
          setResults(r.data.results);
          setError('');
        } else {
          setResults([]);
          setError(r.data.errors?.q ?? '');
        }
        setActive(0);
      }, (e: unknown) => {
        if (e instanceof NetworkError && latest.current === text) setResults([]);
      });
    }, SEARCH_DELAY_MS);
  };

  useEffect(() => {
    search('');
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // the first search runs once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = results ?? [];
  const pick = (i: number) => {
    const item = shown[i];
    const row = list.current?.children[i];
    if (!item || !(row instanceof HTMLElement)) return;
    onPick(item, row.getBoundingClientRect());
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!shown.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % shown.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + shown.length) % shown.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    }
  };

  return (
    <Dialog label="Quote a block" onClose={onClose} className="picker" initialFocus={() => document.getElementById('picker-search')}>
      <h2>Quote a block</h2>
      <input
        id="picker-search" role="combobox" aria-label="Search blocks" aria-expanded="true" aria-controls="picker-results"
        aria-activedescendant={shown.length ? `picker-option-${active}` : undefined} aria-describedby={error ? 'picker-error' : undefined}
        autoComplete="off" value={q} onKeyDown={onKey}
        onChange={(e) => {
          setQ(e.target.value);
          search(e.target.value);
        }}
      />
      {error && <p id="picker-error" className="field-error">{error}</p>}
      <ul id="picker-results" role="listbox" aria-label="Matching blocks" className="option-list" ref={list}>
        {shown.map((r, i) => (
          <li
            key={r.block_id} id={`picker-option-${i}`} role="option" aria-selected={i === active}
            aria-label={`${r.object_title}: ${r.excerpt}`} className="option" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(i)}
          >
            <span className="option-title small-caps">{r.object_title}</span>
            <span className="option-excerpt">{r.excerpt}</span>
          </li>
        ))}
      </ul>
      <p role="status" aria-label="Picker results" className="muted picker-status">
        {results === null ? '' : shown.length ? plural(shown.length, 'matching block') : 'No blocks match.'}
      </p>
    </Dialog>
  );
}
