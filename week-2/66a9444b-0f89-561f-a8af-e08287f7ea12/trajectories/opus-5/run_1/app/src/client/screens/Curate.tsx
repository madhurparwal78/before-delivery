import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '../components/Dialog.js';
import { ApiError, request } from '../lib/api.js';
import { formatSessionWhen } from '../lib/festival.js';
import { useUser } from '../lib/store.js';
import type { Entry, Named, ProgrammeState, Session } from '../lib/types.js';
import type { JSX } from 'react';

const COLUMNS: Array<{ state: ProgrammeState; label: string }> = [
  { state: 'draft', label: 'Draft' },
  { state: 'review', label: 'Review' },
  { state: 'scheduled', label: 'Scheduled' },
  { state: 'published', label: 'Published' },
  { state: 'cancelled', label: 'Cancelled' },
];

type Tab = 'sessions' | 'entries';

export function CurateScreen(): JSX.Element {
  const { user, loading } = useUser();
  const [tab, setTab] = useState<Tab>('sessions');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [venues, setVenues] = useState<Named[]>([]);
  const [disciplines, setDisciplines] = useState<Named[]>([]);
  const [status, setStatus] = useState('');
  const [scheduling, setScheduling] = useState<{ kind: Tab; id: string; title: string } | null>(null);
  const [cancelling, setCancelling] = useState<Session | null>(null);
  const [creating, setCreating] = useState(false);
  const opener = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const [sessionBody, entryBody, programme] = await Promise.all([
      request<{ sessions: Session[] }>('/api/curate/sessions'),
      request<{ entries: Entry[] }>('/api/entries'),
      request<{ venues: Named[]; disciplines: Named[] }>('/api/programme'),
    ]);
    setSessions(sessionBody.sessions);
    setEntries(entryBody.entries);
    setVenues(programme.venues);
    setDisciplines(programme.disciplines);
  }, []);

  useEffect(() => {
    if (user === null || user.role !== 'curator') return;
    void load();
  }, [user, load, tab]);

  if (loading) return <section className="wide ground-paper">Loading…</section>;
  if (user === null || user.role !== 'curator') {
    return (
      <section className="narrow ground-paper">
        <h1 className="display">Curate</h1>
        <p>Only curators can use this board.</p>
      </section>
    );
  }

  const move = async (
    kind: Tab,
    id: string,
    title: string,
    to: ProgrammeState,
    publishAt?: string,
  ): Promise<void> => {
    const path = kind === 'sessions' ? `/api/sessions/${id}/transitions` : `/api/entries/${id}/transitions`;
    try {
      const body = await request<{ refunds_started?: number }>(path, {
        method: 'POST',
        body: { to, note: null, publish_at: publishAt ?? null },
      });
      if (to === 'cancelled' && (body.refunds_started ?? 0) > 0) {
        setStatus(`${title} cancelled. Refunds started for ${body.refunds_started ?? 0} orders.`);
      } else {
        setStatus(`${title} moved to ${to}.`);
      }
      setScheduling(null);
      setCancelling(null);
      await load();
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.failure.code === 'illegal_transition') {
        setStatus(
          `${title} can't move from ${String(error.failure.extra['from'])} to ${String(error.failure.extra['to'])}.`,
        );
        return;
      }
      if (error.failure.code === 'stale_version') {
        setStatus(`Someone else changed ${title}. Reload to see their version.`);
        return;
      }
      if (error.failure.fields['publish_at'] !== undefined) {
        setStatus('Choose a publishing time in the future.');
        return;
      }
      if (error.failure.fields['images'] !== undefined) {
        setStatus('That entry needs an image before review.');
        return;
      }
      setStatus('That move was refused.');
    }
  };

  const cards =
    tab === 'sessions'
      ? sessions.map((session) => ({
          id: session.id,
          title: session.title,
          state: session.status,
          detail: formatSessionWhen(session.starts_at, session.ends_at),
          session,
        }))
      : entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          state: entry.status,
          detail: `${entry.artist_name} · ${entry.discipline}`,
          session: null,
        }));

  return (
    <section className="curate wide ground-paper">
      <h1 className="display">Curate</h1>
      <p className="status" role="status" aria-label="Curation status">
        {status}
      </p>

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'sessions'}
          onClick={() => setTab('sessions')}
        >
          Sessions
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'entries'}
          onClick={() => setTab('entries')}
        >
          Artwork entries
        </button>
      </div>

      {tab === 'sessions' ? (
        <button
          type="button"
          className="primary"
          onClick={(event) => {
            opener.current = event.currentTarget;
            setCreating(true);
          }}
        >
          New session
        </button>
      ) : null}

      <div className="board">
        {COLUMNS.map((column) => (
          <section className="board-column" key={column.state} aria-label={column.label}>
            <h2>{column.label}</h2>
            <ul className="ruled">
              {cards
                .filter((card) => card.state === column.state)
                .map((card) => (
                  <li key={card.id} className="card">
                    <h3>{card.title}</h3>
                    <p className="meta figures">{card.detail}</p>
                    {card.state === 'draft' ? (
                      <button
                        type="button"
                        onClick={() => void move(tab, card.id, card.title, 'review')}
                      >
                        {`Send ${card.title} to review`}
                      </button>
                    ) : null}
                    {card.state === 'review' ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void move(tab, card.id, card.title, 'draft')}
                        >
                          {`Return ${card.title} to draft`}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            opener.current = event.currentTarget;
                            setScheduling({ kind: tab, id: card.id, title: card.title });
                          }}
                        >
                          {`Schedule ${card.title}`}
                        </button>
                      </>
                    ) : null}
                    {card.state === 'scheduled' ? (
                      <button
                        type="button"
                        onClick={() => void move(tab, card.id, card.title, 'review')}
                      >
                        {`Unschedule ${card.title}`}
                      </button>
                    ) : null}
                    {card.state === 'scheduled' || card.state === 'published' ? (
                      <button
                        type="button"
                        onClick={(event) => {
                          opener.current = event.currentTarget;
                          if (card.session !== null) {
                            setCancelling(card.session);
                            return;
                          }
                          void move(tab, card.id, card.title, 'cancelled');
                        }}
                      >
                        {`Cancel ${card.title}`}
                      </button>
                    ) : null}
                    {tab === 'entries' ? <EntryOriginals entryId={card.id} entries={entries} /> : null}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

      {scheduling !== null ? (
        <ScheduleDialog
          title={scheduling.title}
          openerRef={opener}
          onClose={() => setScheduling(null)}
          onSchedule={(publishAt) =>
            void move(scheduling.kind, scheduling.id, scheduling.title, 'scheduled', publishAt)
          }
        />
      ) : null}

      {cancelling !== null ? (
        <Dialog
          label="Cancel session"
          closeLabel="Close"
          openerRef={opener}
          onClose={() => setCancelling(null)}
        >
          <p>{`Cancelling ${cancelling.title} refunds every ticket for it.`}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="primary"
              onClick={() => void move('sessions', cancelling.id, cancelling.title, 'cancelled')}
            >
              Cancel session and refund
            </button>
          </div>
        </Dialog>
      ) : null}

      {creating ? (
        <NewSessionDialog
          venues={venues}
          disciplines={disciplines}
          openerRef={opener}
          onClose={() => setCreating(false)}
          onCreated={async (title) => {
            setStatus(`${title} moved to draft.`);
            setCreating(false);
            await load();
          }}
          onProblem={setStatus}
        />
      ) : null}
    </section>
  );
}

