import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LANGUAGES, SETTINGS, nameOf } from '../../shared/catalog';
import { formatDollars } from '../../shared/money';
import {
  ApiFailure,
  NetworkFailure,
  cancelAssignment,
  cancellationQuote,
  changeTime,
  createAssignment,
  listAssignments,
  type AssignmentView,
  type CurrentUser,
} from '../lib/api';
import { AllCoveredMark, SeatLane, StatusLabel, allCovered, coveredCount } from '../components/Seats';
import { Dialog, Drawer, LiveStatus } from '../components/Shell';
import {
  centralInstant,
  dateKey,
  hoursMinutesText,
  rangeText,
  timeText,
} from '../lib/format';
import { useSeatMotion, usePolling, type LaneView, type SeatGroup } from '../lib/hooks';

const CHANGEABLE = ['draft', 'released', 'partially_covered', 'covered'];

function laneGroups(assignments: AssignmentView[]): SeatGroup[] {
  return assignments.map((assignment) => ({
    key: assignment.number,
    seats: assignment.seats.map((seat) => ({
      seat: seat.seat,
      status: seat.status,
      initials: seat.interpreter_initials ?? null,
    })),
  }));
}

function RequestForm({ onCreated }: { onCreated: () => void }): ReactNode {
  const [language, setLanguage] = useState('');
  const [setting, setSetting] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [initials, setInitials] = useState('');
  const [notes, setNotes] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  const submit = (): void => {
    setPending(true);
    setStatus('Submitting…');
    setFields({});
    const instant = centralInstant(date, startTime);
    createAssignment(
      {
        language,
        setting,
        start_at: instant === null ? `${date} ${startTime}` : instant.toISOString(),
        duration_minutes: Number.parseInt(duration, 10),
        street_address: street,
        city,
        patient_initials: initials,
        medical_notes: notes,
      },
      idempotencyKey.current,
    )
      .then((assignment) => {
        setStatus(`Request ${assignment.number} submitted. Awaiting release by dispatch.`);
        idempotencyKey.current = crypto.randomUUID();
        setLanguage('');
        setSetting('');
        setDate('');
        setStartTime('');
        setDuration('60');
        setStreet('');
        setCity('');
        setInitials('');
        setNotes('');
        onCreated();
      })
      .catch((error: unknown) => {
        if (error instanceof NetworkFailure) {
          setStatus("Couldn't reach Teamseat. Your request is safe to submit again.");
          return;
        }
        if (error instanceof ApiFailure && error.code === 'validation') {
          setFields(error.fields);
          setStatus('Check the highlighted fields.');
          return;
        }
        if (error instanceof ApiFailure && error.code === 'idempotency_conflict') {
          setStatus('This request was already submitted with different details. Reload to see it.');
          return;
        }
        setStatus('Something went wrong. Try again.');
      })
      .finally(() => setPending(false));
  };

  const fieldError = (name: string): ReactNode =>
    fields[name] === undefined ? null : (
      <p className="field-error" id={`request-${name}-error`}>
        {fields[name]}
      </p>
    );

  const described = (name: string): { 'aria-describedby': string } | Record<string, never> =>
    fields[name] === undefined ? {} : { 'aria-describedby': `request-${name}-error` };

  return (
    <form
      noValidate
      aria-label="Request an interpreter"
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!pending) submit();
      }}
    >
      <h2>Request an interpreter</h2>
      <div className="field">
        <label htmlFor="request-language">Language</label>
        <select
          id="request-language"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          {...described('language')}
        >
          <option value="">Choose a language</option>
          {LANGUAGES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
        {fieldError('language')}
      </div>
      <div className="field">
        <label htmlFor="request-setting">Setting</label>
        <select
          id="request-setting"
          value={setting}
          onChange={(event) => setSetting(event.target.value)}
          {...described('setting')}
        >
          <option value="">Choose a setting</option>
          {SETTINGS.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
        {fieldError('setting')}
      </div>
      <div className="field">
        <label htmlFor="request-date">Date</label>
        <input
          id="request-date"
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          {...described('start_at')}
        />
      </div>
      <div className="field">
        <label htmlFor="request-start">Start time</label>
        <input
          id="request-start"
          type="text"
          inputMode="numeric"
          placeholder="HH:MM"
          value={startTime}
          onChange={(event) => setStartTime(event.target.value)}
          {...described('start_at')}
        />
        {fieldError('start_at')}
      </div>
      <div className="field">
        <label htmlFor="request-duration">Duration (minutes)</label>
        <input
          id="request-duration"
          type="number"
          min={30}
          max={480}
          step={15}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          {...described('duration_minutes')}
        />
        {fieldError('duration_minutes')}
      </div>
      <div className="field">
        <label htmlFor="request-street">Street address</label>
        <input
          id="request-street"
          type="text"
          value={street}
          onChange={(event) => setStreet(event.target.value)}
          {...described('street_address')}
        />
        {fieldError('street_address')}
      </div>
      <div className="field">
        <label htmlFor="request-city">City</label>
        <input
          id="request-city"
          type="text"
          value={city}
          onChange={(event) => setCity(event.target.value)}
          {...described('city')}
        />
        {fieldError('city')}
      </div>
      <div className="field">
        <label htmlFor="request-initials">Patient initials</label>
        <input
          id="request-initials"
          type="text"
          maxLength={3}
          value={initials}
          onChange={(event) => setInitials(event.target.value.toUpperCase())}
          {...described('patient_initials')}
        />
        {fieldError('patient_initials')}
      </div>
      <div className="field">
        <label htmlFor="request-notes">Medical notes</label>
        <textarea
          id="request-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          {...described('medical_notes')}
        />
        {fieldError('medical_notes')}
      </div>
      <button type="submit" className="primary" disabled={pending}>
        Submit request
      </button>
      <LiveStatus name="Request status" message={status} />
    </form>
  );
}

