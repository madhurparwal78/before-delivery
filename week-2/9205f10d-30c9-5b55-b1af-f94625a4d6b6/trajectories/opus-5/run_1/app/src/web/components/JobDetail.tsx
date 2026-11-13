import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { RequestView, SeatLabel, SessionUser } from '../../shared/types.js';
import { defaultTeamSize } from '../../shared/staffing.js';
import { api, RequestFailed, UNREACHABLE_COPY } from '../api.js';
import { useReducedMotion } from '../hooks.js';
import { Braid, RotationTable, readoutText } from './Braid.jsx';
import { JobFacts, SeatsList } from './JobFacts.jsx';
import { clock, monthDay } from '../format.js';

const CLAIMABLE: readonly string[] = ['submitted', 'half-staffed'];
const REFUSED_CHANGE = 'This job can no longer be changed that way. The detail has been refreshed.';

function claimRefusalCopy(failure: RequestFailed, label: SeatLabel, credential: string): string {
  switch (failure.code) {
    case 'seat_taken':
      return `Seat taken: another interpreter confirmed seat ${label} first.`;
    case 'credential_invalid':
      return `Your ${credential} credential isn't verified through this job's date.`;
    case 'schedule_conflict':
      return 'You already hold a seat that overlaps this job.';
    case 'invalid_transition':
    case 'not_found':
      return 'This job is no longer taking claims.';
    case 'unreachable':
      return UNREACHABLE_COPY;
    default:
      return failure.message;
  }
}

/** A seat lost to someone else reads "taken" from then on, even once the job is unreadable. */
function withTakenSeats(request: RequestView, taken: readonly string[]): RequestView {
  if (taken.length === 0) return request;
  return {
    ...request,
    seats: request.seats.map((seat) =>
      taken.includes(seat.id) ? { ...seat, status: 'confirmed', interpreter: null } : seat,
    ),
  };
}

interface JobDetailProps {
  request: RequestView;
  user: SessionUser;
  onClose: () => void;
  onChanged: () => void;
}

const PANE_EXIT_MS = 333;