function EntryOriginals(props: { entryId: string; entries: Entry[] }): JSX.Element | null {
  const entry = props.entries.find((candidate) => candidate.id === props.entryId);
  if (entry === undefined || entry.images.length === 0) return null;
  const open = async (imageId: string): Promise<void> => {
    const link = await request<{ url: string }>(
      `/api/entries/${props.entryId}/images/${imageId}/read`,
      { method: 'POST' },
    );
    window.open(link.url, '_blank', 'noopener');
  };
  return (
    <button type="button" onClick={() => void open(entry.images[0]?.id ?? '')}>
      View original
    </button>
  );
}

interface ScheduleDialogProps {
  title: string;
  openerRef: React.MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onSchedule: (publishAt: string) => void;
}

/** The time is entered as Brussels wall time, with an offset field only in a repeated hour. */
function ScheduleDialog(props: ScheduleDialogProps): JSX.Element {
  const [publishAt, setPublishAt] = useState('');
  const [offset, setOffset] = useState('+02:00');
  const repeated = /^2027-10-31T02:\d{2}$/.test(publishAt);

  return (
    <Dialog
      label="Schedule publishing"
      closeLabel="Close"
      openerRef={props.openerRef}
      onClose={props.onClose}
    >
      <p>{`Publish ${props.title} at a Brussels wall time.`}</p>
      <div className="field">
        <label htmlFor="publish-at">Publish at</label>
        <input
          id="publish-at"
          type="text"
          placeholder="2027-10-29T14:30"
          value={publishAt}
          onChange={(event) => setPublishAt(event.target.value)}
        />
      </div>
      {repeated ? (
        <div className="field">
          <label htmlFor="publish-offset">Offset</label>
          <select
            id="publish-offset"
            value={offset}
            onChange={(event) => setOffset(event.target.value)}
          >
            <option value="+02:00">+02:00 (CEST, first pass)</option>
            <option value="+01:00">+01:00 (CET, second pass)</option>
          </select>
        </div>
      ) : null}
      <div className="dialog-actions">
        <button
          type="button"
          className="primary"
          onClick={() => props.onSchedule(repeated ? `${publishAt}${offset}` : publishAt)}
        >
          Schedule
        </button>
      </div>
    </Dialog>
  );
}

