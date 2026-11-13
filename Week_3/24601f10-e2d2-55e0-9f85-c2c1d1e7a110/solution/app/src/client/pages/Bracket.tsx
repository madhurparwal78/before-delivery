import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CheckinResult, EntrantView, RoundResult, TournamentView } from '../../shared/api.js';
import { isOrganizerRole, isStarted } from '../../shared/rules.js';
import { api, failureOf } from '../api.js';
import { advanceCleanup, runAdvance } from '../advance.js';
import { buildRegions, pickFeeder } from '../bracketModel.js';
import { BracketView } from '../components/BracketView.js';
import { useCardDialogs } from '../components/CardDialogs.js';
import { Chrome } from '../components/Chrome.js';
import { Preview } from '../components/Preview.js';
import { ShareDialog } from '../components/ShareDialog.js';
import { timeInZone } from '../format.js';
import { useLayout } from '../layout.js';
import { type Snapshot, type TournamentStore, useTournamentStore } from '../liveStore.js';
import { clearError, pending, raise } from '../notices.js';
import { Link, navigate, useLocation } from '../router.js';
import { TraceController } from '../trace.js';
import { NotFound } from './NotFound.js';

export const STATE_LABELS: Record<TournamentView['state'], string> = {
  draft: 'Draft', checkin_open: 'Check-in open', checkin_closed: 'Check-in closed', running: 'Running', finished: 'Finished',
};

export function CheckinLines({ tournament }: { tournament: TournamentView }): ReactNode {
  const closes = tournament.checkin_closes_at;
  const open = tournament.state === 'checkin_open';
  const closed = tournament.state === 'checkin_closed';
  return (
    <>
      {open || closed ? (
        <p role="status" aria-label="Check-in count" className="rail-line">{`${tournament.checked_in_count} of ${tournament.entrant_count} checked in`}</p>
      ) : null}
      {closes && (open || closed) ? (
        <p className="rail-line">{`Check-in ${open ? 'closes' : 'closed'} at ${timeInZone(closes, tournament.time_zone)} (${tournament.time_zone})`}</p>
      ) : null}
    </>
  );
}

export function Statuses({ action, announcement }: { action?: string; announcement: string }): ReactNode {
  return (
    <div className="statuses">
      {action !== undefined ? <p role="status" aria-label="Your action" className="rail-line">{action}</p> : null}
      <p role="status" aria-label="Bracket announcements" className="rail-line">{announcement}</p>
    </div>
  );
}

