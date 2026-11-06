import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Ride } from '../../shared/types.js';
import { ApiError, SessionEnded, get, post } from '../api.js';
import { EmptyList } from '../components/EmptyList.js';
import { usePoll } from '../hooks.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';
import { NotFound } from './NotFound.js';

export function RideList(): ReactNode {
  const { user, ready } = useSession();
  const [rides, setRides] = useState<Ride[] | null>(null);
  useEffect(() => { document.title = 'My rides · Ommezwaai Feeler'; }, []);
  useEffect(() => { if (ready && !user) navigate('/sign-in'); }, [ready, user]);
  usePoll(async () => { if (user) setRides((await get<{ rides: Ride[] }>('/api/test-rides', { poll: true })).rides); }, 3000, [user?.id]);
  return (
    <section className="page">
      <h1>My rides</h1>
      {rides === null ? <p className="hint">Loading...</p> : rides.length === 0 ? <EmptyList>No test rides booked.</EmptyList> : (
        <table className="ruled-table" role="table" aria-label="Rides">
          <thead role="rowgroup"><tr role="row"><th role="columnheader" scope="col">Bike</th><th role="columnheader" scope="col">Date</th><th role="columnheader" scope="col">Time</th><th role="columnheader" scope="col">State</th></tr></thead>
          <tbody role="rowgroup">
            {rides.map((r) => (
              <tr role="row" key={r.id}>
                <td role="cell" data-label="Bike"><Link to={`/rides/${r.id}`}>{r.bikeName ?? r.bikeId}</Link></td>
                <td role="cell" data-label="Date" className="num">{r.localDate}</td>
                <td role="cell" data-label="Time" className="num">{r.localTime}</td>
                <td role="cell" data-label="State">{r.state}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const HEADINGS: Record<Ride['state'], string> = {
  held: 'Test ride on hold', confirmed: 'Test ride confirmed', ridden: 'Test ride ridden', 'no-show': 'Test ride marked no-show',
  expired: 'Test ride hold expired', cancelled: 'Test ride cancelled',
};

export function RidePage({ id }: { id: string }): ReactNode {
  const { user, ready } = useSession();
  const [ride, setRide] = useState<Ride | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useEffect(() => { if (ready && !user) navigate('/sign-in'); }, [ready, user]);
  usePoll(async () => {
    if (!user) return;
    try {
      const next = await get<Ride>(`/api/test-rides/${id}`, { poll: true });
      setRide((was) => (was && JSON.stringify({ ...was, serverNow: 0, remainingSeconds: 0 }) === JSON.stringify({ ...next, serverNow: 0, remainingSeconds: 0 }) ? was : next));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) setRide(null);
    }
  }, 3000, [id, user?.id]);
  useEffect(() => {
    if (ride && !focused.current) {
      focused.current = true;
      heading.current?.focus();
    }
    if (ride) document.title = `${HEADINGS[ride.state]} · Ommezwaai Feeler`;
  }, [ride]);

  if (ride === null) return <NotFound />;
  if (!ride) return <section className="page"><p className="hint">Loading...</p></section>;

  const cancel = async (): Promise<void> => {
    try {
      setRide(await post<Ride>(`/api/test-rides/${id}/cancel`));
      setMessage('Test ride cancelled.');
      window.setTimeout(() => status.current?.focus(), 0);
    } catch (caught) {
      if (caught instanceof SessionEnded) return;
      if (caught instanceof ApiError) setMessage(caught.code === 'cancellation_closed' ? 'Free cancellation has closed for this ride.' : 'This ride cannot be cancelled.');
    }
  };

  return (
    <section className="page ride-page">
      <div className="ride-main">
        <p className="crumb"><Link to="/rides">My rides</Link></p>
        <h1 ref={heading} tabIndex={-1}>{HEADINGS[ride.state]}</h1>
        <dl className="spec-list">
          <div><dt>Bike</dt><dd>{ride.bikeName ?? ride.bikeId}</dd></div>
          <div><dt>Date</dt><dd className="num">{ride.localDate}</dd></div>
          <div><dt>Time</dt><dd className="num">{ride.localTime}</dd></div>
          <div><dt>State</dt><dd>{ride.state}</dd></div>
          <div><dt>Free cancellation</dt><dd>{ride.state === 'confirmed' ? (ride.freeCancellation ? 'until 18:00 the day before' : 'closed') : 'not applicable'}</dd></div>
        </dl>
      </div>
      <aside className="ride-side ruled" aria-label="Ride actions">
        <div role="status" aria-label="Ride status" tabIndex={-1} ref={status}>{message}</div>
        {ride.state === 'confirmed' ? <button type="button" className="btn" onClick={() => { void cancel(); }}>Cancel ride</button> : null}
      </aside>
    </section>
  );
}
