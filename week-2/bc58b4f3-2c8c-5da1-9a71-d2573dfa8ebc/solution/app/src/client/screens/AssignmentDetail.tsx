// The body of the assignment drawer: every field of the caller's view, the seats, the cancellation decision and
// the actions the role has for the assignment's current status.
import { useEffect, useState } from "react";
import { NetworkError, api } from "../api";
import { Field } from "../components/Field";
import { Modal } from "../components/Modal";
import { Status, type StatusMessage, quiet } from "../components/Status";
import { STATUS_LABELS, coveredCount, languageName, settingName } from "../labels";
import { formatDollars } from "../../shared/money";
import { agencyDate, agencyInputToIso, agencyTime, formatRange, formatStamp, hoursAndMinutes } from "../../shared/time";
import type { Assignment, Role } from "../types";

const CHANGEABLE = new Set(["draft", "released", "partially_covered", "covered"]);
const UNREACHABLE: StatusMessage = { tone: "error", text: "Couldn't reach Teamseat. Try again." };

interface Props {
  assignment: Assignment;
  role: Role;
  onChanged: (assignment: Assignment) => void;
}

export function AssignmentDetail({ assignment, role, onChanged }: Props) {
  const [releaseStatus, setReleaseStatus] = useState<StatusMessage>(quiet);
  const [releasing, setReleasing] = useState(false);
  const [changeStatus, setChangeStatus] = useState<StatusMessage>(quiet);
  const [cancelStatus, setCancelStatus] = useState<StatusMessage>(quiet);
  const [dialog, setDialog] = useState<"change" | "cancel" | null>(null);
  const a = assignment;
  const schedulerActions = role === "scheduler" && CHANGEABLE.has(a.status);

  const release = async () => {
    setReleasing(true);
    setReleaseStatus({ tone: "neutral", text: "Releasing…" });
    try {
      const result = await api<{ assignment: Assignment; offers_sent: number }>("POST", `/api/assignments/${a.number}/release`, {
        json: {},
      });
      if (result.ok) {
        onChanged(result.data.assignment);
        setReleaseStatus({
          tone: "success",
          text: `Released. Offers going out to ${result.data.offers_sent} qualified interpreters.`,
        });
      } else {
        setReleaseStatus({ tone: "error", text: "This request has already been released or closed." });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setReleaseStatus(UNREACHABLE);
    }
    setReleasing(false);
  };

  return (
    <div className="detail">
      <dl className="detail-facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status-word status-word-${a.status}`}>{STATUS_LABELS[a.status]}</span>
          </dd>
        </div>
        {a.org ? (
          <div>
            <dt>Organisation</dt>
            <dd>{a.org.name}</dd>
          </div>
        ) : null}
        <div>
          <dt>Language</dt>
          <dd>{languageName(a.language)}</dd>
        </div>
        <div>
          <dt>Setting</dt>
          <dd>{settingName(a.setting)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd className="num">{formatRange(a.start_at, a.end_at)}</dd>
        </div>
        <div>
          <dt>Duration</dt>
          <dd className="num">{a.duration_minutes} min</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>
            {a.street_address}
            <br />
            {a.city}
          </dd>
        </div>
        <div>
          <dt>Patient initials</dt>
          <dd>{a.patient_initials}</dd>
        </div>
        <div>
          <dt>Medical notes</dt>
          <dd>{a.medical_notes ? a.medical_notes : <span className="muted">None</span>}</dd>
        </div>
        <div>
          <dt>Scheduler</dt>
          <dd>
            {a.scheduler?.name}
            {a.scheduler?.phone ? <span className="num">, {a.scheduler.phone}</span> : null}
          </dd>
        </div>
      </dl>

      <section className="detail-seats" aria-label="Seats">
        <h3>
          Seats <span className="muted num">{`${coveredCount(a.seats)} of ${a.seats.length} covered`}</span>
        </h3>
        <ul className="seat-list">
          {a.seats.map((seat) => (
            <li key={seat.seat} className={`seat-row seat-row-${seat.status === "open" ? "open" : "held"}`}>
              <span className={`seat-swatch ${seat.status === "open" ? "swatch-open" : "swatch-held"}`} aria-hidden="true" />
              <span>Seat {seat.seat}</span>
              <span className="seat-holder">
                {seat.status === "open"
                  ? "open"
                  : `${seat.interpreter_name ?? seat.interpreter_initials ?? ""}${seat.status === "served" ? " (served)" : ""}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {a.cancellation ? (
        <section className="detail-decision" aria-label="Cancellation decision">
          <h3>Cancellation</h3>
          <p>
            Cancelled {formatStamp(a.cancellation.cancelled_at)} with{" "}
            <span className="num">{hoursAndMinutes(a.cancellation.business_minutes_notice)}</span> of business-hour notice.{" "}
            {a.cancellation.fee_applies ? (
              <strong>Late-cancellation fee: {formatDollars(a.cancellation.fee_cents)}.</strong>
            ) : (
              <strong>No fee.</strong>
            )}
          </p>
        </section>
      ) : null}

      <div className="detail-actions">
        {role === "dispatcher" && a.status === "draft" ? (
          <button type="button" className="button button-primary" onClick={() => void release()} disabled={releasing}>
            Release to interpreters
          </button>
        ) : null}
        {schedulerActions ? (
          <>
            <button type="button" className="button" onClick={() => setDialog("change")}>
              Change time
            </button>
            <button type="button" className="button button-danger" onClick={() => setDialog("cancel")}>
              Cancel request
            </button>
          </>
        ) : null}
      </div>
      {role === "dispatcher" ? <Status name="Release status" message={releaseStatus} /> : null}
      {role === "scheduler" ? (
        <>
          <Status name="Change status" message={dialog === "change" ? quiet : changeStatus} />
          <Status name="Cancellation status" message={dialog === "cancel" ? quiet : cancelStatus} />
        </>
      ) : null}

      {dialog === "change" ? (
        <ChangeTimeDialog
          assignment={a}
          onClose={() => setDialog(null)}
          onMoved={(moved) => {
            onChanged(moved);
            setChangeStatus({ tone: "success", text: `Request ${moved.number} moved. Seats reopened, no fee.` });
            setDialog(null);
          }}
        />
      ) : null}
      {dialog === "cancel" ? (
        <CancelDialog
          assignment={a}
          onClose={() => setDialog(null)}
          onCancelled={(cancelled) => {
            onChanged(cancelled);
            const fee = cancelled.cancellation;
            setCancelStatus({
              tone: "success",
              text: fee?.fee_applies
                ? `Request ${cancelled.number} cancelled. Fee: ${formatDollars(fee.fee_cents)}.`
                : `Request ${cancelled.number} cancelled. No fee.`,
            });
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function ChangeTimeDialog({
  assignment,
  onClose,
  onMoved,
}: {
  assignment: Assignment;
  onClose: () => void;
  onMoved: (assignment: Assignment) => void;
}) {
  const [date, setDate] = useState(agencyDate(assignment.start_at));
  const [time, setTime] = useState(agencyTime(assignment.start_at));
  const [duration, setDuration] = useState(String(assignment.duration_minutes));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<StatusMessage>(quiet);
  const [busy, setBusy] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setMessage({ tone: "neutral", text: "Saving…" });
    const minutes = /^\d+$/.test(duration.trim()) ? Number.parseInt(duration, 10) : duration;
    try {
      const result = await api<Assignment>("PATCH", `/api/assignments/${assignment.number}`, {
        json: { start_at: agencyInputToIso(date, time) ?? `${date}T${time}`, duration_minutes: minutes },
      });
      if (result.ok) {
        onMoved(result.data);
        return;
      }
      if (result.error.code === "late_change") {
        setMessage({ tone: "error", text: "Less than 48 business hours' notice. This request can only be cancelled now." });
      } else if (result.error.code === "validation") {
        setErrors(result.error.fields);
        setMessage({ tone: "error", text: `Check the highlighted fields. ${Object.values(result.error.fields).join(" ")}` });
      } else {
        setMessage({ tone: "error", text: "This request can no longer be changed." });
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(UNREACHABLE);
    }
    setBusy(false);
  };

  return (
    <Modal title={`Change time for ${assignment.number}`} onClose={onClose}>
      <p className="modal-lead">
        Moving or resizing frees every held seat and sends the request back out as an offer. No fee applies; a change
        needs at least 48 business hours of notice.
      </p>
      <form className="form" aria-label={`Change time for ${assignment.number}`} onSubmit={(event) => void save(event)}>
        <div className="form-row">
          <Field label="Date" hint="YYYY-MM-DD, Central">
            {(props) => (
              <input {...props} type="text" inputMode="numeric" placeholder="YYYY-MM-DD" value={date} onChange={(e) => setDate(e.target.value)} />
            )}
          </Field>
          <Field label="Start time" hint="HH:MM, 24-hour" error={errors.start_at}>
            {(props) => (
              <input {...props} type="text" inputMode="numeric" placeholder="HH:MM" value={time} onChange={(e) => setTime(e.target.value)} />
            )}
          </Field>
        </div>
        <Field label="Duration (minutes)" error={errors.duration_minutes}>
          {(props) => (
            <input {...props} type="number" min={30} max={480} step={15} value={duration} onChange={(e) => setDuration(e.target.value)} />
          )}
        </Field>
        <Status name="Change status" message={message} />
        <div className="modal-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            Save new time
          </button>
          <button type="button" className="button" onClick={onClose}>
            Keep current time
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface Quote {
  fee_applies: boolean;
  business_minutes_notice: number;
  fee_cents: number;
}

function CancelDialog({
  assignment,
  onClose,
  onCancelled,
}: {
  assignment: Assignment;
  onClose: () => void;
  onCancelled: (assignment: Assignment) => void;
}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [message, setMessage] = useState<StatusMessage>({ tone: "neutral", text: "Checking fee…" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api<Quote>("GET", `/api/assignments/${assignment.number}/cancellation-quote`)
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setMessage({ tone: "error", text: "This request can no longer be cancelled." });
          return;
        }
        setQuote(result.data);
        setMessage({
          tone: result.data.fee_applies ? "error" : "neutral",
          text: result.data.fee_applies
            ? `Cancelling now gives ${hoursAndMinutes(result.data.business_minutes_notice)} of business-hour notice, under 48 business hours. A late-cancellation fee of ${formatDollars(result.data.fee_cents)} applies.`
            : "Cancelling now gives at least 48 business hours of notice. No fee applies.",
        });
      })
      .catch(() => current && setMessage(UNREACHABLE));
    return () => {
      current = false;
    };
  }, [assignment.number]);

  const confirmCancellation = async () => {
    setBusy(true);
    setMessage({ tone: "neutral", text: "Cancelling…" });
    try {
      const result = await api<Assignment>("POST", `/api/assignments/${assignment.number}/cancel`, { json: {} });
      if (result.ok) {
        onCancelled(result.data);
        return;
      }
      setMessage({ tone: "error", text: "This request can no longer be cancelled." });
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      setMessage(UNREACHABLE);
    }
    setBusy(false);
  };

  return (
    <Modal title={`Cancel ${assignment.number}`} onClose={onClose}>
      <p className="modal-lead">
        {languageName(assignment.language)}, <span className="num">{formatRange(assignment.start_at, assignment.end_at)}</span>,{" "}
        {assignment.city}. The scheduler and every seat holder get one notice saying whether a fee applies.
      </p>
      <Status name="Cancellation status" message={message} className="status-boxed" />
      <div className="modal-actions">
        <button type="button" className="button button-danger" onClick={() => void confirmCancellation()} disabled={!quote || busy}>
          Confirm cancellation
        </button>
        <button type="button" className="button" onClick={onClose}>
          Keep request
        </button>
      </div>
    </Modal>
  );
}
