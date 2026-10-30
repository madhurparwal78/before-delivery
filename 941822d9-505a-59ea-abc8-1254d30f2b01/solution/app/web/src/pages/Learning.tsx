import { useState } from "react";
import { api, type Enrolment, type User } from "../api";
import { ENROLMENT_LABELS, fundingLabel } from "../format";
import { Dialog, type CloseDialog } from "../ui/Dialog";
import { Alert, describeFailure, FieldError, useFeedback } from "../ui/feedback";
import { Empty } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";
import { continueTarget } from "./CoursePage";

export function ProgressBar({ label, percent }: { label: string; percent: number }) {
  return (
    <div className="progress">
      <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </div>
      <span className="fig">{percent}%</span>
    </div>
  );
}

function RefundRequest({ enrolment, close, onSent }: { enrolment: Enrolment; close: CloseDialog; onSent: () => void }) {
  const { announce } = useFeedback();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);

  const send = async () => {
    if (pending) return;
    setPending(true);
    try {
      await api("POST", `/api/enrolments/${enrolment.id}/refund-request`, { reason });
      announce("Refund requested. The nurse planner will review it.");
      close();
      onSent();
    } catch (error) {
      const failure = describeFailure(error);
      setFields(failure.fields);
      setAlert(failure.alert === null ? null : "This enrolment can't be refunded.");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="muted">
        Tell the nurse planner why you are asking for a refund for <strong>{enrolment.course_title}</strong>. The amount follows the provider's refund rule.
      </p>
      {alert && <Alert>{alert}</Alert>}
      <div className="field">
        <label htmlFor="refund-reason">Reason</label>
        <textarea
          id="refund-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={fields.reason ? true : undefined}
          aria-describedby={fields.reason ? "refund-reason-error" : undefined}
        />
        <FieldError id="refund-reason-error" message={fields.reason} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" data-primary="" className={`btn${pending ? " busy" : ""}`} disabled={pending} onClick={send}>
          {pending ? "Sending your request…" : "Send request"}
        </button>
      </div>
    </>
  );
}

export function Learning({ user }: { user: User }) {
  const { data, failure, reload } = useLoad(() => api<{ enrolments: Enrolment[] }>("GET", "/api/me/enrolments"));
  const [refunding, setRefunding] = useState<Enrolment | null>(null);
  const enrolments = data?.enrolments ?? null;
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{user.display_name}</p>
        <PageHeading>My learning</PageHeading>
        <p className="lede">Every course you're enrolled in, how far you've come and how it's funded.</p>
      </div>
      {failure && <Alert>{failure}</Alert>}
      <table className="data stacks" aria-label="Enrolments">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">State</th>
            <th scope="col">Progress</th>
            <th scope="col">Funding</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {enrolments?.map((e) => (
            <tr key={e.id}>
              <td className="course" data-label="Course">
                <Link to={`/courses/${e.course_id}`}>{e.course_title}</Link>
              </td>
              <td data-label="State">{ENROLMENT_LABELS[e.state]}</td>
              <td data-label="Progress">
                <ProgressBar label={`${e.course_title} progress`} percent={e.progress_percent} />
              </td>
              <td data-label="Funding">{fundingLabel(e, user)}</td>
              <td className="actions">
                <div className="row-actions">
                  {e.state === "confirmed" && (
                    <Link to={continueTarget(e)} className="btn secondary">
                      Continue
                    </Link>
                  )}
                  {(e.state === "confirmed" || e.state === "completed" || e.state === "certified") && (
                    <Link to={`/learn/${e.id}/seal`} className="btn secondary">
                      Your seal
                    </Link>
                  )}
                  {e.state === "confirmed" && e.funding !== "seat" && (
                    <button type="button" className="btn secondary" onClick={() => setRefunding(e)}>
                      Request refund
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {enrolments?.length === 0 && (
        <Empty>You aren't enrolled in any course yet. Choose one from the Courses catalogue.</Empty>
      )}
      {refunding && (
        <Dialog title="Request a refund" onClosed={() => setRefunding(null)}>
          {(close) => <RefundRequest enrolment={refunding} close={close} onSent={() => void reload()} />}
        </Dialog>
      )}
    </>
  );
}
