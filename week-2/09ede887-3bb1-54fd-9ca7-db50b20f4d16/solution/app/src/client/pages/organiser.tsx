import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { OrganiserRow, Reveal, RosterRow, Speaker } from '../../shared/api';
import { apiPath, download, request } from '../api';
import { belowReservedCopy, FIELD_COPY, FORBIDDEN_COPY, OUTAGE_COPY, refusalCopy } from '../copy';
import { loadSpeakers } from '../data';
import { timeRange, venueCutoff } from '../format';
import { useFocusAfterRender, useLiveRefresh, useTitle } from '../hooks';
import { signInPath, useRouter } from '../router';
import { useApp } from '../state';
import { Loading } from '../components/chrome';
import { useDialogFocus } from '../components/dialog';
import { AreaField, codePoints, ErrorSummary, Field, wholeNumber, type FieldErrors } from '../components/forms';

interface Roster {
  id: string;
  title: string;
  rows: RosterRow[];
  next: string | null;
}

const GUESS_MAX = 100_000_000;

function DiscardDialog({ name, onKeep, onDiscard, bio }: { name: string; onKeep: () => void; onDiscard: () => void; bio: () => HTMLElement | null }) {
  const dialog = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialog, keep, onKeep, bio);
  return (
    <div className="dialog-layer">
      <div className="dialog-backdrop" />
      <div ref={dialog} className="dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-copy">
        <h2 id="discard-title">Discard unsaved bio?</h2>
        <p id="discard-copy">Your changes to {name}'s bio are not saved.</p>
        <div className="dialog-actions">
          <button ref={keep} type="button" className="btn btn-primary" onClick={onKeep}>
            Keep editing
          </button>
          <button type="button" className="btn btn-outline" onClick={onDiscard}>
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionsTable({ rows, onView }: { rows: OrganiserRow[]; onView: (row: OrganiserRow) => void }) {
  return (
    <table className="data-table organiser-table" aria-label="Reservable sessions">
      <thead>
        <tr>
          {['Title', 'Day', 'Time', 'Capacity', 'Reserved', 'Held', 'Seats left', 'Waitlisted'].map((heading) => (
            <th key={heading} scope="col">
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <td data-label="Title">
              <span className="cell-title">{row.title}</span>
              <button type="button" className="btn btn-outline btn-small" aria-label={`View roster for ${row.title}`} onClick={() => onView(row)}>
                View roster
              </button>
            </td>
            <td data-label="Day">{row.day}</td>
            <td data-label="Time">{timeRange(row.start_local, row.end_local)}</td>
            <td data-label="Capacity">{row.seats.capacity}</td>
            <td data-label="Reserved">{row.seats.reserved}</td>
            <td data-label="Held">{row.seats.held}</td>
            <td data-label="Seats left">{row.seats.left}</td>
            <td data-label="Waitlisted">{row.waitlisted}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OrganiserPage() {
  useTitle('Organiser');
  const { auth, viewer, dropAuth } = useApp();
  const { place, navigate, setGuard } = useRouter();
  const token = auth?.token ?? null;
  const focusLater = useFocusAfterRender();
  const [rows, setRows] = useState<OrganiserRow[] | null>(null);
  const [outage, setOutage] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const [roster, setRoster] = useState<Roster | null>(null);
  const [capacity, setCapacity] = useState('');
  const [capacityErrors, setCapacityErrors] = useState<FieldErrors>({});
  const [capacityAttempt, setCapacityAttempt] = useState(0);

  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [speakerName, setSpeakerName] = useState('');
  const [proposed, setProposed] = useState<string | null>(null);
  const [stored, setStored] = useState('');
  const [draft, setDraft] = useState('');
  const [preview, setPreview] = useState('');
  const [bioErrors, setBioErrors] = useState<FieldErrors>({});
  const [bioAttempt, setBioAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const proceed = useRef<(() => void) | null>(null);
  const bioBox = useRef<HTMLTextAreaElement>(null);

  const [figure, setFigure] = useState('');
  const [figureErrors, setFigureErrors] = useState<FieldErrors>({});
  const [figureAttempt, setFigureAttempt] = useState(0);

  useEffect(() => {
    if (!auth) navigate(signInPath(place), { replace: true });
  }, [auth, navigate, place]);

  const isOrganiser = viewer === 'organiser';

  const fetchRows = useCallback(async () => {
    if (!token || !isOrganiser) return;
    const result = await request<OrganiserRow[]>(apiPath('/organiser/sessions'), { token });
    if (result.ok) {
      setRows(result.data);
      setOutage(false);
    } else if (result.error.code === 'unavailable') setOutage(true);
  }, [token, isOrganiser]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);
  useLiveRefresh(() => void fetchRows(), isOrganiser);

  const choose = useCallback((list: Speaker[], name: string) => {
    const speaker = list.find((s) => s.name === name);
    setSpeakerName(name);
    setProposed(null);
    setStored(speaker?.bio ?? '');
    setDraft(speaker?.bio ?? '');
    setPreview(speaker?.bio_html ?? '');
    setBioErrors({});
  }, []);

  useEffect(() => {
    if (!isOrganiser) return;
    void loadSpeakers().then((list) => {
      if (!list) return;
      setSpeakers(list);
      const first = list[0];
      if (first) choose(list, first.name);
    });
  }, [isOrganiser, choose]);

  // Unsaved bio changes ask first: another speaker, any in-site link, Back, reload or close.
  const dirty = speakerName !== '' && draft !== stored;
  const ask = useCallback((next: () => void) => {
    proceed.current = next;
    setAsking(true);
  }, []);
  useEffect(() => {
    setGuard(dirty ? ask : null);
    return () => setGuard(null);
  }, [dirty, ask, setGuard]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const keepEditing = useCallback(() => {
    proceed.current = null;
    setAsking(false);
    setProposed(null);
  }, []);
  const discard = () => {
    const next = proceed.current;
    proceed.current = null;
    setAsking(false);
    setGuard(null);
    setStored(draft);
    next?.();
  };
  const findBio = useCallback(() => bioBox.current, []);

  const answerError = (code: string) => {
    if (code === 'unauthenticated') dropAuth();
    setMessage(code === 'unavailable' ? OUTAGE_COPY : refusalCopy(code));
  };

  const openRoster = async (row: OrganiserRow) => {
    if (!token) return;
    const result = await request<RosterRow[]>(apiPath(`/organiser/sessions/${encodeURIComponent(row.id)}/roster`), { token });
    if (!result.ok) {
      answerError(result.error.code);
      return;
    }
    setRoster({ id: row.id, title: row.title, rows: result.data, next: result.next });
    setCapacity(String(row.seats.capacity));
    setCapacityErrors({});
    focusLater(() => document.getElementById('roster-heading'));
  };

  const showMore = async () => {
    if (!token || !roster?.next || busy) return;
    setBusy('more');
    setMessage('Loading more reserved attendees…');
    const result = await request<RosterRow[]>(roster.next, { token });
    setBusy(null);
    if (!result.ok) {
      answerError(result.error.code);
      return;
    }
    const added = result.data.length;
    const firstAdded = roster.rows.length;
    setRoster({ ...roster, rows: [...roster.rows, ...result.data], next: result.next });
    setMessage(added === 1 ? '1 more reserved attendee shown.' : `${added} more reserved attendees shown.`);
    if (!result.next) focusLater(() => document.querySelector<HTMLElement>(`[data-roster-row="${firstAdded}"]`));
  };

  const downloadRoster = async () => {
    if (!token || !roster || busy) return;
    setBusy('download');
    setMessage('Preparing roster…');
    const result = await download(apiPath(`/organiser/sessions/${encodeURIComponent(roster.id)}/roster.csv`), token);
    setBusy(null);
    if (!result.ok) {
      answerError(result.error.code);
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage('Roster downloaded.');
  };

  const saveCapacity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || !roster || busy) return;
    const value = wholeNumber(capacity);
    if (value === null || value < 1 || value > 500) {
      setCapacityErrors({ capacity: FIELD_COPY.capacity });
      setCapacityAttempt((count) => count + 1);
      return;
    }
    setCapacityErrors({});
    setBusy('capacity');
    setMessage('Saving capacity…');
    const result = await request<OrganiserRow>(apiPath(`/organiser/sessions/${encodeURIComponent(roster.id)}`), {
      method: 'PATCH',
      token,
      body: { capacity: value },
    });
    setBusy(null);
    if (result.ok) {
      setMessage('Capacity saved.');
      setRows((current) => current?.map((row) => (row.id === result.data.id ? result.data : row)) ?? null);
      void fetchRows();
    } else if (result.error.code === 'below_reserved') {
      setMessage(belowReservedCopy(result.error.reserved ?? 0));
    } else if (result.error.code === 'invalid') {
      setMessage('');
      setCapacityErrors({ capacity: FIELD_COPY.capacity });
      setCapacityAttempt((count) => count + 1);
    } else answerError(result.error.code);
  };

  const saveBio = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const speaker = speakers.find((s) => s.name === speakerName);
    if (!token || !speaker || busy) return;
    if (codePoints(draft) > 2000) {
      setBioErrors({ bio: FIELD_COPY.bio });
      setBioAttempt((count) => count + 1);
      return;
    }
    setBioErrors({});
    setBusy('bio');
    setMessage('Saving bio…');
    const result = await request<Speaker>(apiPath(`/organiser/speakers/${encodeURIComponent(speaker.slug)}/bio`), {
      method: 'PUT',
      token,
      body: { bio: draft },
    });
    setBusy(null);
    if (result.ok) {
      setStored(result.data.bio);
      setPreview(result.data.bio_html);
      setSpeakers((list) => list.map((s) => (s.slug === result.data.slug ? result.data : s)));
      setMessage('Bio saved.');
    } else if (result.error.code === 'invalid') {
      setMessage('');
      setBioErrors({ bio: FIELD_COPY.bio });
      setBioAttempt((count) => count + 1);
    } else answerError(result.error.code);
  };

  const reveal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy) return;
    const value = wholeNumber(figure);
    if (value === null || value < 1 || value > GUESS_MAX) {
      setFigureErrors({ final_figure: FIELD_COPY.wholeGuess });
      setFigureAttempt((count) => count + 1);
      return;
    }
    setFigureErrors({});
    setBusy('reveal');
    setMessage('Revealing…');
    const result = await request<Reveal>(apiPath('/organiser/record/reveal'), { method: 'POST', token, body: { final_figure: value } });
    setBusy(null);
    if (result.ok) setMessage('Result revealed.');
    else answerError(result.error.code);
  };

  if (!auth) return <section className="page"><Loading /></section>;
  if (!isOrganiser) {
    return (
      <section className="page page-narrow">
        <h1 className="page-title">Organiser</h1>
        <p className="helper">{FORBIDDEN_COPY}</p>
      </section>
    );
  }

  return (
    <section className="page organiser-page">
      <header className="page-head">
        <h1 className="page-title">Organiser</h1>
        <p className="helper">Open a roster to page through it, download it for the door or change the room's capacity.</p>
      </header>
      <p className="organiser-messages" role="status" aria-label="Organiser messages">
        {message}
      </p>

      {!rows && (outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />)}
      {rows && (
        <div className="table-scroll">
          <SessionsTable rows={rows} onView={(row) => void openRoster(row)} />
        </div>
      )}

      {roster && (
        <section key={roster.id} className="panel roster-panel" aria-labelledby="roster-heading">
          <h2 id="roster-heading" className="panel-title" tabIndex={-1}>
            Roster for {roster.title}
          </h2>
          {roster.rows.length === 0 ? (
            <p className="helper">No seats reserved yet.</p>
          ) : (
            <table className="data-table roster-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Reserved at</th>
                </tr>
              </thead>
              <tbody>
                {roster.rows.map((row, index) => (
                  <tr key={`${row.email}-${index}`} data-roster-row={index} tabIndex={-1}>
                    <td data-label="Name">{row.name}</td>
                    <td data-label="Email">{row.email}</td>
                    <td data-label="Reserved at">{venueCutoff(row.reserved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="panel-actions">
            {roster.next && (
              <button type="button" className="btn btn-outline" aria-disabled={busy === 'more' ? 'true' : undefined} onClick={() => void showMore()}>
                Show more reserved attendees
              </button>
            )}
            <button
              type="button"
              className="btn btn-dark"
              aria-label={`Download roster for ${roster.title}`}
              aria-disabled={busy === 'download' ? 'true' : undefined}
              onClick={() => void downloadRoster()}
            >
              Download roster
            </button>
          </div>
          <form className="form form-inline" noValidate onSubmit={(event) => void saveCapacity(event)}>
            <ErrorSummary errors={capacityErrors} ids={{ capacity: 'roster-capacity' }} attempt={capacityAttempt} />
            <Field
              id="roster-capacity"
              label="Capacity"
              type="text"
              inputMode="numeric"
              value={capacity}
              error={capacityErrors.capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" aria-disabled={busy === 'capacity' ? 'true' : undefined}>
              Save capacity
            </button>
          </form>
        </section>
      )}

      <section className="panel bio-panel" aria-labelledby="bios-heading">
        <h2 id="bios-heading" className="panel-title">
          Speaker bios
        </h2>
        <p className="helper">Bios accept *emphasis*, **strong**, `code`, [links](https://…) and line breaks.</p>
        <div className="bio-grid">
          <form className="form" noValidate onSubmit={(event) => void saveBio(event)}>
            <ErrorSummary errors={bioErrors} ids={{ bio: 'bio-text' }} attempt={bioAttempt} />
            <div className="field">
              <label htmlFor="bio-speaker">Speaker</label>
              <span className="select-box">
                <select
                  id="bio-speaker"
                  value={proposed ?? speakerName}
                  onChange={(event) => {
                    const name = event.target.value;
                    if (dirty) {
                      setProposed(name);
                      ask(() => choose(speakers, name));
                    } else choose(speakers, name);
                  }}
                >
                  {speakers.map((speaker) => (
                    <option key={speaker.slug} value={speaker.name}>
                      {speaker.name}
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <AreaField
              ref={bioBox}
              id="bio-text"
              label="Bio"
              rows={7}
              value={draft}
              error={bioErrors.bio}
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" aria-disabled={busy === 'bio' ? 'true' : undefined}>
              Save bio
            </button>
          </form>
          <section className="bio-preview" aria-labelledby="preview-heading">
            <h3 id="preview-heading">Bio preview</h3>
            {preview ? <p className="bio" dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="helper">This speaker has no bio yet.</p>}
          </section>
        </div>
      </section>

      <section className="panel contest-panel" aria-labelledby="contest-heading">
        <h2 id="contest-heading" className="panel-title">
          Call the number result
        </h2>
        <p className="helper">The result can be revealed once, while guessing is open or after it closes.</p>
        <form className="form form-inline" noValidate onSubmit={(event) => void reveal(event)}>
          <ErrorSummary errors={figureErrors} ids={{ final_figure: 'final-figure' }} attempt={figureAttempt} />
          <Field
            id="final-figure"
            label="Final figure"
            type="text"
            inputMode="numeric"
            value={figure}
            error={figureErrors.final_figure}
            onChange={(event) => setFigure(event.target.value)}
          />
          <button type="submit" className="btn btn-primary" aria-disabled={busy === 'reveal' ? 'true' : undefined}>
            Reveal result
          </button>
        </form>
      </section>

      {asking && <DiscardDialog name={speakerName} onKeep={keepEditing} onDiscard={discard} bio={findBio} />}
    </section>
  );
}
