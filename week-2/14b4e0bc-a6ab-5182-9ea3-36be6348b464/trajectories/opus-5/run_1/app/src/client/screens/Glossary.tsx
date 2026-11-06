import type { ReactNode } from 'react';
import { useAppState } from '../lib/hooks.ts';
import { store } from '../lib/store.ts';

export function Glossary(): ReactNode {
  const state = useAppState();
  const writable = state.session?.role === 'Steward' || state.session?.role === 'Admin';
  return (
    <div className="glossary">
      <h1 tabIndex={-1} data-focus-key="glossary-heading">
        Glossary
      </h1>
      <p role="status" aria-label="Activity" className="activity">
        {state.activity}
      </p>
      <p role="status" aria-label="Glossary updates" className="activity">
        {state.glossaryUpdates}
      </p>
      {writable ? (
        <button type="button" data-focus-key="new-term" onClick={() => store.openTermDialog(null)}>
          New term
        </button>
      ) : null}
      <ul role="list" aria-label="Terms" className="term-grid">
        {state.terms.map((term) => (
          <li key={term.id} data-term-id={term.id} data-revision={term.revision} className="term-card">
            <h2 className="term-name">{term.name}</h2>
            <p>{term.definition}</p>
            <ul role="list" className="term-assets">
              {term.assets.map((asset) => (
                <li key={asset.id}>
                  <a
                    href={`/catalog?asset=${encodeURIComponent(asset.id)}`}
                    data-focus-key={`term-asset:${term.id}:${asset.id}`}
                    className="mono"
                    onClick={(event) => {
                      event.preventDefault();
                      store.navigate(`/catalog?asset=${encodeURIComponent(asset.id)}`);
                    }}
                  >
                    {asset.id}
                  </a>
                </li>
              ))}
            </ul>
            {writable ? (
              <button
                type="button"
                data-focus-key={`term-edit:${term.id}`}
                onClick={() => store.openTermDialog(term)}
              >
                {`Edit ${term.name}`}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
