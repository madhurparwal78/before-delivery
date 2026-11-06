import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  LANGUAGE_NAMES,
  SETTING_LABELS,
  type AssignmentView,
} from '../../shared/contract.js';
import { formatAgencyRange } from '../../shared/zone.js';
import { ApiFailure, api } from '../api.js';
import { usePoll } from '../hooks.js';
import { useHatchSeam, type SeamSnapshot } from '../seam.js';
import {
  SeatLane,
  StatusRegion,
  coveredCountOf,
  coveredCountText,
  seatLabelOf,
} from '../ui.js';

const CLAIM_FAILURES: Record<string, string> = {
  seat_taken: 'Seat already taken',
  already_holding: 'You already hold a seat on this request.',
  calendar_conflict: 'This overlaps a seat you already hold.',
};

export function Offers(): ReactNode {
  const offers = usePoll(() => api.offers());
  const [status, setStatus] = useState('');
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const [lossBySeat, setLossBySeat] = useState<Record<string, string>>({});
  // A seat this interpreter just won stays on screen long enough to play the Hatch Seam.
  const [justClaimed, setJustClaimed] = useState<AssignmentView | null>(null);
  const handover = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (handover.current !== null) {
        window.clearTimeout(handover.current);
      }
    },
    [],
  );

  const served = offers.data?.offers ?? [];
  const assignments =
    justClaimed === null
      ? served
      : [
          ...served.filter((assignment) => assignment.number !== justClaimed.number),
          justClaimed,
        ].sort((a, b) => a.start_at.localeCompare(b.start_at));
  const snapshot = useMemo<SeamSnapshot | null>(
    () =>
      offers.data === null
        ? null
        : {
            seats: assignments.flatMap((assignment) =>
              assignment.seats.map((seat) => ({
                key: `${assignment.number}:${seat.seat}`,
                held: seat.status !== 'open',
                label: seatLabelOf(seat),
                groupKey: null,
                capsuleKey: assignment.number,
                announceSubject: `${assignment.number}: seat ${seat.seat}`,
              })),
            ),
            groups: [],
            capsules: assignments.map((assignment) => ({
              key: assignment.number,
              covered: coveredCountOf(assignment.seats),
              seats: assignment.seats.length,
            })),
          },
    [offers.data],
  );
  const { display } = useHatchSeam(snapshot);

  const claim = async (assignment: AssignmentView, seat: number): Promise<void> => {
    const key = `${assignment.number}:${seat}`;
    setPendingSeat(key);
    setLossBySeat((current) => ({ ...current, [key]: '' }));
    setStatus('Claiming…');
    try {
      const claimed = await api.claim(assignment.number, seat);
      setStatus(`Seat ${seat} on ${assignment.number} is yours. Details are in My seats.`);
      setJustClaimed(claimed);
      handover.current = window.setTimeout(() => {
        setJustClaimed(null);
        void offers.refresh();
      }, 1200);
    } catch (error) {
      const message =
        error instanceof ApiFailure
          ? (CLAIM_FAILURES[error.code] ?? "Couldn't reach Teamseat. Try again shortly.")
          : "Couldn't reach Teamseat. Try again shortly.";
      setStatus(message);
      setLossBySeat((current) => ({ ...current, [key]: message }));
    } finally {
      setPendingSeat(null);
    }
  };

  return (
    <main className="sheet sheet--plain">
      <h1>Open seats</h1>
      <StatusRegion name="Claim status" text={status} />
      <ul className="cards" aria-label="Open seats">
        {assignments.map((assignment) => (
          <li className="card" key={assignment.number}>
            <div className="card__title">
              <h2 className="num">{assignment.number}</h2>
              <span>{LANGUAGE_NAMES[assignment.language] ?? assignment.language}</span>
              <span>{SETTING_LABELS[assignment.setting]}</span>
            </div>
            <dl className="card__facts">
              <dt>City</dt>
              <dd>{assignment.city}</dd>
              <dt>When</dt>
              <dd>{formatAgencyRange(new Date(assignment.start_at), new Date(assignment.end_at))}</dd>
              <dt>Length</dt>
              <dd>
                <span className="num">{assignment.duration_minutes} min</span>
              </dd>
            </dl>
            <p>
              {coveredCountText(
                display.covered[assignment.number] ?? coveredCountOf(assignment.seats),
                assignment.seats.length,
              )}
            </p>
            {assignment.seats.map((seat) => {
              const key = `${assignment.number}:${seat.seat}`;
              const loss = lossBySeat[key] ?? '';
              return (
                <div className="card__seat" key={seat.seat}>
                  <SeatLane
                    seat={seat.seat}
                    fill={display.fill[key] ?? 0}
                    label={display.label[key] ?? 'open'}
                    animating={display.animating[key] ?? false}
                  />
                  <div className="card__seat-actions">
                    {seat.status === 'open' ? (
                      <button
                        type="button"
                        className="btn btn--primary"
                        aria-label={`Claim seat ${seat.seat} on ${assignment.number}`}
                        disabled={pendingSeat === key}
                        onClick={() => void claim(assignment, seat.seat)}
                      >
                        {pendingSeat === key ? 'Claiming…' : `Claim seat ${seat.seat}`}
                      </button>
                    ) : null}
                    {loss === '' ? null : <span className="field__error">{loss}</span>}
                  </div>
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      {assignments.length === 0 ? <p>No open seats in your languages right now.</p> : null}
    </main>
  );
}
