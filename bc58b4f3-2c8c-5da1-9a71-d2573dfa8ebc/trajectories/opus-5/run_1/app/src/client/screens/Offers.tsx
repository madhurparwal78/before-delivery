import { useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, SETTINGS, nameOf } from '../../shared/catalog';
import { ApiFailure, claimSeat, listOffers, type AssignmentView } from '../lib/api';
import { AllCoveredMark, SeatLane, StatusLabel, allCovered, coveredCount } from '../components/Seats';
import { LiveStatus } from '../components/Shell';
import { rangeText } from '../lib/format';
import { useSeatMotion, usePolling, type SeatGroup } from '../lib/hooks';

function groupsOf(offers: AssignmentView[]): SeatGroup[] {
  return offers.map((offer) => ({
    key: offer.number,
    seats: offer.seats.map((seat) => ({
      seat: seat.seat,
      status: seat.status,
      initials: seat.interpreter_initials ?? null,
    })),
  }));
}

export function Offers(): ReactNode {
  const [status, setStatus] = useState('');
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const [lossBySeat, setLossBySeat] = useState<Record<string, string>>({});
  const { data, refresh } = usePolling(() => listOffers(), []);
  const offers = useMemo(() => data?.offers ?? [], [data]);
  const groups = useMemo(() => groupsOf(offers), [offers]);
  const { lanes } = useSeatMotion(groups, {});

  const claim = (number: string, seat: number): void => {
    const key = `${number}:${seat}`;
    setPendingSeat(key);
    setStatus('Claiming…');
    setLossBySeat((current) => ({ ...current, [key]: '' }));
    claimSeat(number, seat)
      .then(() => {
        setStatus(`Seat ${seat} on ${number} is yours. Details are in My seats.`);
        refresh();
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiFailure ? error.code : 'unknown';
        const copy =
          code === 'already_holding'
            ? 'You already hold a seat on this request.'
            : code === 'calendar_conflict'
              ? 'This overlaps a seat you already hold.'
              : 'Seat already taken';
        setStatus(copy);
        setLossBySeat((current) => ({ ...current, [key]: copy }));
      })
      .finally(() => setPendingSeat(null));
  };

  return (
    <main className="sheet">
      <h1>Open seats</h1>
      <LiveStatus name="Claim status" message={status} />
      {offers.length === 0 ? <p>No open seats in your languages right now.</p> : null}
      <ul className="card-list" aria-label="Open seats">
        {offers.map((offer) => {
          const offerLanes = lanes.get(offer.number) ?? [];
          return (
            <li className="card" key={offer.number}>
              <h2>
                {nameOf(LANGUAGES, offer.language)} · {nameOf(SETTINGS, offer.setting)}
              </h2>
              <p>
                <span className="numeral">{offer.number}</span> · {offer.city}
              </p>
              <p>{rangeText(offer.start_at, offer.end_at)}</p>
              <p>
                <StatusLabel status={offer.status} /> {coveredCount(offerLanes)}{' '}
                {allCovered(offerLanes) ? <AllCoveredMark /> : null}
              </p>
              <div className="card-lanes">
                {offerLanes.map((lane) => {
                  const key = `${offer.number}:${lane.seat}`;
                  return (
                    <div className="card-lane-row" key={lane.seat}>
                      <span>Seat {lane.seat}</span>
                      <SeatLane lane={lane} />
                      {lane.status === 'open' ? (
                        <button
                          type="button"
                          aria-label={`Claim seat ${lane.seat} on ${offer.number}`}
                          disabled={pendingSeat === key}
                          onClick={() => claim(offer.number, lane.seat)}
                        >
                          {pendingSeat === key ? 'Claiming…' : `Claim seat ${lane.seat}`}
                        </button>
                      ) : null}
                      {lossBySeat[key] === undefined || lossBySeat[key] === '' ? null : (
                        <span className="loss-copy">{lossBySeat[key]}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
