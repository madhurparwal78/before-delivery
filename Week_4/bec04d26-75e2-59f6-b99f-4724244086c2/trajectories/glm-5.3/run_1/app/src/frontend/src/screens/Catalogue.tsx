import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import type { MeJson, ReturnsEnvelope } from '../../../shared/types';
import { TopBar } from '../components/TopBar';
import { Tile, EmptyTile } from '../components/Tile';
import type { Session } from '../lib/session';
import { navigateTo } from '../lib/router';

export function Catalogue({ me }: { me: MeJson }): React.ReactNode {
  const [envelope, setEnvelope] = useState<ReturnsEnvelope | null>(null);
  const session: Session = { me, signOut: async () => {} };

  useEffect(() => {
    void api.returns('').then(setEnvelope);
  }, []);

  if (envelope === null) {
    return (
      <>
        <TopBar session={session} route={{ path: '/catalogue', navigate: () => {} }} />
        <main className="page">Loading</main>
      </>
    );
  }

  const stateCodes = [...new Set(envelope.returns.map((r) => r.state))].sort();
  const byClient = new Map<string, typeof envelope.returns>();
  for (const ret of envelope.returns) {
    const list = byClient.get(ret.client.name) ?? [];
    list.push(ret);
    byClient.set(ret.client.name, list);
  }

  if (envelope.returns.length === 0) {
    return (
      <>
        <TopBar session={session} route={{ path: '/catalogue', navigate: () => {} }} />
        <main className="page">
          <EmptyTile sentence="No returns yet. Register a client in a state to start." />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar session={session} route={{ path: '/catalogue', navigate: () => {} }} />
      <main className="page catalogue-page">
        <h1 className="page-title">Catalogue</h1>
        {[...byClient.entries()].map(([clientName, returns]) => (
          <CatalogueRow key={clientName} clientName={clientName} returns={returns} stateCodes={stateCodes} />
        ))}
      </main>
    </>
  );
}

function CatalogueRow({ clientName, returns, stateCodes }: {
  clientName: string;
  returns: ReturnsEnvelope['returns'];
  stateCodes: string[];
}): React.ReactNode {
  const [scroll, setScroll] = useState(0);
  const showNext = scroll < returns.length - 1;
  const showPrev = scroll > 0;

  const step = (delta: number) => {
    setScroll((current) => Math.min(returns.length - 1, Math.max(0, current + delta)));
  };

  return (
    <section className="catalogue-row" aria-label={clientName}>
      <h2 className="catalogue-client">{clientName}</h2>
      <div className="catalogue-controls">
        {showPrev ? (
          <button type="button" className="button button-secondary" onClick={() => step(-1)}>
            {`Previous returns for ${clientName}`}
          </button>
        ) : null}
        {showNext ? (
          <button type="button" className="button button-secondary" onClick={() => step(1)}>
            {`Next returns for ${clientName}`}
          </button>
        ) : null}
      </div>
      <ul aria-label={`Returns for ${clientName}`} className="catalogue-track">
        {returns.map((ret, index) => (
          <li
            key={ret.id}
            className={`catalogue-item ${index === scroll ? 'catalogue-item-current' : ''}`}
            style={{ transform: `translateX(calc(${-scroll} * (var(--tile-width) + var(--tile-gap))))` }}
          >
            <a
              className="catalogue-link"
              href={`/returns/${ret.id}`}
              data-return-id={ret.id}
              data-status={ret.status}
              data-overdue={String(ret.overdue)}
              data-due-at={ret.due_at}
              data-state={ret.state}
              data-version={ret.version}
              data-rate={ret.edition.rate}
              data-edition={ret.edition.effective_date}
              aria-label={`${clientName} ${ret.state} ${ret.period_label}`}
              onClick={(event) => {
                event.preventDefault();
                navigateTo(`/returns/${ret.id}`);
              }}
            >
              <Tile ret={ret} stateCodes={stateCodes} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
