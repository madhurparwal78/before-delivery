import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, HttpError } from '../lib/api.js';
import type { RecipeSummary } from '../../shared/protocol.js';
import { Icon } from '../ui/icons.js';

export function LibraryPage({ signal, onOpen }: { signal: number; onOpen: (id: string) => void }): ReactNode {
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RecipeSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.recipes();
      setRecipes(r.recipes);
    } catch {
      setRecipes([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load, signal]);

  // A search request happens only for a non-empty query, never on page load (Feedback states).
  useEffect(() => {
    if (query.trim() === '') {
      setResults(null);
      setNotice(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await api.search(query);
        if (!cancelled) { setResults(r.results); setNotice(null); }
      } catch (e) {
        if (!cancelled) setNotice(e instanceof HttpError ? e.message : 'Search failed.');
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const shown = notice !== null ? (recipes ?? []) : results ?? recipes ?? [];
  const count = shown.length;
  const status = notice !== null
    ? `${count} ${count === 1 ? 'recipe' : 'recipes'}`
    : results !== null
      ? `${count} ${count === 1 ? 'result' : 'results'}`
      : `${count} ${count === 1 ? 'recipe' : 'recipes'}`;

  return (
    <section className="pane" aria-label="Library" style={{ height: '100%' }} data-pane="library">
      <div className="pane-title">
        <h2>Library</h2>
      </div>
      <input
        className="search-field"
        type="search"
        aria-label="Search recipes"
        placeholder="Search recipes"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {notice !== null ? <div className="pane-alert" role="alert">{notice}</div> : null}
      <div className="pane-body">
        {shown.length === 0 ? (
          <div className="empty-state">
            {query !== '' && notice === null
              ? `No recipes match ${query}.`
              : 'No recipes yet. Save one from the workbench.'}
          </div>
        ) : (
          <ul role="list" aria-label="Recipes" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {shown.map((r) => (
              <li key={r.id} role="listitem" aria-label={r.name} className="list-row">
                <a href={`/library/${r.id}`} onClick={(e) => { e.preventDefault(); onOpen(r.id); }} style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{r.name}</div>
                  <div className="meta">{r.owner.name} · version {r.latestVersion}{r.tags.length > 0 ? ` · ${r.tags.join(', ')}` : ''}</div>
                </a>
                <Icon name="chevronRight" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="pane-status" aria-label="Library status">{status}</div>
    </section>
  );
}
