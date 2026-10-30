import { useMemo, useState, type ReactNode } from 'react';
import { LANGUAGES, SETTINGS, nameOf } from '../../shared/catalog';
import {
  ApiFailure,
  giveBackSeat,
  listMySeats,
  submitVerification,
  verificationLink,
  type AssignmentView,
  type CurrentUser,
} from '../lib/api';
import { SeatLane, StatusLabel } from '../components/Seats';
import { LiveStatus } from '../components/Shell';
import { rangeText } from '../lib/format';
import { useSeatMotion, usePolling, type SeatGroup } from '../lib/hooks';

function groupsOf(assignments: AssignmentView[]): SeatGroup[] {
  return assignments.map((assignment) => ({
    key: assignment.number,
    seats: assignment.seats.map((seat) => ({
      seat: seat.seat,
      status: seat.status,
      initials: seat.interpreter_initials ?? null,
    })),
  }));
}

function VerificationForm({
  number,
  seat,
  onStatus,
  onVerified,
}: {
  number: string;
  seat: number;
  onStatus: (message: string) => void;
  onVerified: () => void;
}): ReactNode {
  const [minutes, setMinutes] = useState('');
  const [miles, setMiles] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  return (
    <form
      noValidate
      aria-label={`Verify seat ${seat} on ${number}`}
      onSubmit={(event) => {
        event.preventDefault();
        setPending(true);
        onStatus('Uploading…');
        setFields({});
        const body = new FormData();
        body.set('actual_minutes', minutes);
        body.set('round_trip_miles', miles);
        if (file !== null) body.set('form', file);
        submitVerification(number, seat, body)
          .then(() => {
            onStatus(`Verification for seat ${seat} received.`);
            onVerified();
          })
          .catch((error: unknown) => {
            if (error instanceof ApiFailure && error.code === 'payload_too_large') {
              onStatus('The file is larger than 5,000,000 bytes.');
              return;
            }
            if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
              onStatus('File storage is unavailable. Your form was not saved. Try again shortly.');
              return;
            }
            if (error instanceof ApiFailure && error.code === 'validation') {
              setFields(error.fields);
              onStatus(
                error.fields['form'] === undefined
                  ? 'Check the highlighted fields.'
                  : 'Upload a PDF, JPEG or PNG file.',
              );
              return;
            }
            onStatus('This seat can no longer be verified.');
          })
          .finally(() => setPending(false));
      }}
    >
      <div className="field">
        <label htmlFor={`minutes-${number}-${seat}`}>Actual minutes</label>
        <input
          id={`minutes-${number}-${seat}`}
          type="number"
          min={1}
          max={960}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
        />
        {fields['actual_minutes'] === undefined ? null : (
          <p className="field-error">{fields['actual_minutes']}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`miles-${number}-${seat}`}>Round-trip miles</label>
        <input
          id={`miles-${number}-${seat}`}
          type="number"
          min={0}
          max={1000}
          value={miles}
          onChange={(event) => setMiles(event.target.value)}
        />
        {fields['round_trip_miles'] === undefined ? null : (
          <p className="field-error">{fields['round_trip_miles']}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor={`form-${number}-${seat}`}>Signed verification form</label>
        <input
          id={`form-${number}-${seat}`}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        {fields['form'] === undefined ? null : <p className="field-error">{fields['form']}</p>}
      </div>
      <button type="submit" className="primary" disabled={pending}>
        Submit verification
      </button>
    </form>
  );
}

export function MySeats({ user }: { user: CurrentUser }): ReactNode {
  const [status, setStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);
  const { data, refresh } = usePolling(() => listMySeats(), []);
  const assignments = useMemo(() => data?.assignments ?? [], [data]);
  const groups = useMemo(() => groupsOf(assignments), [assignments]);
  const { lanes } = useSeatMotion(groups, {});

  const openForm = (number: string, seat: number): void => {
    const key = `${number}:${seat}`;
    setVerifying(verifying === key ? null : key);
  };

  const viewForm = (number: string, seat: number): void => {
    verificationLink(number, seat)
      .then((link) => {
        window.open(link.url, '_blank', 'noopener');
      })
      .catch(() => setStatus('That signed form cannot be opened right now.'));
  };

  return (
    <main className="sheet">
      <h1>My seats</h1>
      <LiveStatus name="Claim status" message={status} />
      <LiveStatus name="Upload status" message={uploadStatus} />
      {assignments.length === 0 ? <p>You hold no seats yet.</p> : null}
      <ul className="card-list" aria-label="My seats">
        {assignments.map((assignment) => {
          const seatLanes = lanes.get(assignment.number) ?? [];
          return (
            <li className="card" key={assignment.number}>
              <h2>
                {nameOf(LANGUAGES, assignment.language)} · {nameOf(SETTINGS, assignment.setting)}
              </h2>
              <p>
                <span className="numeral">{assignment.number}</span>{' '}
                <StatusLabel status={assignment.status} />
              </p>
              <p>{rangeText(assignment.start_at, assignment.end_at)}</p>
              <dl className="detail-list">
                <dt>Address</dt>
                <dd>
                  {assignment.street_address}, {assignment.city}
                </dd>
                <dt>Patient initials</dt>
                <dd>{assignment.patient_initials}</dd>
                <dt>Medical notes</dt>
                <dd>{assignment.medical_notes === '' ? '—' : assignment.medical_notes}</dd>
                <dt>Scheduler</dt>
                <dd>
                  {assignment.scheduler?.name} · {assignment.scheduler?.phone}
                </dd>
              </dl>
              <div className="card-lanes">
                {seatLanes.map((lane) => {
                  const key = `${assignment.number}:${lane.seat}`;
                  const isMine = lane.initials === user.initials;
                  if (!isMine) {
                    return (
                      <div className="card-lane-row" key={lane.seat}>
                        <span>Seat {lane.seat}</span>
                        <SeatLane lane={lane} />
                      </div>
                    );
                  }
                  return (
                    <div key={lane.seat}>
                      <div className="card-lane-row">
                        <span>Seat {lane.seat}</span>
                        <SeatLane lane={lane} />
                        {lane.status === 'served' ? (
                          <>
                            <span className="verified-mark" role="img" aria-label="Seat verified">
                              ✓
                            </span>
                            <span>Seat {lane.seat} verified</span>
                            <a
                              href={`/api/assignments/${assignment.number}/seats/${lane.seat}/verification-link`}
                              className="link-action"
                              onClick={(event) => {
                                event.preventDefault();
                                viewForm(assignment.number, lane.seat);
                              }}
                            >
                              View signed form
                            </a>
                          </>
                        ) : null}
                        {lane.status === 'held' && assignment.status !== 'cancelled' ? (
                          <>
                            <button
                              type="button"
                              aria-label={`Give back seat ${lane.seat} on ${assignment.number}`}
                              disabled={pendingSeat === key}
                              onClick={() => {
                                setPendingSeat(key);
                                setStatus('Giving back…');
                                giveBackSeat(assignment.number, lane.seat)
                                  .then(() => {
                                    setStatus(
                                      `Seat ${lane.seat} on ${assignment.number} given back.`,
                                    );
                                    refresh();
                                  })
                                  .catch(() =>
                                    setStatus('This seat can no longer be given back.'),
                                  )
                                  .finally(() => setPendingSeat(null));
                              }}
                            >
                              Give back
                            </button>
                            <a
                              href={`#verify-${assignment.number}-${lane.seat}`}
                              className="link-action"
                              aria-label={`Verify seat ${lane.seat} on ${assignment.number}`}
                              onClick={(event) => {
                                event.preventDefault();
                                openForm(assignment.number, lane.seat);
                              }}
                            >
                              Verify
                            </a>
                          </>
                        ) : null}
                      </div>
                      {verifying === key && lane.status === 'held' ? (
                        <VerificationForm
                          number={assignment.number}
                          seat={lane.seat}
                          onStatus={setUploadStatus}
                          onVerified={() => {
                            setVerifying(null);
                            refresh();
                          }}
                        />
                      ) : null}
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
