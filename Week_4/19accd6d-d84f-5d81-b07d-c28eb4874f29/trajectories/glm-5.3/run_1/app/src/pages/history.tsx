import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, HttpError } from '../lib/api.js';
import type { RecipeSummary, RecipeVersion } from '../../shared/protocol.js';
import { localDate } from '../../shared/text.js';
import { Dialog } from '../ui/primitives.js';
import { Icon } from '../ui/icons.js';

export function HistoryPage({ recipeId, onOpenVersion }: { recipeId: string; onOpenVersion: (id: string, version: number) => void }): ReactNode {
  const [recipe, setRecipe] = useState<RecipeSummary | null>(null);
  const [versions, setVersions] = useState<RecipeVersion[]>([]);
  const [announce, setAnnounce] = useState('');
  const [compare, setCompare] = useState<{ from: number; to: number } | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);

  useEffect(() => {
    void api.recipe(recipeId).then((r) => {
      setRecipe(r.recipe);
      setVersions(r.versions);
    }).catch(() => undefined);
    void api.opened(recipeId).catch(() => undefined);
  }, [recipeId]);

  useEffect(() => {
    if (announce === '') return;
    const t = setTimeout(() => setAnnounce(''), 6000);
    return () => clearTimeout(t);
  }, [announce]);

  const openCompare = useCallback(async () => {
    if (versions.length < 2) return;
    const from = versions[Math.min(1, versions.length - 1)].n;
    const to = versions[0].n;
    setCompare({ from, to });
    try {
      const r = await api.compare(recipeId, from, to);
      setChanges(r.changes);
    } catch (e) {
      setChanges([e instanceof HttpError ? e.message : 'Compare failed.']);
    }
  }, [versions, recipeId]);

  const restore = useCallback(async (k: number) => {
    try {
      const r = await api.restore(recipeId, k, versions[0].n);
      setAnnounce(`Restored version ${k} as version ${r.version.n}`);
      const refreshed = await api.recipe(recipeId);
      setRecipe(refreshed.recipe);
      setVersions(refreshed.versions);
    } catch (e) {
      if (e instanceof HttpError && e.status === 409) {
        setAnnounce(e.message);
        const refreshed = await api.recipe(recipeId);
        setRecipe(refreshed.recipe);
        setVersions(refreshed.versions);
      }
    }
  }, [recipeId, versions]);

  return (
    <section className="pane" aria-label={recipe?.name ?? 'Recipe'} style={{ height: '100%' }} data-pane="history">
      <div className="pane-title">
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{recipe?.name ?? '…'}</h1>
      </div>
      <div className="pane-body">
        <ul role="list" aria-label="Versions" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {versions.map((v, i) => (
            <li key={v.n} role="listitem" aria-label={`Version ${v.n}`} className="list-row" style={{ minHeight: 52 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">Version {v.n}</div>
                <div className="meta">{v.note || 'No note'} · {v.author.displayName} · {localDate(v.createdAt)}</div>
              </div>
              <button className="btn" aria-label={`Open version ${v.n}`} onClick={() => onOpenVersion(recipeId, v.n)}>Open</button>
              {i > 0 ? <button className="btn" aria-label={`Restore version ${v.n}`} onClick={() => void restore(v.n)}>Restore</button> : null}
            </li>
          ))}
          {versions.length === 0 ? <div className="empty-state">Loading versions…</div> : null}
        </ul>
      </div>
      <div className="pane-status" role="status" aria-label="Library announcements">{announce}</div>
      <div style={{ padding: 10, borderTop: '1px solid var(--divider)' }}>
        <button className="btn primary" onClick={() => void openCompare()}>
          <Icon name="gitCompare" /> Compare versions
        </button>
      </div>
      {compare !== null ? (
        <Dialog title="Compare versions" label="compare" onClose={() => setCompare(null)}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>From version</span>
              <select
                aria-label="From version"
                style={{ width: '100%', padding: 6, border: '1px solid var(--divider)' }}
                value={compare.from}
                onChange={async (e) => {
                  const from = Number(e.target.value);
                  setCompare({ from, to: compare.to });
                  try {
                    const r = await api.compare(recipeId, from, compare.to);
                    setChanges(r.changes);
                  } catch { setChanges([]); }
                }}
              >
                {versions.map((v) => <option key={v.n} value={v.n}>Version {v.n}</option>)}
              </select>
            </label>
            <label style={{ flex: 1 }}>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>To version</span>
              <select
                aria-label="To version"
                style={{ width: '100%', padding: 6, border: '1px solid var(--divider)' }}
                value={compare.to}
                onChange={async (e) => {
                  const to = Number(e.target.value);
                  setCompare({ from: compare.from, to });
                  try {
                    const r = await api.compare(recipeId, compare.from, to);
                    setChanges(r.changes);
                  } catch { setChanges([]); }
                }}
              >
                {versions.map((v) => <option key={v.n} value={v.n}>Version {v.n}</option>)}
              </select>
            </label>
          </div>
          <ul role="list" aria-label="Changes" style={{ listStyle: 'none', margin: 0, padding: 0, fontFamily: 'var(--mono)', fontSize: 12.5 }}>
            {(changes ?? []).map((c, i) => <li key={i} style={{ padding: '4px 0', borderBottom: '1px solid var(--divider)' }}>{c}</li>)}
            {changes !== null && changes.length === 0 ? <li>These versions have the same steps.</li> : null}
          </ul>
          <div className="actions">
            <button className="btn" onClick={() => setCompare(null)}>Close</button>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