function ChangeTimeDialog({
  assignment,
  onClose,
  onChanged,
}: {
  assignment: AssignmentView;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [date, setDate] = useState(dateKey(assignment.start_at));
  const [start, setStart] = useState(timeText(assignment.start_at));
  const [duration, setDuration] = useState(String(assignment.duration_minutes));
  const [status, setStatus] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  return (
    <Dialog title={`Change time for ${assignment.number}`} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setStatus('Saving…');
          setFields({});
          const instant = centralInstant(date, start);
          changeTime(assignment.number, {
            start_at: instant === null ? `${date} ${start}` : instant.toISOString(),
            duration_minutes: Number.parseInt(duration, 10),
          })
            .then(() => {
              setStatus(`Request ${assignment.number} moved. Seats reopened, no fee.`);
              onChanged();
            })
            .catch((error: unknown) => {
              if (error instanceof ApiFailure && error.code === 'late_change') {
                setStatus("Less than 48 business hours' notice. This request can only be cancelled now.");
                return;
              }
              if (error instanceof ApiFailure && error.code === 'validation') {
                setFields(error.fields);
                setStatus('Check the highlighted fields.');
                return;
              }
              setStatus('This request can no longer change that way.');
            })
            .finally(() => setPending(false));
        }}
      >
        <div className="field">
          <label htmlFor="change-date">Date</label>
          <input
            id="change-date"
            type="text"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="change-start">Start time</label>
          <input
            id="change-start"
            type="text"
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
          {fields['start_at'] === undefined ? null : (
            <p className="field-error">{fields['start_at']}</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="change-duration">Duration (minutes)</label>
          <input
            id="change-duration"
            type="number"
            min={30}
            max={480}
            step={15}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
          {fields['duration_minutes'] === undefined ? null : (
            <p className="field-error">{fields['duration_minutes']}</p>
          )}
        </div>
        <div className="row-actions">
          <button type="submit" className="primary" disabled={pending}>
            Save new time
          </button>
          <button type="button" className="quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <LiveStatus name="Change status" message={status} />
      </form>
    </Dialog>
  );
}

function CancelDialog({
  assignment,
  onClose,
  onCancelled,
}: {
  assignment: AssignmentView;
  onClose: () => void;
  onCancelled: () => void;
}): ReactNode {
  const [status, setStatus] = useState('Checking fee…');
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    cancellationQuote(assignment.number)
      .then((quote) => {
        setStatus(
          quote.fee_applies
            ? `Cancelling now gives ${hoursMinutesText(quote.business_minutes_notice)} of business-hour notice, under 48 business hours. A late-cancellation fee of ${formatDollars(quote.fee_cents)} applies.`
            : 'Cancelling now gives at least 48 business hours of notice. No fee applies.',
        );
        setReady(true);
      })
      .catch(() => setStatus('This request can no longer be cancelled.'));
  }, [assignment.number]);

  return (
    <Dialog title={`Cancel ${assignment.number}`} onClose={onClose}>
      <p>
        {assignment.number} · {rangeText(assignment.start_at, assignment.end_at)}
      </p>
      <LiveStatus name="Cancellation status" message={status} />
      <div className="row-actions">
        <button
          type="button"
          className="primary"
          disabled={!ready || pending}
          onClick={() => {
            setPending(true);
            setStatus('Cancelling…');
            cancelAssignment(assignment.number)
              .then((updated) => {
                const fee = updated.cancellation;
                setStatus(
                  fee?.fee_applies === true
                    ? `Request ${updated.number} cancelled. Fee: ${formatDollars(fee.fee_cents)}.`
                    : `Request ${updated.number} cancelled. No fee.`,
                );
                onCancelled();
              })
              .catch(() => setStatus('This request can no longer be cancelled.'))
              .finally(() => setPending(false));
          }}
        >
          Confirm cancellation
        </button>
        <button type="button" className="quiet" onClick={onClose}>
          Keep request
        </button>
      </div>
    </Dialog>
  );
}

