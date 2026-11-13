import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EntrantView, PublicEntrantView } from '../../shared/api.js';
import { isStarted } from '../../shared/rules.js';
import { advanceCleanup, runAdvance } from '../advance.js';
import { FormatObject } from '../art/Objects.js';
import { BracketView } from '../components/BracketView.js';
import { useCardDialogs } from '../components/CardDialogs.js';
import { Chrome } from '../components/Chrome.js';
import { useLayout } from '../layout.js';
import { useTournamentStore } from '../liveStore.js';
import { TraceController } from '../trace.js';
import { NotFound } from './NotFound.js';
import { Statuses } from './Bracket.js';

// The public page: a hero with the field and the trophy, then the read-only bracket and standings.
export function SharePage({ code }: { code: string }): ReactNode {
  const { store, snapshot } = useTournamentStore({ kind: 'share', code });
  const layout = useLayout();
  const [whole, setWhole] = useState(false);
  const controller = useMemo(() => new TraceController(), []);
  const cards = useCardDialogs({ store, snapshot, controller, say: () => undefined, feederOf: (_, reached) => reached[0] as string });
  const t = snapshot.tournament;

  useEffect(() => {
    const onReset = (ids: string[]): void => controller.playRemote(ids);
    store.onReset.add(onReset);
    store.onAdvance.add(runAdvance);
    return () => {
      store.onReset.delete(onReset);
      store.onAdvance.delete(runAdvance);
      controller.clear();
      advanceCleanup();
    };
  }, [store, controller]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'z' || event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select') || document.querySelector('dialog[open]')) return;
      setWhole((value) => !value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (snapshot.missing) return <NotFound text={snapshot.missing} />;
  if (!t) return <Chrome bare><p className="loading">Loading...</p></Chrome>;

  const entrants = snapshot.entrants as Array<EntrantView | PublicEntrantView>;
  return (
    <Chrome bare>
      <div className={`share layout-${layout}`}>
        <section className="share-hero">
          <div className="share-field">
            <h2 className="block-title">Field</h2>
            <ol aria-label="Field" className="plain-list field-list">
              {[...entrants].sort((a, b) => a.seed - b.seed).map((entrant) => <li key={entrant.name}>{entrant.name}</li>)}
            </ol>
          </div>
          <div className="share-trophy">
            <FormatObject format={t.format} fill={t.fill} label={`${t.name} trophy`} className="trophy" />
          </div>
          <div className="share-title">
            <div className="share-name">
              <h1 className="share-h1">{t.name}</h1>
              {t.logo_url ? <img className="share-logo" src={t.logo_url} alt={`${t.name} logo`} /> : null}
            </div>
            <p className="share-count">{`${t.entrant_count} entrants`}</p>
          </div>
        </section>
        <div className="share-controls">
          {isStarted(t.state) ? (
            <button type="button" className="btn" aria-pressed={whole} onClick={() => setWhole((v) => !v)}>Whole bracket</button>
          ) : null}
          <Statuses announcement={snapshot.announcement} />
        </div>
        {isStarted(t.state) ? (
          <BracketView tournament={t} matches={snapshot.matches} standings={snapshot.standings} layout={layout} whole={whole}
            controller={controller} onOpen={cards.open} />
        ) : null}
      </div>
      {cards.node}
    </Chrome>
  );
}
