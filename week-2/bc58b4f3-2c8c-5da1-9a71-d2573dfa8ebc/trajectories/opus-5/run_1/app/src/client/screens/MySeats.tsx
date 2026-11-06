import { useMemo, useState, type ReactNode } from 'react';
import {
  ASSIGNMENT_STATUS_LABELS,
  LANGUAGE_NAMES,
  MAX_FORM_FILE_BYTES,
  SETTING_LABELS,
  type AssignmentView,
  type SessionUser,
} from '../../shared/contract.js';
import { formatAgencyRange } from '../../shared/zone.js';
import { ApiFailure, api } from '../api.js';
import { usePoll } from '../hooks.js';
import { useHatchSeam, type SeamSnapshot } from '../seam.js';
import {
  Field,
  SeatLane,
  StatusRegion,
  coveredCountOf,
  coveredCountText,
  seatLabelOf,
} from '../ui.js';

export function MySeats({ user }: { user: SessionUser }): ReactNode {
  const mine = usePoll(() => api.mySeats());
  const [claimStatus, setClaimStatus] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [verifying, setVerifying] = useState<string | null>(null);
  const [pendingSeat, setPendingSeat] = useState<string | null>(null);

  const assignments = mine.data?.assignments ?? [];
  const snapshot = useMemo<SeamSnapshot | null>(
    () =>
      mine.data === null
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
    [mine.data],
  );
  const { display } = useHatchSeam(snapshot);

  const giveBack = async (assignment: AssignmentView, seat: number): Promise<void> => {
    const key = `${assignment.number}:${seat}`;
    setPendingSeat(key);
    setClaimStatus('Giving back…');
    try {
      await api.giveBack(assignment.number, seat);
      setClaimStatus(`Seat ${seat} on ${assignment.number} given back.`);
      await mine.refresh();
    } catch (error) {
      setClaimStatus(
        error instanceof ApiFailure && error.status === 409
          ? 'This seat can no longer be given back.'
          : "Couldn't reach Teamseat. Try again shortly.",
      );
    } finally {
      setPendingSeat(null);
    }
  };

  const openForm = async (assignment: AssignmentView, seat: number): Promise<void> => {
    const link = await api.verificationLink(assignment.number, seat);
    const anchor = document.createElement('a');
    anchor.href = link.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <main className="sheet sheet--plain">
      <h1>My seats</h1>
      <StatusRegion name="Claim status" text={claimStatus} />
      <StatusRegion name="Upload status" text={uploadStatus} />
      <ul className="cards" aria-label="My seats">
        {assignments.map((assignment) => (
          <li className="card" key={assignment.number}>
            <div className="card__title">
              <h2 className="num">{assignment.number}</h2>
              <span>{LANGUAGE_NAMES[assignment.language] ?? assignment.language}</span>
              <span>{SETTING_LABELS[assignment.setting]}</span>
              <span>{ASSIGNMENT_STATUS_LABELS[assignment.status]}</span>
            </div>
            <dl className="card__facts">
              <dt>When</dt>
              <dd>{formatAgencyRange(new Date(assignment.start_at), new Date(assignment.end_at))}</dd>
              <dt>Where</dt>
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
            <p>
              {coveredCountText(
                display.covered[assignment.number] ?? coveredCountOf(assignment.seats),
                assignment.seats.length,
              )}
            </p>
            {assignment.seats.map((seat) => {
              const key = `${assignment.number}:${seat.seat}`;
              const formOpen = verifying === key;
              const isOwnSeat = seat.interpreter_initials === user.initials;
              return (
                <div className="card__seat" key={seat.seat}>
                  <SeatLane
                    seat={seat.seat}
                    fill={display.fill[key] ?? 0}
                    label={display.label[key] ?? 'open'}
                    animating={display.animating[key] ?? false}
                  />
                  {isOwnSeat && seat.status === 'served' ? (
                    <div className="card__seat-actions">
                      <span className="verified-mark" role="img" aria-label="Seat verified">
                        ✓
                      </span>
                      <span>Seat {seat.seat} verified</span>
                      <a
                        href={`/api/assignments/${assignment.number}/seats/${seat.seat}/verification-link`}
                        onClick={(event) => {
                          event.preventDefault();
                          void openForm(assignment, seat.seat);
                        }}
                      >
                        View signed form
                      </a>
                    </div>
                  ) : null}
                  {isOwnSeat && seat.status === 'held' ? (
                    <div className="card__seat-actions">
                      <button
                        type="button"
                        className="btn btn--quiet"
                        aria-label={`Give back seat ${seat.seat} on ${assignment.number}`}
                        disabled={pendingSeat === key}
                        onClick={() => void giveBack(assignment, seat.seat)}
                      >
                        Give back seat {seat.seat}
                      </button>
                      <a
                        href={`#verify-${assignment.number}-${seat.seat}`}
                        aria-label={`Verify seat ${seat.seat} on ${assignment.number}`}
                        onClick={(event) => {
                          event.preventDefault();
                          setVerifying(formOpen ? null : key);
                        }}
                      >
                        Verify seat {seat.seat}
                      </a>
                    </div>
                  ) : null}
                  {formOpen ? (
                    <VerificationForm
                      assignment={assignment}
                      seat={seat.seat}
                      onStatus={setUploadStatus}
                      onDone={async () => {
                        setVerifying(null);
                        await mine.refresh();
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </li>
        ))}
      </ul>
      {assignments.length === 0 ? <p>You hold no seats yet.</p> : null}
    </main>
  );
}

function VerificationForm({
  assignment,
  seat,
  onStatus,
  onDone,
}: {
  assignment: AssignmentView;
  seat: number;
  onStatus: (text: string) => void;
  onDone: () => Promise<void>;
}): ReactNode {
  const [minutes, setMinutes] = useState('');
  const [miles, setMiles] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    if (file === null) {
      setFields({ form: 'Upload a PDF, JPEG or PNG file.' });
      onStatus('Upload a PDF, JPEG or PNG file.');
      return;
    }
    setPending(true);
    setFields({});
    onStatus('Uploading…');
    const body = new FormData();
    body.append('actual_minutes', minutes);
    body.append('round_trip_miles', miles);
    body.append('form', file, file.name);
    try {
      await api.verify(assignment.number, seat, body);
      onStatus(`Verification for seat ${seat} received.`);
      await onDone();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'payload_too_large') {
        onStatus(`The file is larger than ${MAX_FORM_FILE_BYTES.toLocaleString('en-GB')} bytes.`);
      } else if (error instanceof ApiFailure && error.code === 'storage_unavailable') {
        onStatus('File storage is unavailable. Your form was not saved. Try again shortly.');
      } else if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        onStatus(
          error.fields['form'] === undefined
            ? 'Check the highlighted fields.'
            : 'Upload a PDF, JPEG or PNG file.',
        );
      } else {
        onStatus("Couldn't reach Teamseat. Try again shortly.");
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      aria-label={`Verify seat ${seat} on ${assignment.number}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field label="Actual minutes" error={fields['actual_minutes']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="number"
            min={1}
            max={960}
            aria-describedby={describedBy}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        )}
      </Field>
      <Field label="Round-trip miles" error={fields['round_trip_miles']}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="number"
            min={0}
            max={1000}
            aria-describedby={describedBy}
            value={miles}
            onChange={(event) => setMiles(event.target.value)}
          />
        )}
      </Field>
      <Field
        label="Signed verification form"
        hint="PDF, JPEG or PNG, up to 5,000,000 bytes"
        error={fields['form']}
      >
        {({ id, describedBy }) => (
          <input
            id={id}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            aria-describedby={describedBy}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        )}
      </Field>
      <button type="submit" className="btn btn--primary" disabled={pending}>
        Submit verification
      </button>
    </form>
  );
}
