import { useMemo, useState } from 'react';
import { FAMILIES, OPERATIONS, operation } from '../../shared/catalogue.js';
import { Icon } from '../ui/icons.js';

export function OperationsPane({
  query,
  setQuery,
  onAdd,
  favourites,
  onEditFavourites,
  openFamily,
  setOpenFamily,
  phoneMode,
}: {
  query: string;
  setQuery: (q: string) => void;
  onAdd: (op: string) => void;
  favourites: string[];
  onEditFavourites: () => void;
  openFamily: string;
  setOpenFamily: (f: string) => void;
  phoneMode: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [favActive, setFavActive] = useState(0);
  const [familyActive, setFamilyActive] = useState<Record<string, number>>({});

  const results = useMemo(() => {
    if (query === '') return null;
    const q = query.toLowerCase();
    return OPERATIONS.filter((o) => o.name.toLowerCase().includes(q)).map((o) => o.name);
  }, [query]);

  const favs = useMemo(() => favourites.map((f) => operation(f)).filter((o): o is NonNullable<typeof o> => o !== undefined), [favourites]);

  const commitActive = (name: string) => {
    onAdd(name);
    setQuery('');
    setActiveIndex(0);
  };

  return (
    <section className="pane" aria-label="Operations" tabIndex={-1} data-pane="operations">
      <div className="pane-title">
        <h2>Operations</h2>
      </div>
      <input
        className="search-field"
        type="search"
        placeholder={phoneMode ? 'Search operations' : 'Find operation'}
        aria-label="Find operation"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); }}
        onKeyDown={(e) => {
          if (results === null) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (results.length > 0) setActiveIndex((i) => (i + 1) % results.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (results.length > 0) setActiveIndex((i) => (i - 1 + results.length) % results.length);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const name = results[activeIndex];
            if (name) {
              commitActive(name);
              (e.target as HTMLInputElement).select();
            }
          }
        }}
      />
      <div className="pane-body">
        {results !== null ? (
          <div role="listbox" aria-label="Operations" tabIndex={0}>
            {results.map((name, i) => (
              <button key={name} role="option" aria-selected={i === activeIndex} className="op-row" onClick={() => commitActive(name)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((a) => Math.min(a + 1, results.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((a) => Math.max(a - 1, 0)); }
                  if (e.key === 'Enter') { e.preventDefault(); commitActive(name); }
                }}>
                {name}
              </button>
            ))}
            {results.length === 0 ? <div className="empty-state">No operations match {query}.</div> : null}
          </div>
        ) : (
          <>
            <div className="favourites-row">
              <span>Favourites</span>
              <button className="icon-btn" aria-label="Edit favourites" onClick={onEditFavourites} title="Edit favourites"><Icon name="star" /></button>
            </div>
            <div role="listbox" aria-label="Favourites" tabIndex={0}>
              {favs.map((o, i) => (
                <button key={o.name} role="option" aria-selected={i === favActive} className="op-row" onClick={() => onAdd(o.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setFavActive((a) => Math.min(a + 1, favs.length - 1)); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setFavActive((a) => Math.max(a - 1, 0)); }
                    if (e.key === 'Enter') { e.preventDefault(); onAdd(o.name); }
                  }}>
                  {o.name}
                </button>
              ))}
            </div>
            {FAMILIES.map((family) => (
              <div key={family}>
                <button
                  className="family-header"
                  aria-expanded={openFamily === family}
                  aria-controls={`family-${family.replace(/\s/g, '-')}`}
                  onClick={() => setOpenFamily(openFamily === family ? '' : family)}
                >
                  <span>{family}</span>
                  <Icon name={openFamily === family ? 'chevronDown' : 'chevronRight'} />
                </button>
                <div
                  id={`family-${family.replace(/\s/g, '-')}`}
                  role="listbox"
                  aria-label={family}
                  tabIndex={openFamily === family ? 0 : -1}
                  style={openFamily === family ? undefined : { height: 0, overflow: 'hidden', position: 'absolute', visibility: 'hidden' }}
                >
                  {openFamily === family
                    ? OPERATIONS.filter((o) => o.family === family).map((o, i) => (
                        <button key={o.name} role="option" aria-selected={i === (familyActive[family] ?? 0)} className="op-row" onClick={() => onAdd(o.name)}
                          onKeyDown={(e) => {
                            const count = OPERATIONS.filter((op) => op.family === family).length;
                            if (e.key === 'ArrowDown') { e.preventDefault(); setFamilyActive((m) => ({ ...m, [family]: Math.min((m[family] ?? 0) + 1, count - 1) })); }
                            if (e.key === 'ArrowUp') { e.preventDefault(); setFamilyActive((m) => ({ ...m, [family]: Math.max((m[family] ?? 0) - 1, 0) })); }
                            if (e.key === 'Enter') { e.preventDefault(); onAdd(o.name); }
                          }}>
                          {o.name}
                        </button>
                      ))
                    : null}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
      <div className="pane-status">{results !== null ? `${results.length} operations` : `${OPERATIONS.length} operations`}</div>
    </section>
  );
}