export function JobDetail({ request, user, onClose, onChanged }: JobDetailProps): ReactNode {
  const reducedMotion = useReducedMotion();
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [minute, setMinute] = useState(0);
  const [takenSeatIds, setTakenSeatIds] = useState<string[]>([]);
  const [claimMessage, setClaimMessage] = useState('');
  const [claimPending, setClaimPending] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    headingRef.current?.focus();
    setMinute(0);
    setTakenSeatIds([]);
    setClaimMessage('');
    setLeaving(false);
  }, [request.id]);

  // The pane leaves the way it arrived, so the close is announced after it has slid out.
  const requestClose = useCallback((): void => {
    if (reducedMotion) {
      onClose();
      return;
    }
    setLeaving(true);
    window.setTimeout(onClose, PANE_EXIT_MS);
  }, [onClose, reducedMotion]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  const shown = withTakenSeats(request, takenSeatIds);
  const openSeats = shown.seats.filter((seat) => seat.status === 'open');

  const claim = async (seatId: string, label: SeatLabel): Promise<void> => {
    setClaimPending(true);
    setClaimMessage(`Claiming seat ${label}…`);
    try {
      await api.claim(seatId);
      setClaimMessage(`Seat ${label} confirmed. Consumer details are now shown below.`);
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        setClaimMessage(claimRefusalCopy(failure, label, request.required_credential));
        if (failure.code === 'seat_taken') setTakenSeatIds((current) => [...current, seatId]);
      }
    } finally {
      setClaimPending(false);
      onChanged();
    }
  };

  return (
    <section className={`region pane ${leaving ? 'leaving' : 'enter'}`} aria-label="Job detail">
      <div className="row-between">
        <h2 tabIndex={-1} ref={headingRef}>
          {shown.reference}
        </h2>
        <button type="button" className="quiet" aria-label="Close job detail" onClick={requestClose}>
          Close
        </button>
      </div>
      <JobFacts request={shown} />
      <SeatsList request={shown} />
      <h4>Rotation</h4>
      <Braid
        request={shown}
        reducedMotion={reducedMotion}
        minute={minute}
        onMinuteChange={setMinute}
      />
      <p className="readout" role="status" aria-label="Rotation readout">
        {readoutText(shown, minute)}
      </p>
      <RotationTable request={shown} />
      {user.role === 'coordinator' ? (
        <CoordinatorControls request={shown} onChanged={onChanged} />
      ) : null}
      {user.role === 'interpreter' ? (
        <div className="stack" style={{ marginTop: 16 }}>
          {CLAIMABLE.includes(shown.status) && openSeats.length > 0 ? (
            <div className="button-row">
              {openSeats.map((seat) => (
                <button
                  key={seat.id}
                  type="button"
                  disabled={claimPending}
                  onClick={() => void claim(seat.id, seat.label)}
                >
                  {`Claim seat ${seat.label}`}
                </button>
              ))}
            </div>
          ) : null}
          <p className="live" role="status" aria-label="Claim status">
            {claimMessage}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function CoordinatorControls({
  request,
  onChanged,
}: {
  request: RequestView;
  onChanged: () => void;
}): ReactNode {
  const fallbackTeamSize = defaultTeamSize(request.duration_minutes);
  const [teamSize, setTeamSize] = useState(request.team_size);
  const [reason, setReason] = useState(request.team_reason ?? '');
  const [rotation, setRotation] = useState(request.rotation_minutes);
  const [actualMinutes, setActualMinutes] = useState(
    request.actual_minutes ?? request.duration_minutes,
  );
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setTeamSize(request.team_size);
    setRotation(request.rotation_minutes);
    setReason(request.team_reason ?? '');
  }, [request.id, request.team_size, request.rotation_minutes, request.team_reason]);

  const act = async (run: () => Promise<void>): Promise<void> => {
    setPending(true);
    setFieldErrors({});
    try {
      await run();
    } catch (failure) {
      if (failure instanceof RequestFailed) {
        if (failure.code === 'unreachable') setMessage(UNREACHABLE_COPY);
        else if (failure.code === 'validation') {
          setFieldErrors(failure.fields);
          setMessage('');
        } else setMessage(REFUSED_CHANGE);
      }
    } finally {
      setPending(false);
      onChanged();
    }
  };

  return (
    <div className="stack" style={{ marginTop: 16 }}>
      <h4>Staffing</h4>
      <div className="field">
        <label htmlFor="rotation-minutes">Rotation interval (minutes)</label>
        <input
          id="rotation-minutes"
          type="number"
          min={20}
          max={30}
          value={rotation}
          aria-invalid={fieldErrors['rotation_minutes'] !== undefined}
          aria-describedby={
            fieldErrors['rotation_minutes'] !== undefined ? 'rotation-minutes-error' : undefined
          }
          onChange={(event) => setRotation(Number(event.target.value))}
        />
        {fieldErrors['rotation_minutes'] !== undefined ? (
          <p className="field-error" id="rotation-minutes-error">
            {fieldErrors['rotation_minutes']}
          </p>
        ) : null}
      </div>
      <div className="field" role="radiogroup" aria-label="Team size">
        <span className="radio-legend">Team size</span>
        <label className="choice">
          <input
            type="radio"
            name="team-size"
            checked={teamSize === 2}
            onChange={() => setTeamSize(2)}
          />
          Team of two
        </label>
        <label className="choice">
          <input
            type="radio"
            name="team-size"
            checked={teamSize === 1}
            onChange={() => setTeamSize(1)}
          />
          Solo
        </label>
      </div>
      {teamSize !== fallbackTeamSize ? (
        <div className="field">
          <label htmlFor="team-reason">Reason for team change</label>
          <input
            id="team-reason"
            type="text"
            value={reason}
            aria-invalid={fieldErrors['team_reason'] !== undefined}
            aria-describedby={
              fieldErrors['team_reason'] !== undefined ? 'team-reason-error' : undefined
            }
            onChange={(event) => setReason(event.target.value)}
          />
          {fieldErrors['team_reason'] !== undefined ? (
            <p className="field-error" id="team-reason-error">
              {fieldErrors['team_reason']}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="button-row">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            void act(async () => {
              await api.saveStaffing(request.id, {
                team_size: teamSize,
                team_reason: reason,
                rotation_minutes: rotation,
              });
              setMessage('Staffing saved.');
            })
          }
        >
          Save staffing
        </button>
        <button
          type="button"
          className="quiet"
          disabled={pending}
          onClick={() =>
            void act(async () => {
              setMessage('Sending open-seat emails…');
              const result = await api.broadcast(request.id);
              setMessage(
                result.emailed === 0
                  ? 'No eligible interpreter is free for this job.'
                  : `Open-seat email sent to ${result.emailed} eligible interpreters.`,
              );
            })
          }
        >
          Broadcast open seats
        </button>
      </div>
      <h4>Completion</h4>
      <div className="field">
        <label htmlFor="actual-minutes">Actual minutes</label>
        <input
          id="actual-minutes"
          type="number"
          min={1}
          max={720}
          value={actualMinutes}
          aria-invalid={fieldErrors['actual_minutes'] !== undefined}
          aria-describedby={
            fieldErrors['actual_minutes'] !== undefined ? 'actual-minutes-error' : undefined
          }
          onChange={(event) => setActualMinutes(Number(event.target.value))}
        />
        {fieldErrors['actual_minutes'] !== undefined ? (
          <p className="field-error" id="actual-minutes-error">
            {fieldErrors['actual_minutes']}
          </p>
        ) : null}
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            void act(async () => {
              await api.complete(request.id, actualMinutes);
              setMessage(`${request.reference} marked completed at ${actualMinutes} minutes.`);
            })
          }
        >
          Mark completed
        </button>
      </div>
      <p className="live" role="status" aria-label="Job status">
        {message}
      </p>
      <h4>History</h4>
      <ul className="history-list" aria-label="History">
        {(request.history ?? []).map((entry, index) => (
          <li key={`${entry.at}-${index}`}>
            {`${clock(entry.at)} ${monthDay(entry.at)} · ${entry.actor} · ${entry.action} · ${entry.detail}`}
          </li>
        ))}
      </ul>
    </div>
  );
}
