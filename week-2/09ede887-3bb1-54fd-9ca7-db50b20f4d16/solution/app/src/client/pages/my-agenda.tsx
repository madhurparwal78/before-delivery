import { useCallback, useEffect, useState } from 'react';
import type { MyAgenda, Session } from '../../shared/api';
import { apiPath, request } from '../api';
import { OUTAGE_COPY } from '../copy';
import { useLiveRefresh, useTitle } from '../hooks';
import { Link, signInPath, useRouter } from '../router';
import { useApp } from '../state';
import { useBooking, type Booking } from '../components/booking';
import { Loading } from '../components/chrome';
import { SessionRow } from '../components/session-row';

const GROUPS = [
  ['reserved', 'Reserved seats', 'You have not reserved any seats yet.'],
  ['held', 'Seats held for you', 'No seats are being held for you.'],
  ['waitlisted', 'Waitlist', 'You are not on any waitlist.'],
  ['saved', 'Saved sessions', 'Nothing saved yet. Browse the agenda.'],
] as const;

function Group({ name, heading, empty, sessions, booking }: { name: string; heading: string; empty: string; sessions: Session[]; booking: Booking }) {
  return (
    <section className="agenda-group" aria-labelledby={`group-${name}`}>
      <h2 id={`group-${name}`} className="group-title">
        {heading}
      </h2>
      {sessions.length === 0 ? (
        <p className="empty-line" tabIndex={-1} data-empty={name}>
          {empty}
        </p>
      ) : (
        <ul className="session-list" aria-labelledby={`group-${name}`} data-list={name}>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} context={name} booking={booking} viewer="attendee" />
          ))}
        </ul>
      )}
    </section>
  );
}

export function MyAgendaPage() {
  useTitle('My Agenda');
  const { auth, viewer } = useApp();
  const { place, navigate } = useRouter();
  const token = auth?.token ?? null;
  const [agenda, setAgenda] = useState<MyAgenda | null>(null);
  const [outage, setOutage] = useState(false);

  useEffect(() => {
    if (!auth) navigate(signInPath(place), { replace: true });
  }, [auth, navigate, place]);

  const fetchAgenda = useCallback(async () => {
    if (!token || viewer !== 'attendee') return;
    const result = await request<MyAgenda>(apiPath('/me/agenda'), { token });
    if (result.ok) {
      setAgenda(result.data);
      setOutage(false);
    } else if (result.error.code === 'unavailable') setOutage(true);
  }, [token, viewer]);

  useEffect(() => {
    void fetchAgenda();
  }, [fetchAgenda]);

  const booking = useBooking(fetchAgenda);
  useLiveRefresh(() => {
    if (!booking.busy) void fetchAgenda();
  }, viewer === 'attendee');

  if (!auth) return <section className="page"><Loading /></section>;
  if (viewer === 'organiser') {
    return (
      <section className="page page-narrow">
        <h1 className="page-title">My Agenda</h1>
        <p className="helper">
          My Agenda is for attendees. Use the organiser page instead. <Link to="/organiser">Go to the organiser page</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="page my-agenda">
      <header className="page-head">
        <h1 className="page-title">My Agenda</h1>
        <p className="helper">Your seats, holds, waitlists and saved sessions, in programme order. Claim a held seat before it is passed on.</p>
      </header>
      <p className="booking-messages" role="status" aria-label="Booking messages">
        {booking.message}
      </p>
      {!agenda && (outage ? <p className="helper">{OUTAGE_COPY}</p> : <Loading />)}
      {agenda &&
        GROUPS.map(([name, heading, empty]) => (
          <Group key={name} name={name} heading={heading} empty={empty} sessions={agenda[name]} booking={booking} />
        ))}
    </section>
  );
}