function AssignmentDetail({
  assignment,
  lanes,
  canAct,
  onClose,
  onRefresh,
}: {
  assignment: AssignmentView;
  lanes: LaneView[];
  canAct: boolean;
  onClose: () => void;
  onRefresh: () => void;
}): ReactNode {
  const [dialog, setDialog] = useState<'none' | 'change' | 'cancel'>('none');
  const changeable = canAct && CHANGEABLE.includes(assignment.status);

  return (
    <>
      <Drawer title={`Assignment ${assignment.number}`} onClose={onClose}>
        <dl className="detail-list">
          <dt>Status</dt>
          <dd>
            <StatusLabel status={assignment.status} />
          </dd>
          <dt>Language</dt>
          <dd>{nameOf(LANGUAGES, assignment.language)}</dd>
          <dt>Setting</dt>
          <dd>{nameOf(SETTINGS, assignment.setting)}</dd>
          <dt>When</dt>
          <dd>{rangeText(assignment.start_at, assignment.end_at)}</dd>
          <dt>Duration</dt>
          <dd>
            <span className="numeral">{assignment.duration_minutes}</span> min
          </dd>
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
        <h3>Seats</h3>
        <div className="card-lanes">
          {lanes.map((lane) => (
            <div className="card-lane-row" key={lane.seat}>
              <span>Seat {lane.seat}</span>
              <SeatLane lane={lane} />
            </div>
          ))}
        </div>
        <p>
          {coveredCount(lanes)} {allCovered(lanes) ? <AllCoveredMark /> : null}
        </p>
        {assignment.cancellation == null ? null : (
          <>
            <h3>Cancellation</h3>
            <p>
              {assignment.cancellation.fee_applies
                ? `Late cancellation. Fee: ${formatDollars(assignment.cancellation.fee_cents)}.`
                : 'Cancelled with at least 48 business hours of notice. No fee.'}{' '}
              Notice: <span className="numeral">
                {hoursMinutesText(assignment.cancellation.business_minutes_notice)}
              </span>{' '}
              of business-hour notice.
            </p>
          </>
        )}
        {changeable ? (
          <div className="row-actions">
            <button type="button" onClick={() => setDialog('change')}>
              Change time
            </button>
            <button type="button" onClick={() => setDialog('cancel')}>
              Cancel request
            </button>
          </div>
        ) : null}
      </Drawer>
      {dialog === 'change' ? (
        <ChangeTimeDialog
          assignment={assignment}
          onClose={() => setDialog('none')}
          onChanged={onRefresh}
        />
      ) : null}
      {dialog === 'cancel' ? (
        <CancelDialog
          assignment={assignment}
          onClose={() => setDialog('none')}
          onCancelled={onRefresh}
        />
      ) : null}
    </>
  );
}

