import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EntrantView, LogoResult, RosterResult, StartResult, TournamentView } from '../../shared/api.js';
import { api, failureOf } from '../api.js';
import { FormatObject } from '../art/Objects.js';
import { Chrome, EmptyState } from '../components/Chrome.js';
import { Dialog } from '../components/Dialog.js';
import { Field } from '../components/Field.js';
import { Preview } from '../components/Preview.js';
import { SeedingList } from '../components/SeedingList.js';
import { ShareDialog } from '../components/ShareDialog.js';
import { UploadDialog } from '../components/UploadDialog.js';
import { FORMAT_OBJECT_NAMES, zonedTextToIso } from '../format.js';
import { useTournamentStore, type TournamentStore } from '../liveStore.js';
import { clearError, notify, pending, raise } from '../notices.js';
import { navigate } from '../router.js';
import { CheckinLines, Statuses, STATE_LABELS } from './Bracket.js';
import { NotFound } from './NotFound.js';

const CLOSE_FORMAT_ERROR = 'Enter the time as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.';

function OpenCheckinDialog({ tournament, onClose, onOpened }: { tournament: TournamentView; onClose: () => void; onOpened: () => void }): ReactNode {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    let body: { closes_at?: string } = {};
    if (text.trim() !== '') {
      const iso = zonedTextToIso(text, tournament.time_zone);
      if (!iso) {
        setError(CLOSE_FORMAT_ERROR);
        return;
      }
      body = { closes_at: iso };
    }
    setBusy(true);
    setStatus('Saving...');
    try {
      await api.post(`/api/tournaments/${tournament.id}/checkin/open`, body);
      onOpened();
    } catch (failed) {
      const failure = failureOf(failed);
      const field = failure.body.fields?.['closes_at'];
      setError(field ?? '');
      setStatus(field ? '' : failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog label="Open check-in" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <Field label="Check-in closes" error={error}>
          {(props) => <input {...props} type="text" value={text} data-autofocus="" placeholder="YYYY-MM-DD HH:MM" autoComplete="off"
            onChange={(event) => setText(event.target.value)} />}
        </Field>
        <p role="status" aria-label="Dialog status" className="dialog-status">{status}</p>
        <div className="dialog-actions">
          <button type="submit" className="btn" disabled={busy}>Start check-in</button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Dialog>
  );
}

function AddEntrant({ store, tournamentId }: { store: TournamentStore; tournamentId: string }): ReactNode {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    clearError();
    setError('');
    try {
      await api.post(`/api/tournaments/${tournamentId}/entrants`, { name });
      setName('');
      await store.load();
    } catch (failed) {
      const failure = failureOf(failed);
      setError(failure.body.fields?.['name'] ?? '');
      if (!failure.body.fields) raise(failure.message);
    }
  };
  return (
    <form className="inline-form" onSubmit={(event) => void submit(event)}>
      <Field label="Entrant name" error={error}>
        {(props) => <input {...props} type="text" value={name} onChange={(event) => setName(event.target.value)} />}
      </Field>
      <button type="submit" className="btn">Add entrant</button>
    </form>
  );
}

