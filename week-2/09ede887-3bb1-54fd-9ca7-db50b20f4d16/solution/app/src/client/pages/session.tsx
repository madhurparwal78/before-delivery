import { useCallback, useEffect, useState } from 'react';
import type { Session, Speaker } from '../../shared/api';
import { request, sessionPath } from '../api';
import { OUTAGE_COPY } from '../copy';
import { loadSpeakers } from '../data';
import { venueDateTime, venueLine } from '../format';
import { useLiveRefresh, useTitle } from '../hooks';
import { useApp } from '../state';
import { rowKey, useBooking } from '../components/booking';
import { Loading, NotFound } from '../components/chrome';
import { Pills, SeatActions, SeatLine } from '../components/session-row';

type Load = { state: 'loading' } | { state: 'missing' } | { state: 'outage' } | { state: 'ready'; session: Session };

export function SessionPage({ id }: { id: string }) {
  const { auth, viewer } = useApp();
  const token = auth?.token ?? null;
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  useTitle(load.state === 'ready' ? load.session.title : 'Session');

  const fetchSession = useCallback(async () => {
    const result = await request<Session>(sessionPath(id), { token });
    if (result.ok) setLoad({ state: 'ready', session: result.data });
    else if (result.error.code === 'not_found') setLoad({ state: 'missing' });
    else setLoad((current) => (current.state === 'ready' ? current : { state: 'outage' }));
  }, [id, token]);

  useEffect(() => {
    setLoad({ state: 'loading' });
    void fetchSession();
    void loadSpeakers().then((list) => setSpeakers(list ?? []));
  }, [fetchSession]);

  const booking = useBooking(fetchSession);
  useLiveRefresh(() => {
    if (!booking.busy) void fetchSession();
  }, load.state === 'ready');

  if (load.state === 'loading') return <section className="page"><Loading /></section>;
  if (load.state === 'missing') return <NotFound copy="We could not find that session." />;
  if (load.state === 'outage') return <section className="page"><p className="helper">{OUTAGE_COPY}</p></section>;

  const session = load.session;
  const seats = session.seats;
  const details: [string, string][] = [
    ['Stage', session.stage_name ?? session.location ?? 'None'],
    ['Format', session.format_label ?? 'None'],
    ['Starts', venueDateTime(session.date, session.start_local)],
    ['Ends', venueDateTime(session.date, session.end_local)],
    ['Capacity', seats ? String(seats.capacity) : 'Open to everyone, no reservation needed'],
    ['Seats left', seats ? String(seats.left) : 'Not reserved'],
    ['Waitlist', seats ? String(session.waitlist_count ?? 0) : 'No waitlist'],
  ];
  const waitlistHelper = seats && seats.left <= 0
    ? 'This room is full. Join the waitlist and a freed seat is held for whoever has waited longest.'
    : seats
      ? 'Reserve a seat to keep your place in the room.'
      : 'No reservation needed. Just turn up.';

  return (
    <article className="page session-page" data-row={rowKey('page', session.id)}>
      <p className="eyebrow">
        Day {session.day} · {venueDateTime(session.date, session.start_local)}
      </p>
      <h1 className="session-title">{session.title}</h1>
      <p className="helper venue-line">{venueLine(session.start_instant)}</p>
      <div className="session-layout">
        <div className="session-body">
          {session.speakers.length > 0 && (
            <ul className="session-speakers" aria-label="Speakers for this session">
              {session.speakers.map((ref) => {
                const speaker = speakers.find((s) => s.name === ref.name);
                return (
                  <li key={ref.name}>
                    <p className="speaker-name-line">
                      <strong>{ref.name}</strong> - {ref.company}
                    </p>
                    {speaker && speaker.bio_html && <p className="bio" dangerouslySetInnerHTML={{ __html: speaker.bio_html }} />}
                  </li>
                );
              })}
            </ul>
          )}
          <Pills session={session} />
          <p className="description">{session.description}</p>
          <table className="details" aria-label="Session details">
            <tbody>
              {details.map(([label, value]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <aside className="session-aside" aria-label="Your seat">
          <p className="helper">{waitlistHelper}</p>
          <SeatLine session={session} />
          <SeatActions session={session} context="page" booking={booking} viewer={viewer} />
          <p className="booking-messages" role="status" aria-label="Booking messages">
            {booking.message}
          </p>
        </aside>
      </div>
    </article>
  );
}