export function Requests({ user }: { user: CurrentUser }): ReactNode {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const { data, refresh } = usePolling(() => listAssignments(search), [search]);
  const assignments = useMemo(() => data?.assignments ?? [], [data]);
  const groups = useMemo(() => laneGroups(assignments), [assignments]);
  const { lanes } = useSeatMotion(groups, {});
  const current = assignments.find((assignment) => assignment.number === open) ?? null;

  return (
    <main className="sheet">
      <h1>Requests</h1>
      <div className="grid-12">
        {user.role === 'scheduler' ? (
          <div className="col-4">
            <RequestForm onCreated={refresh} />
          </div>
        ) : null}
        <div className={user.role === 'scheduler' ? 'col-8' : 'col-12'}>
          <div className="panel">
            <h2>{user.org?.name ?? 'Organisation'} requests</h2>
            <div className="field">
              <label htmlFor="request-search">Search requests</label>
              <input
                id="request-search"
                type="search"
                aria-label="Search requests"
                placeholder="Assignment number or city"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <table aria-label="Requests" className="stacked-table">
              <caption>
                {assignments.length === 0
                  ? 'No requests yet.'
                  : `${assignments.length} request${assignments.length === 1 ? '' : 's'}`}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Language</th>
                  <th scope="col">Setting</th>
                  <th scope="col">When (Central)</th>
                  <th scope="col">Seats</th>
                  <th scope="col">Status</th>
                  <th scope="col">Open</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => {
                  const rowLanes = lanes.get(assignment.number) ?? [];
                  return (
                    <tr key={assignment.number}>
                      <td data-label="Number" className="numeral">
                        {assignment.number}
                      </td>
                      <td data-label="Language">{nameOf(LANGUAGES, assignment.language)}</td>
                      <td data-label="Setting">{nameOf(SETTINGS, assignment.setting)}</td>
                      <td data-label="When">{rangeText(assignment.start_at, assignment.end_at)}</td>
                      <td data-label="Seats">
                        <div className="card-lanes">
                          {rowLanes.map((lane) => (
                            <SeatLane key={lane.seat} lane={lane} />
                          ))}
                        </div>
                        <span>
                          {coveredCount(rowLanes)} {allCovered(rowLanes) ? <AllCoveredMark /> : null}
                        </span>
                      </td>
                      <td data-label="Status">
                        <StatusLabel status={assignment.status} />
                      </td>
                      <td data-label="Open">
                        <button
                          type="button"
                          aria-label={`Open ${assignment.number}`}
                          onClick={(event) => {
                            opener.current = event.currentTarget;
                            setOpen(assignment.number);
                          }}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {current === null ? null : (
        <AssignmentDetail
          assignment={current}
          lanes={lanes.get(current.number) ?? []}
          canAct={user.role === 'scheduler'}
          onClose={() => {
            setOpen(null);
            opener.current?.focus();
          }}
          onRefresh={refresh}
        />
      )}
    </main>
  );
}