function CoOrganizers({ store, tournament }: { store: TournamentStore; tournament: TournamentView }): ReactNode {
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError('');
    try {
      await api.post(`/api/tournaments/${tournament.id}/co-organizers`, { username });
      setUsername('');
      await store.load();
    } catch (failed) {
      const failure = failureOf(failed);
      setError(failure.body.fields?.['username'] ?? failure.message);
    }
  };
  const remove = async (name: string): Promise<void> => {
    try {
      await api.del(`/api/tournaments/${tournament.id}/co-organizers/${name}`);
      await store.load();
    } catch (failed) {
      raise(failureOf(failed).message);
    }
  };
  return (
    <section className="panel-block">
      <h2 className="block-title">Co-organizers</h2>
      <form className="inline-form" onSubmit={(event) => void add(event)}>
        <Field label="Co-organizer username" error={error}>
          {(props) => <input {...props} type="text" value={username} autoCapitalize="none" spellCheck={false}
            onChange={(event) => setUsername(event.target.value)} />}
        </Field>
        <button type="submit" className="btn">Add co-organizer</button>
      </form>
      <ul aria-label="Co-organizers" className="plain-list">
        {(tournament.co_organizers ?? []).map((name) => (
          <li key={name} className="row">
            <span>{`@${name}`}</span>
            <button type="button" className="btn btn-quiet" onClick={() => void remove(name)}>{`Remove ${name}`}</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Modal = 'roster' | 'logo' | 'checkin' | 'share' | null;

export function SetupPage({ id }: { id: string }): ReactNode {
  const { store, snapshot } = useTournamentStore({ kind: 'user', id });
  const [modal, setModal] = useState<Modal>(null);
  const [action, setAction] = useState('');
  const [rosterErrors, setRosterErrors] = useState<{ message: string; errors: string[] } | null>(null);
  const [shareLink, setShareLink] = useState('');
  const t = snapshot.tournament;
  const entrants = snapshot.entrants as EntrantView[];

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (rosterErrors) heading.current?.focus();
  }, [rosterErrors]);

  useEffect(() => {
    if (t && t.my_role !== 'organizer' && t.my_role !== 'co_organizer') navigate(`/t/${id}/bracket`, true);
  }, [t, id]);

  const stamp = useMemo(() => `${t?.seeding_version}:${t?.entrant_count}:${entrants.map((e) => `${e.id}${e.seed}`).join()}`, [t, entrants]);

  if (snapshot.missing) return <NotFound text={snapshot.missing} />;
  if (!t || (t.my_role !== 'organizer' && t.my_role !== 'co_organizer')) return <Chrome><p className="loading">Loading...</p></Chrome>;

  const organizer = t.my_role === 'organizer';
  const run = async (request: () => Promise<unknown>): Promise<boolean> => {
    clearError();
    pending();
    try {
      await request();
      notify('');
      await store.load();
      return true;
    } catch (failed) {
      notify('');
      raise(failureOf(failed).message);
      return false;
    }
  };

  const start = async (): Promise<void> => {
    clearError();
    pending();
    try {
      const result = await api.post<StartResult>(`/api/tournaments/${id}/start`);
      const names = result.removed;
      notify(names.length ? (names.length === 1 ? `Removed 1 no-show: ${names[0]}.` : `Removed ${names.length} no-shows: ${names.join(', ')}.`) : '');
      navigate(`/t/${id}/bracket`);
    } catch (failed) {
      notify('');
      raise(failureOf(failed).message);
    }
  };

  const deleteIt = async (): Promise<void> => {
    if (await run(() => api.del(`/api/tournaments/${id}`))) navigate('/t');
  };

  const tick = async (entrant: EntrantView, checked: boolean): Promise<void> => {
    clearError();
    try {
      await api.put(`/api/entrants/${entrant.id}/checkin`, { checked_in: checked });
    } catch (failed) {
      raise(failureOf(failed).message);
    }
    void store.load();
  };

  const preStart = t.state === 'draft' || t.state === 'checkin_open' || t.state === 'checkin_closed';
  const objectArt = <FormatObject format={t.format} fill={t.fill} label={FORMAT_OBJECT_NAMES[t.format]} />;

  return (
    <Chrome>
      <div className="setup">
        <header className="setup-head">
          <h1 className="page-title">{t.name}</h1>
          {t.logo_url ? <img className="setup-logo" src={t.logo_url} alt={`${t.name} logo`} /> : null}
          <p className="rail-state">{STATE_LABELS[t.state]}</p>
          <div className="setup-actions">
            <button type="button" className="btn" onClick={() => { setShareLink(t.share_url ?? ''); setModal('share'); }}>Share</button>
          </div>
          <Statuses action={action} announcement={snapshot.announcement} />
        </header>
        <div className="setup-columns">
          <div className="setup-left">
            <section className="panel-block" aria-label="Field and seeding">
              <h2 className="block-title">Seeding</h2>
              {entrants.length === 0 ? (
                <EmptyState object={<div className="mini-object">{objectArt}</div>} text="No entrants yet. Upload a roster or add names one by one." />
              ) : <SeedingList store={store} tournament={t} entrants={entrants} say={setAction} />}
              {preStart ? <AddEntrant store={store} tournamentId={id} /> : null}
            </section>
          </div>
          <div className="setup-right">
            <Preview tournamentId={id} stamp={stamp} />
            <section className="panel-block">
              <h2 className="block-title">Roster</h2>
              <div className="row-actions">
                <button type="button" className="btn" onClick={() => setModal('roster')}>Upload roster</button>
                {t.roster_file_name ? (
                  <button type="button" className="btn btn-quiet" onClick={() => void downloadRoster(t)}>Download roster file</button>
                ) : null}
              </div>
              {rosterErrors ? (
                <div>
                  <h2 className="roster-heading" tabIndex={-1} ref={heading}>{rosterErrors.message}</h2>
                  <ul aria-label="Roster errors" className="plain-list">
                    {rosterErrors.errors.map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              ) : null}
            </section>
            <section className="panel-block">
              <h2 className="block-title">Logo</h2>
              <div className="row-actions">
                <button type="button" className="btn" onClick={() => setModal('logo')}>Upload logo</button>
              </div>
            </section>
            {organizer ? <CoOrganizers store={store} tournament={t} /> : null}
            <section className="panel-block">
              <h2 className="block-title">Check-in</h2>
              <CheckinLines tournament={t} />
              <div className="row-actions">
                {t.state === 'draft' ? <button type="button" className="btn" onClick={() => setModal('checkin')}>Open check-in</button> : null}
                {t.state === 'checkin_open' ? (
                  <button type="button" className="btn" onClick={() => void run(() => api.post(`/api/tournaments/${id}/checkin/close`))}>Close check-in</button>
                ) : null}
                {t.state === 'checkin_open' || t.state === 'checkin_closed' ? (
                  <button type="button" className="btn btn-quiet" onClick={() => void run(() => api.post(`/api/tournaments/${id}/draft`))}>Back to draft</button>
                ) : null}
              </div>
              {t.state === 'checkin_open' || t.state === 'checkin_closed' ? (
                <ul className="plain-list tick-list" aria-label="Check-in">
                  {entrants.map((entrant) => (
                    <li key={entrant.id} className="row">
                      <span>{entrant.name}</span>
                      <label className="tick">
                        <input type="checkbox" checked={entrant.checked_in} disabled={t.state !== 'checkin_open'}
                          aria-label={`Checked in: ${entrant.name}`} onChange={(event) => void tick(entrant, event.target.checked)} />
                        <span aria-hidden="true">Here</span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
            <div className="row-actions finish-actions">
              {t.state === 'draft' || t.state === 'checkin_closed' ? <button type="button" className="btn" onClick={() => void start()}>Start tournament</button> : null}
              {organizer && preStart ? <button type="button" className="btn btn-quiet" onClick={() => void deleteIt()}>Delete tournament</button> : null}
            </div>
          </div>
        </div>
      </div>
      {modal === 'roster' ? (
        <UploadDialog title="Upload roster" fileLabel="Roster file" submitLabel="Add roster" onClose={() => setModal(null)}
          send={async (file) => {
            const result = await api.upload<RosterResult>(`/api/tournaments/${id}/roster`, file);
            setRosterErrors(null);
            notify(`Added ${result.entrants.length} entrants from ${result.file_name}.`);
          }}
          onRefused={(body) => {
            if (body.error !== 'roster_invalid') return false;
            setRosterErrors({ message: body.message, errors: body.errors ?? [] });
            setModal(null);
            return true;
          }}
          onDone={() => { setModal(null); void store.load(); }} />
      ) : null}
      {modal === 'logo' ? (
        <UploadDialog title="Upload logo" fileLabel="Logo image" submitLabel="Add logo" accept="image/png,image/jpeg" onClose={() => setModal(null)}
          send={async (file) => { await api.upload<LogoResult>(`/api/tournaments/${id}/logo`, file); notify('Logo updated.'); }}
          onDone={() => { setModal(null); void store.load(); }} />
      ) : null}
      {modal === 'checkin' ? (
        <OpenCheckinDialog tournament={t} onClose={() => setModal(null)} onOpened={() => { setModal(null); void store.load(); }} />
      ) : null}
      {modal === 'share' ? <ShareDialog tournamentId={id} link={shareLink} onLink={setShareLink} onClose={() => setModal(null)} /> : null}
    </Chrome>
  );
}

async function downloadRoster(t: TournamentView): Promise<void> {
  try {
    const blob = await api.download(`/api/tournaments/${t.id}/roster`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = t.roster_file_name ?? 'roster.cupfold.txt';
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (failed) {
    raise(failureOf(failed).message);
  }
}
