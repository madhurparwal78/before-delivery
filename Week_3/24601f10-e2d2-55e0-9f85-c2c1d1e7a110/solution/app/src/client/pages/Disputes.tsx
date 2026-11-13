import { useState, type ReactNode } from 'react';
import type { MatchView } from '../../shared/api.js';
import { FormatObject } from '../art/Objects.js';
import { Chrome, EmptyState } from '../components/Chrome.js';
import { ResolveDialog, type DialogEnv } from '../components/ScoreDialogs.js';
import { useTournamentStore } from '../liveStore.js';
import { navigate } from '../router.js';
import { Statuses } from './Bracket.js';
import { NotFound } from './NotFound.js';

// Open disputes: organizers resolve them here and land on the bracket with the resolved card focused.
export function DisputesPage({ id }: { id: string }): ReactNode {
  const { store, snapshot } = useTournamentStore({ kind: 'user', id });
  const [action, setAction] = useState('');
  const [resolving, setResolving] = useState<MatchView | null>(null);
  const t = snapshot.tournament;
  if (snapshot.missing) return <NotFound text={snapshot.missing} />;
  if (!t) return <Chrome><p className="loading">Loading...</p></Chrome>;
  if (t.my_role !== 'organizer' && t.my_role !== 'co_organizer') return <NotFound text="You cannot change this tournament." />;

  const disputed = snapshot.matches.filter((m) => m.state === 'disputed');
  const env: DialogEnv = {
    store, viewer: { organizer: true, entrantId: null, entrantName: null }, say: setAction,
    finish: () => setResolving(null), close: () => setResolving(null),
  };
  return (
    <Chrome>
      <div className="stack">
        <h1 className="page-title">{t.name}</h1>
        <Statuses action={action} announcement={snapshot.announcement} />
        {disputed.length === 0 ? (
          <EmptyState object={<FormatObject format={t.format} fill={t.fill} label="Disputes object" />} text="No open disputes." />
        ) : (
          <ul aria-label="Open disputes" className="plain-list big-list">
            {disputed.map((match) => (
              <li key={match.id} className="row">
                <span className="big-link">{`${match.label}: ${match.report?.by ?? ''} and ${match.dispute?.by ?? ''} disagree`}</span>
                <button type="button" className="btn" onClick={() => setResolving(match)}>{`Resolve ${match.label}`}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {resolving ? (
        <ResolveDialog match={resolving} env={env} onResolved={(m) => navigate(`/t/${id}/bracket?match=${m.id}`)} />
      ) : null}
    </Chrome>
  );
}