// The field before the tournament starts; organizers tick players present while check-in is open.
function Field({ store, snapshot }: { store: TournamentStore; snapshot: Snapshot }): ReactNode {
  const t = snapshot.tournament as TournamentView;
  const organizer = isOrganizerRole(t.my_role);
  const entrants = snapshot.entrants as EntrantView[];
  const tick = async (entrant: EntrantView, checked: boolean): Promise<void> => {
    clearError();
    try {
      await api.put(`/api/entrants/${entrant.id}/checkin`, { checked_in: checked });
    } catch (error) {
      raise(failureOf(error).message);
    }
    void store.load();
  };
  return (
    <section className="panel-block" aria-label="Entrants">
      <h2 className="block-title">Field</h2>
      <ol className="plain-list field-list" aria-label="Field">
        {entrants.map((entrant) => (
          <li key={entrant.id}>
            <span className="field-name">{entrant.name}</span>
            {organizer && (t.state === 'checkin_open' || t.state === 'checkin_closed') ? (
              <label className="tick">
                <input type="checkbox" checked={entrant.checked_in} disabled={t.state !== 'checkin_open'} aria-label={`Checked in: ${entrant.name}`}
                  onChange={(event) => void tick(entrant, event.target.checked)} />
                <span aria-hidden="true">Here</span>
              </label>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BracketPage({ id }: { id: string }): ReactNode {
  const { store, snapshot } = useTournamentStore({ kind: 'user', id });
  const layout = useLayout();
  const { query } = useLocation();
  const [whole, setWhole] = useState(false);
  const [action, setAction] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareLink, setShareLink] = useState('');
  const controller = useMemo(() => new TraceController(), []);
  const t = snapshot.tournament;
  const regions = useMemo(() => (t ? buildRegions(t.format, snapshot.matches) : []), [t, snapshot.matches]);
  const cards = useCardDialogs({ store, snapshot, controller, say: setAction,
    feederOf: (dependent, reached) => pickFeeder(regions, t?.format ?? 'single_elimination', dependent.match_id, reached) });

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

  // Z toggles the whole bracket, except while typing or while a dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'z' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('dialog[open]')) return;
      setWhole((value) => !value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const focusTarget = query.get('match');
  const matchCount = snapshot.matches.length;
  useEffect(() => {
    if (!focusTarget || !matchCount) return;
    const card = document.querySelector<HTMLElement>(`[data-match-id="${focusTarget}"]`);
    card?.focus();
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focusTarget, matchCount]);

  if (snapshot.missing) return <NotFound text={snapshot.missing} />;
  if (!t) return <Chrome><p className="loading">Loading...</p></Chrome>;

  const organizer = isOrganizerRole(t.my_role);
  const started = isStarted(t.state);
  const myEntrant = snapshot.me ? (snapshot.entrants as EntrantView[]).find((e) => e.id === snapshot.me?.entrant.id) : undefined;
  const checkedIn = myEntrant?.checked_in ?? snapshot.me?.checked_in ?? false;

  const checkIn = async (): Promise<void> => {
    clearError();
    pending();
    try {
      await api.post<CheckinResult>(`/api/tournaments/${id}/checkin`);
      navigate(`/t/${id}/me`);
    } catch (error) {
      raise(failureOf(error).message);
    }
  };

  const nextRound = async (): Promise<void> => {
    clearError();
    try {
      await api.post<RoundResult>(`/api/tournaments/${id}/rounds`);
    } catch (error) {
      raise(failureOf(error).message);
    }
  };

  return (
    <Chrome>
      <div className={`bracket-page layout-${layout}`}>
        <aside className="rail">
          <div className="rail-head">
            <h1 className="rail-name">{t.name}</h1>
            {t.logo_url ? <img className="rail-logo" src={t.logo_url} alt={`${t.name} logo`} /> : null}
            <p className="rail-state">{STATE_LABELS[t.state]}</p>
          </div>
          <CheckinLines tournament={t} />
          <div className="rail-actions">
            {started ? (
              <button type="button" className="btn" aria-pressed={whole} onClick={() => setWhole((v) => !v)}>Whole bracket</button>
            ) : null}
            {t.my_role === 'player' && t.state === 'checkin_open' && !checkedIn ? (
              <button type="button" className="btn" onClick={() => void checkIn()}>Check in</button>
            ) : null}
            {organizer && t.format === 'swiss' && t.state === 'running' ? (
              <button type="button" className="btn" onClick={() => void nextRound()}>Start next round</button>
            ) : null}
            {organizer && t.share_url ? (
              <button type="button" className="btn" onClick={() => { setShareLink(t.share_url as string); setSharing(true); }}>Share</button>
            ) : null}
            {organizer && !started ? <Link to={`/t/${id}/setup`} className="btn btn-quiet">Setup</Link> : null}
            {organizer && started ? <Link to={`/t/${id}/disputes`} className="btn btn-quiet">Disputes</Link> : null}
            {t.my_role === 'player' && snapshot.me && started ? <Link to={`/t/${id}/me`} className="btn btn-quiet">My match</Link> : null}
          </div>
          <Statuses action={action} announcement={snapshot.announcement} />
        </aside>
        <section className="bracket-body">
          {started ? (
            <BracketView tournament={t} matches={snapshot.matches} standings={snapshot.standings} layout={layout} whole={whole}
              controller={controller} onOpen={cards.open} />
          ) : (
            <div className="prestart">
              <Field store={store} snapshot={snapshot} />
              <Preview tournamentId={id} stamp={`${t.seeding_version}:${t.entrant_count}`} />
            </div>
          )}
        </section>
      </div>
      {cards.node}
      {sharing ? <ShareDialog tournamentId={id} link={shareLink} onLink={setShareLink} onClose={() => setSharing(false)} /> : null}
    </Chrome>
  );
}
