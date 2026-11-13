import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { isStarted } from '../../shared/rules.js';
import { advanceCleanup, runAdvance } from '../advance.js';
import { buildRegions, pickFeeder } from '../bracketModel.js';
import { useCardDialogs } from '../components/CardDialogs.js';
import { Chrome } from '../components/Chrome.js';
import { MatchCard } from '../components/MatchCard.js';
import { useTournamentStore } from '../liveStore.js';
import { TraceController } from '../trace.js';
import { Statuses } from './Bracket.js';
import { NotFound } from './NotFound.js';

// The linked player's page: their next match at full width, following it live.
export function MePage({ id }: { id: string }): ReactNode {
  const { store, snapshot } = useTournamentStore({ kind: 'user', id });
  const [action, setAction] = useState('');
  const controller = useMemo(() => new TraceController(), []);
  const t = snapshot.tournament;
  const regions = useMemo(() => (t ? buildRegions(t.format, snapshot.matches) : []), [t, snapshot.matches]);
  const cards = useCardDialogs({ store, snapshot, controller, say: setAction,
    feederOf: (dependent, reached) => pickFeeder(regions, t?.format ?? 'single_elimination', dependent.match_id, reached) });

  useEffect(() => {
    store.onAdvance.add(runAdvance);
    return () => {
      store.onAdvance.delete(runAdvance);
      advanceCleanup();
    };
  }, [store]);

  if (snapshot.missing) return <NotFound text={snapshot.missing} />;
  if (!t || !snapshot.loaded) return <Chrome><p className="loading">Loading...</p></Chrome>;

  const next = snapshot.me?.next_match ?? null;
  const live = next ? snapshot.matches.find((m) => m.id === next.id) ?? next : null;
  const started = isStarted(t.state);
  const sentence = !started ? (snapshot.me?.checked_in
    ? "You're checked in. Your first match appears here when the tournament starts." : 'You are not checked in.')
    : 'No more matches for you in this tournament.';

  return (
    <Chrome>
      <div className="me-page">
        <h1 className="page-title">{t.name}</h1>
        <Statuses action={action} announcement={snapshot.announcement} />
        <section aria-label="Next match" className="next-match">
          {live ? (
            <MatchCard match={live} tabIndex={0} willReset={false} onOpen={cards.open} onKeyNav={() => undefined} onFocused={() => undefined} />
          ) : <p className="next-sentence">{sentence}</p>}
        </section>
      </div>
      {cards.node}
    </Chrome>
  );
}
