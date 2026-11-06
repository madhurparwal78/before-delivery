import { useEffect, useState, type ReactNode } from 'react';
import {
  ASSIGNMENT_STATUS_LABELS,
  LANGUAGE_NAMES,
  SETTING_LABELS,
  type AssignmentView,
  type Role,
} from '../../shared/contract.js';
import { CANCELLABLE_FROM, TIME_CHANGE_FROM } from '../../shared/transitions.js';
import {
  agencyDateString,
  agencyTimeString,
  formatAgencyRange,
  formatDollars,
  formatSpokenDuration,
} from '../../shared/zone.js';
import { ApiFailure, api } from '../api.js';
import { Dialog, Drawer, Field, StatusRegion, seatLabelOf } from '../ui.js';

function Fact({ term, children }: { term: string; children: ReactNode }): ReactNode {
  return (
    <>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

export function AssignmentDrawer({
  assignment,
  role,
  onClose,
  onChanged,
}: {
  assignment: AssignmentView;
  role: Role;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [releaseStatus, setReleaseStatus] = useState('');
  const [cancelStatus, setCancelStatus] = useState('');
  const [changeStatus, setChangeStatus] = useState('');
  const [releasing, setReleasing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  const start = new Date(assignment.start_at);
  const end = new Date(assignment.end_at);
  const isDispatcher = role === 'dispatcher';
  const canSchedule = role === 'scheduler';

  const release = async (): Promise<void> => {
    setReleasing(true);
    setReleaseStatus('Releasing…');
    try {
      const result = await api.release(assignment.number);
      setReleaseStatus(`Released. Offers going out to ${result.offers_sent} qualified interpreters.`);
      onChanged();
    } catch (error) {
      setReleaseStatus(
        error instanceof ApiFailure && error.status === 409
          ? 'This request has already been released or closed.'
          : "Couldn't reach Teamseat. Try again shortly.",
      );
    } finally {
      setReleasing(false);
    }
  };

  return (
    <Drawer title={`Assignment ${assignment.number}`} onClose={onClose}>
      <dl className="card__facts">
        <Fact term="Status">{ASSIGNMENT_STATUS_LABELS[assignment.status]}</Fact>
        <Fact term="Language">{LANGUAGE_NAMES[assignment.language] ?? assignment.language}</Fact>
        <Fact term="Setting">{SETTING_LABELS[assignment.setting]}</Fact>
        <Fact term="When">{formatAgencyRange(start, end)}</Fact>
        <Fact term="Length">
          <span className="num">{assignment.duration_minutes} min</span>
        </Fact>
        {assignment.org === undefined ? null : <Fact term="Organisation">{assignment.org.name}</Fact>}
        <Fact term="Address">
          {assignment.street_address}, {assignment.city}
        </Fact>
        <Fact term="Patient initials">{assignment.patient_initials}</Fact>
        <Fact term="Medical notes">
          {assignment.medical_notes === '' ? '—' : assignment.medical_notes}
        </Fact>
        <Fact term="Scheduler">
          {assignment.scheduler?.name} · {assignment.scheduler?.phone}
        </Fact>
      </dl>

      <h3>Seats</h3>
      <ul className="cards" aria-label={`Seats on ${assignment.number}`}>
        {assignment.seats.map((seat) => (
          <li key={seat.seat} className="card__seat">
            <div role="group" aria-label={`Seat ${seat.seat}`}>
              Seat {seat.seat}: {seatLabelOf(seat)}
              {seat.status === 'served' ? ' · verified' : ''}
            </div>
          </li>
        ))}
      </ul>

      {assignment.cancellation === null || assignment.cancellation === undefined ? null : (
        <p>
          Cancelled with{' '}
          <span className="num">
            {formatSpokenDuration(assignment.cancellation.business_minutes_notice)}
          </span>{' '}
          of business-hour notice.{' '}
          {assignment.cancellation.fee_applies
            ? `Fee: ${formatDollars(assignment.cancellation.fee_cents)}.`
            : 'No fee.'}
        </p>
      )}

      {assignment.billing === undefined || assignment.billing.status === 'none' ? null : (
        <p>
          Billing: {assignment.billing.status}
          {assignment.billing.total_cents === null
            ? ''
            : ` · ${formatDollars(assignment.billing.total_cents)}`}
          {assignment.billing.invoice_id === null
            ? ''
            : ` · invoice ${assignment.billing.invoice_id}`}
        </p>
      )}

      {isDispatcher ? (
        <>
          {assignment.status === 'draft' ? (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void release()}
              disabled={releasing}
            >
              Release to interpreters
            </button>
          ) : null}
          <StatusRegion name="Release status" text={releaseStatus} />
        </>
      ) : null}

      {canSchedule ? (
        <>
          <div className="dialog__actions">
            {TIME_CHANGE_FROM.includes(assignment.status) ? (
              <button type="button" className="btn" onClick={() => setChangeOpen(true)}>
                Change time
              </button>
            ) : null}
            {CANCELLABLE_FROM.includes(assignment.status) ? (
              <button type="button" className="btn" onClick={() => setCancelOpen(true)}>
                Cancel request
              </button>
            ) : null}
          </div>
          <StatusRegion name="Change status" text={changeStatus} />
          <StatusRegion name="Cancellation status" text={cancelStatus} />
        </>
      ) : null}

      {changeOpen ? (
        <ChangeTimeDialog
          assignment={assignment}
          onStatus={setChangeStatus}
          onClose={() => setChangeOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
      {cancelOpen ? (
        <CancelDialog
          assignment={assignment}
          onStatus={setCancelStatus}
          onClose={() => setCancelOpen(false)}
          onChanged={onChanged}
        />
      ) : null}
    </Drawer>
  );
}

function ChangeTimeDialog({
  assignment,
  onStatus,
  onClose,
  onChanged,
}: {
  assignment: AssignmentView;
  onStatus: (text: string) => void;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const start = new Date(assignment.start_at);
  const [date, setDate] = useState(agencyDateString(start));
  const [time, setTime] = useState(agencyTimeString(start));
  const [duration, setDuration] = useState(String(assignment.duration_minutes));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [inlineStatus, setInlineStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFields({});
    setInlineStatus('Saving…');
    onStatus('Saving…');
    try {
      await api.changeAssignment(assignment.number, {
        start_at: `${date}T${time}:00`,
        duration_minutes: Number(duration),
      });
      onStatus(`Request ${assignment.number} moved. Seats reopened, no fee.`);
      onChanged();
      onClose();
      return;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'late_change') {
        const message = "Less than 48 business hours' notice. This request can only be cancelled now.";
        setInlineStatus(message);
        onStatus(message);
      } else if (error instanceof ApiFailure && error.status === 422) {
        setFields(error.fields);
        setInlineStatus('Check the highlighted fields.');
        onStatus('Check the highlighted fields.');
      } else {
        const message = "Couldn't reach Teamseat. Your change is safe to send again.";
        setInlineStatus(message);
        onStatus(message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={`Change time for ${assignment.number}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Date" hint="YYYY-MM-DD, Central time" error={fields['start_at']}>
          {({ id, describedBy }) => (
            <input
              id={id}
              type="text"
              inputMode="numeric"
              aria-describedby={describedBy}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        <Field label="Start time" hint="HH:MM, Central time">
          {({ id, describedBy }) => (
            <input
              id={id}
              type="text"
              inputMode="numeric"
              aria-describedby={describedBy}
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          )}
        </Field>
        <Field label="Duration (minutes)" error={fields['duration_minutes']}>
          {({ id, describedBy }) => (
            <input
              id={id}
              type="number"
              min={30}
              max={480}
              step={15}
              aria-describedby={describedBy}
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          )}
        </Field>
        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={saving}>
            Save new time
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            Keep this time
          </button>
        </div>
      </form>
      <p className="status">{inlineStatus}</p>
    </Dialog>
  );
}

function CancelDialog({
  assignment,
  onStatus,
  onClose,
  onChanged,
}: {
  assignment: AssignmentView;
  onStatus: (text: string) => void;
  onClose: () => void;
  onChanged: () => void;
}): ReactNode {
  const [preview, setPreview] = useState('Checking fee…');
  const [ready, setReady] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let live = true;
    onStatus('Checking fee…');
    void api
      .cancellationQuote(assignment.number)
      .then((quote) => {
        if (!live) {
          return;
        }
        const text = quote.fee_applies
          ? `Cancelling now gives ${formatSpokenDuration(quote.business_minutes_notice)} of business-hour notice, under 48 business hours. A late-cancellation fee of ${formatDollars(quote.fee_cents)} applies.`
          : 'Cancelling now gives at least 48 business hours of notice. No fee applies.';
        setPreview(text);
        onStatus(text);
        setReady(true);
      })
      .catch(() => {
        if (live) {
          const text = "Couldn't reach Teamseat. Try again shortly.";
          setPreview(text);
          onStatus(text);
        }
      });
    return () => {
      live = false;
    };
  }, [assignment.number, onStatus]);

  const confirm = async (): Promise<void> => {
    setConfirming(true);
    onStatus('Cancelling…');
    try {
      const result = await api.cancel(assignment.number);
      const decision = result.cancellation;
      onStatus(
        decision !== null && decision !== undefined && decision.fee_applies
          ? `Request ${assignment.number} cancelled. Fee: ${formatDollars(decision.fee_cents)}.`
          : `Request ${assignment.number} cancelled. No fee.`,
      );
      onChanged();
      onClose();
    } catch (error) {
      onStatus(
        error instanceof ApiFailure && error.status === 409
          ? 'This request can no longer be cancelled.'
          : "Couldn't reach Teamseat. Try again shortly.",
      );
      setConfirming(false);
    }
  };

  return (
    <Dialog title={`Cancel ${assignment.number}`} onClose={onClose}>
      <p>{preview}</p>
      <div className="dialog__actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!ready || confirming}
          onClick={() => void confirm()}
        >
          Confirm cancellation
        </button>
        <button type="button" className="btn btn--quiet" onClick={onClose}>
          Keep request
        </button>
      </div>
    </Dialog>
  );
}