interface NewSessionProps {
  venues: Named[];
  disciplines: Named[];
  openerRef: React.MutableRefObject<HTMLElement | null>;
  onClose: () => void;
  onCreated: (title: string) => Promise<void>;
  onProblem: (text: string) => void;
}

function NewSessionDialog(props: NewSessionProps): JSX.Element {
  const [draft, setDraft] = useState({
    title: '',
    description: '',
    discipline: props.disciplines[0]?.id ?? 'sound',
    venue_id: props.venues[0]?.id ?? 'remise-noord',
    starts_local: '2027-10-30T18:00',
    ends_local: '2027-10-30T19:00',
    admission: 'pass' as 'pass' | 'seat',
    capacity: '',
    price_full_cents: '',
    price_reduced_cents: '',
  });

  const create = async (): Promise<void> => {
    try {
      await request<Session>('/api/sessions', {
        method: 'POST',
        body: {
          title: draft.title,
          description: draft.description,
          discipline: draft.discipline,
          venue_id: draft.venue_id,
          starts_local: draft.starts_local,
          ends_local: draft.ends_local,
          admission: draft.admission,
          capacity: draft.admission === 'seat' ? Number(draft.capacity) : null,
          price_full_cents: draft.admission === 'seat' ? Number(draft.price_full_cents) : null,
          price_reduced_cents:
            draft.admission === 'seat' ? Number(draft.price_reduced_cents) : null,
        },
      });
      await props.onCreated(draft.title);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const first = Object.entries(error.failure.fields)[0];
      props.onProblem(
        first === undefined
          ? 'That session was refused.'
          : `${first[0].replace(/_/g, ' ')}: ${first[1].replace(/_/g, ' ')}`,
      );
    }
  };

  return (
    <Dialog
      label="New session"
      closeLabel="Close"
      openerRef={props.openerRef}
      onClose={props.onClose}
    >
      <div className="field">
        <label htmlFor="session-title">Title</label>
        <input
          id="session-title"
          type="text"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="session-description">Description</label>
        <textarea
          id="session-description"
          rows={3}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="session-discipline">Discipline</label>
        <select
          id="session-discipline"
          value={draft.discipline}
          onChange={(event) => setDraft({ ...draft, discipline: event.target.value })}
        >
          {props.disciplines.map((discipline) => (
            <option key={discipline.id} value={discipline.id}>
              {discipline.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="session-venue">Venue</label>
        <select
          id="session-venue"
          value={draft.venue_id}
          onChange={(event) => setDraft({ ...draft, venue_id: event.target.value })}
        >
          {props.venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="session-start">Starts (Brussels wall time)</label>
        <input
          id="session-start"
          type="text"
          value={draft.starts_local}
          onChange={(event) => setDraft({ ...draft, starts_local: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="session-end">Ends (Brussels wall time)</label>
        <input
          id="session-end"
          type="text"
          value={draft.ends_local}
          onChange={(event) => setDraft({ ...draft, ends_local: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="session-admission">Admission</label>
        <select
          id="session-admission"
          value={draft.admission}
          onChange={(event) =>
            setDraft({ ...draft, admission: event.target.value === 'seat' ? 'seat' : 'pass' })
          }
        >
          <option value="pass">Pass</option>
          <option value="seat">Seat</option>
        </select>
      </div>
      {draft.admission === 'seat' ? (
        <>
          <div className="field">
            <label htmlFor="session-capacity">Capacity</label>
            <input
              id="session-capacity"
              type="number"
              value={draft.capacity}
              onChange={(event) => setDraft({ ...draft, capacity: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="session-price-full">Full price, cents</label>
            <input
              id="session-price-full"
              type="number"
              value={draft.price_full_cents}
              onChange={(event) => setDraft({ ...draft, price_full_cents: event.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="session-price-reduced">Reduced price, cents</label>
            <input
              id="session-price-reduced"
              type="number"
              value={draft.price_reduced_cents}
              onChange={(event) => setDraft({ ...draft, price_reduced_cents: event.target.value })}
            />
          </div>
        </>
      ) : null}
      <div className="dialog-actions">
        <button type="button" className="primary" onClick={() => void create()}>
          Create session
        </button>
      </div>
    </Dialog>
  );
}
