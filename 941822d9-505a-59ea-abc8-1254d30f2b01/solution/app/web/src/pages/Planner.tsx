import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, type Certificate, type Course, type CourseState, type RefundRequest } from "../api";
import { closeLine, formatLabel, instantDate, monDYyyy, STATE_LABELS } from "../format";
import { Dialog, type CloseDialog } from "../ui/Dialog";
import { Alert, describeFailure, FieldError, useFeedback, WITHDRAWN_COPY } from "../ui/feedback";
import { Empty, Icon } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";

const STALE_COPY = "Someone else saved this course a moment ago. Reload to see their changes before saving again.";

/** The copy for a refused course save or transition. */
export function courseFailure(error: unknown): { alert: string | null; fields: Record<string, string> } {
  if (error instanceof ApiFailure && error.code === "invalid_transition") {
    const from = STATE_LABELS[error.body.from as CourseState] ?? String(error.body.from);
    const to = STATE_LABELS[error.body.to as CourseState] ?? String(error.body.to);
    return { alert: `This course can't move from ${from} to ${to}.`, fields: {} };
  }
  return describeFailure(error, { stale_version: STALE_COPY, course_not_editable: "This course can't be edited in its current state." });
}

const REFUND_COPY: Record<string, string> = {
  payments_unavailable: "Payments are unavailable right now. Nothing was refunded. Try again in a few minutes.",
  already_certified: "This nurse has finished the course, so no refund is due.",
  request_closed: "This refund request has already been decided.",
};

const CERTIFICATE_COPY: Record<string, string> = {
  invalid_transition: "Only a sealed certificate can be reissued or revoked.",
  reissue_pending: "A reissue for this certificate is still being stored.",
};

function ReviewQueue({ courses, onChanged }: { courses: Course[]; onChanged: () => Promise<unknown> }) {
  const { announce, showAlert } = useFeedback();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  const move = async (course: Course, to: CourseState) => {
    if (pending) return;
    setPending(`${course.id}:${to}`);
    showAlert(null);
    try {
      const note = notes[course.id]?.trim();
      await api("POST", `/api/courses/${course.id}/transitions`, to === "draft" ? { to, note: note ?? "" } : { to }, { "If-Match": `"${course.version}"` });
      setErrors((e) => ({ ...e, [course.id]: "" }));
      setNotes((n) => ({ ...n, [course.id]: "" }));
      announce(`Course moved to ${STATE_LABELS[to]}.`);
      await onChanged();
    } catch (error) {
      const failure = courseFailure(error);
      setErrors((e) => ({ ...e, [course.id]: failure.fields.note ?? "" }));
      showAlert(failure.alert);
    } finally {
      setPending(null);
    }
  };

  const busy = (course: Course, to: CourseState, idle: string) => (pending === `${course.id}:${to}` ? "Saving…" : idle);
  const inReview = courses.filter((c) => c.state === "in_review");
  const published = courses.filter((c) => c.state === "published");
  return (
    <>
      <table className="data stacks" aria-label="Courses in review">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Author</th>
            <th scope="col">Note to author</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {inReview.map((c) => (
            <tr key={c.id}>
              <td className="course" data-label="Course">
                <Link to={`/courses/${c.id}`}>{c.title}</Link>
                <span className="hint"> · version {c.version}</span>
              </td>
              <td data-label="Author">{c.author.display_name}</td>
              <td data-label="Note">
                <label className="sr-only" htmlFor={`note-${c.id}`}>
                  Note to author
                </label>
                <textarea
                  id={`note-${c.id}`}
                  rows={2}
                  value={notes[c.id] ?? ""}
                  onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                  aria-invalid={errors[c.id] ? true : undefined}
                  aria-describedby={errors[c.id] ? `note-${c.id}-error` : undefined}
                  style={{ minHeight: "var(--tap)" }}
                />
                <FieldError id={`note-${c.id}-error`} message={errors[c.id]} />
              </td>
              <td className="actions">
                <div className="row-actions">
                  <button type="button" className="btn" disabled={pending !== null} onClick={() => void move(c, "published")}>
                    {busy(c, "published", "Approve and publish")}
                  </button>
                  <button type="button" className="btn secondary" disabled={pending !== null} onClick={() => void move(c, "draft")}>
                    {busy(c, "draft", "Return to author")}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {inReview.length === 0 && <Empty>No course is waiting for review.</Empty>}
      <h3 className="label" style={{ fontSize: "19.2px", margin: "var(--s5) 0 var(--s3)" }}>
        Published courses
      </h3>
      <table className="data stacks" aria-label="Published courses">
        <tbody>
          {published.map((c) => (
            <tr key={c.id}>
              <td className="course" data-label="Course">
                <Link to={`/courses/${c.id}`}>{c.title}</Link>
              </td>
              <td data-label="Format">{formatLabel(c.format)}</td>
              <td className="fig" data-label="Contact hours">
                {c.contact_hours} h
              </td>
              <td className="actions">
                <button type="button" className="btn secondary" disabled={pending !== null} onClick={() => void move(c, "withdrawn")}>
                  {busy(c, "withdrawn", "Withdraw course")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function NewCohort({ course, close, onSaved }: { course: Course; close: CloseDialog; onSaved: () => void }) {
  const { announce } = useFeedback();
  const [values, setValues] = useState({ name: "", seatCap: "", startsOn: "", closeDate: "" });
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: event.target.value }));

  const create = async () => {
    if (pending) return;
    setPending(true);
    setAlert(null);
    try {
      await api("POST", `/api/courses/${course.id}/cohorts`, {
        name: values.name,
        seat_cap: /^\d+$/.test(values.seatCap) ? parseInt(values.seatCap, 10) : values.seatCap,
        starts_on: values.startsOn,
        close_date: values.closeDate,
      });
      announce("Cohort saved.");
      close();
      onSaved();
    } catch (error) {
      const failure = describeFailure(error, { course_not_open: WITHDRAWN_COPY });
      setFields(failure.fields);
      setAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  const field = (id: string, label: string, key: keyof typeof values, error: string, type = "text") => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        inputMode={type === "text" && key !== "name" ? "numeric" : undefined}
        placeholder={key === "startsOn" || key === "closeDate" ? "YYYY-MM-DD" : undefined}
        value={values[key]}
        onChange={set(key)}
        aria-invalid={fields[error] ? true : undefined}
        aria-describedby={fields[error] ? `${id}-error` : undefined}
      />
      <FieldError id={`${id}-error`} message={fields[error]} />
    </div>
  );

  return (
    <>
      <p className="muted">{course.title}</p>
      {alert && <Alert>{alert}</Alert>}
      {field("cohort-name", "Cohort name", "name", "name")}
      {field("cohort-cap", "Seat cap", "seatCap", "seat_cap", "number")}
      {field("cohort-starts", "Starts on", "startsOn", "starts_on")}
      {field("cohort-closes", "Enrolment closes on", "closeDate", "close_date")}
      <p className="hint">Enrolment closes at 11:59 PM Central Time on that date.</p>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" data-primary="" className={`btn${pending ? " busy" : ""}`} disabled={pending} onClick={create}>
          {pending ? "Saving…" : "Create cohort"}
        </button>
      </div>
    </>
  );
}

function Cohorts({ cohortCourses, onChanged }: { cohortCourses: Course[]; onChanged: () => void }) {
  const [creating, setCreating] = useState<Course | null>(null);
  return (
    <>
      <table className="data stacks" aria-label="Cohort courses">
        <thead>
          <tr>
            <th scope="col">Course</th>
            <th scope="col">Cohorts</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cohortCourses.map((c) => (
            <tr key={c.id}>
              <td className="course" data-label="Course">
                {c.title}
              </td>
              <td data-label="Cohorts">
                <ul className="ruled" style={{ borderTop: "none" }}>
                  {(c.cohorts ?? []).map((cohort) => (
                    <li key={cohort.id} style={{ padding: "var(--s2) 0" }}>
                      <Link to={`/planner/cohorts/${cohort.id}`}>{cohort.name}</Link>
                      <div className="hint">
                        Starts {monDYyyy(cohort.starts_on)} · {closeLine(cohort.close_date)} · <span className="fig">{cohort.seats_remaining}</span> of{" "}
                        <span className="fig">{cohort.seat_cap}</span> seats remaining
                      </div>
                    </li>
                  ))}
                  {(c.cohorts ?? []).length === 0 && <li className="muted">No cohorts yet.</li>}
                </ul>
              </td>
              <td className="actions">
                <button type="button" className="btn secondary" onClick={() => setCreating(c)}>
                  <Icon name="plus" />
                  New cohort
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating && (
        <Dialog title="New cohort" onClosed={() => setCreating(null)}>
          {(close) => <NewCohort course={creating} close={close} onSaved={onChanged} />}
        </Dialog>
      )}
    </>
  );
}

function Refunds({ requests, onChanged }: { requests: RefundRequest[]; onChanged: () => Promise<unknown> }) {
  const { announce, showAlert } = useFeedback();
  const [pending, setPending] = useState<string | null>(null);

  const decide = async (request: RefundRequest, decision: "approve" | "decline") => {
    if (pending) return;
    setPending(`${request.id}:${decision}`);
    showAlert(null);
    try {
      const body = await api<{ refund_request: RefundRequest }>("POST", `/api/refund-requests/${request.id}/${decision}`, {});
      announce(decision === "approve" ? `Refund of $${body.refund_request.refund_total} recorded.` : "Refund declined.");
    } catch (error) {
      showAlert(describeFailure(error, REFUND_COPY).alert);
    } finally {
      await onChanged();
      setPending(null);
    }
  };

  return (
    <>
      <table className="data stacks" aria-label="Refund queue">
        <thead>
          <tr>
            <th scope="col">Nurse</th>
            <th scope="col">Course</th>
            <th scope="col">Reason</th>
            <th scope="col">Refund</th>
            <th scope="col">Decision</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td data-label="Nurse">
                {r.nurse_name}
                <div className="hint" style={{ whiteSpace: "nowrap" }}>Requested {instantDate(r.requested_at)}</div>
              </td>
              <td className="course" data-label="Course">
                {r.course_title}
              </td>
              <td data-label="Reason">{r.reason}</td>
              <td data-label="Refund">
                <span className="fig">Refund due ${r.refund_total}</span>
                <div className="hint fig" style={{ textAlign: "left" }}>
                  Hospital ${r.employer_refund} · Nurse ${r.learner_refund}
                </div>
              </td>
              <td data-label="Decision">
                {r.state === "pending" || !r.decided_by || !r.decided_at ? (
                  <div className="row-actions">
                    <button type="button" className="btn" disabled={pending !== null} onClick={() => void decide(r, "approve")}>
                      {pending === `${r.id}:approve` ? "Recording the refund…" : "Approve refund"}
                    </button>
                    <button type="button" className="btn secondary" disabled={pending !== null} onClick={() => void decide(r, "decline")}>
                      {pending === `${r.id}:decline` ? "Saving…" : "Decline refund"}
                    </button>
                  </div>
                ) : (
                  <span>{`${r.state === "approved" ? "Approved" : "Declined"} by ${r.decided_by.display_name} on ${instantDate(r.decided_at)}`}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {requests.length === 0 && <Empty>No refund requests yet.</Empty>}
    </>
  );
}

function Decide({ certificate, action, close, onDone }: { certificate: Certificate; action: "reissue" | "revoke"; close: CloseDialog; onDone: () => void }) {
  const { announce } = useFeedback();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [alert, setAlert] = useState<string | null>(null);

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setAlert(null);
    try {
      const body = await api<{ certificate: Certificate }>("POST", `/api/certificates/${certificate.id}/${action}`, { reason });
      const after = body.certificate;
      announce(
        action === "revoke"
          ? "Certificate revoked."
          : after.reissue_pending
            ? "Reissue recorded. The new PDF is still being stored."
            : `Certificate reissued as version ${after.version}.`,
      );
      close();
      onDone();
    } catch (error) {
      const failure = describeFailure(error, CERTIFICATE_COPY);
      setFields(failure.fields);
      setAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <p className="muted">
        {certificate.serial} · {certificate.nurse_name} · {certificate.course_title}
      </p>
      <p>
        {action === "reissue"
          ? "A reissue keeps the serial, hours and issue date, prints the nurse's current name on a new PDF version and emails the nurse once."
          : "Revoking keeps the certificate on the nurse's transcript as Revoked. Its verification page will show the revoked status."}
      </p>
      {alert && <Alert>{alert}</Alert>}
      <div className="field">
        <label htmlFor="decision-reason">Reason</label>
        <textarea id="decision-reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fields.reason ? true : undefined} aria-describedby={fields.reason ? "decision-reason-error" : undefined} />
        <FieldError id="decision-reason-error" message={fields.reason} />
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        <button type="button" data-primary="" className={`btn${pending ? " busy" : ""}`} disabled={pending} onClick={confirm}>
          {pending ? (action === "reissue" ? "Reissuing…" : "Revoking…") : action === "reissue" ? "Confirm reissue" : "Confirm revoke"}
        </button>
      </div>
    </>
  );
}

const CERT_STATUS: Record<Certificate["state"], string> = { sealing: "Pending", sealed: "Sealed", revoked: "Revoked" };

function Certificates() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Certificate[] | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deciding, setDeciding] = useState<{ certificate: Certificate; action: "reissue" | "revoke" } | null>(null);
  const serial = useRef(0);

  const search = async (text: string) => {
    const mine = ++serial.current;
    try {
      const body = await api<{ certificates: Certificate[] }>("GET", `/api/planner/certificates?q=${encodeURIComponent(text)}`);
      if (mine !== serial.current) return;
      setResults(body.certificates);
      setError(undefined);
    } catch (failure) {
      if (mine !== serial.current) return;
      const copy = describeFailure(failure);
      setError(copy.fields.q ?? copy.alert ?? undefined);
    }
  };

  useEffect(() => {
    const id = window.setTimeout(() => void search(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  return (
    <>
      <div className="field" style={{ maxWidth: "420px", marginBottom: "var(--s4)" }}>
        <label htmlFor="certificate-search">Search certificates</label>
        <input
          id="certificate-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void search(query);
            }
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "certificate-search-error" : "certificate-search-hint"}
        />
        <p id="certificate-search-hint" className="hint">
          Serial, or any name the nurse has held.
        </p>
        <FieldError id="certificate-search-error" message={error} />
      </div>
      <table className="data stacks" aria-label="Certificate results">
        <thead>
          <tr>
            <th scope="col">Serial</th>
            <th scope="col">Nurse</th>
            <th scope="col">Course</th>
            <th scope="col" className="fig">
              Hours
            </th>
            <th scope="col">Status</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {results?.map((c) => (
            <tr key={c.id}>
              <td data-label="Serial">{c.serial}</td>
              <td data-label="Nurse">
                {c.nurse_name}
                <div className="hint">Version {c.version}</div>
              </td>
              <td data-label="Course">{c.course_title}</td>
              <td className="fig" data-label="Hours">
                {c.contact_hours}
              </td>
              <td data-label="Status">
                {CERT_STATUS[c.state]}
                {c.issued_on && <div className="hint">Issued {monDYyyy(c.issued_on)}</div>}
                {c.reissue_pending && <div className="hint">Reissue being stored</div>}
              </td>
              <td className="actions">
                {c.state === "sealed" && !c.reissue_pending && (
                  <div className="row-actions">
                    <button type="button" className="btn secondary" onClick={() => setDeciding({ certificate: c, action: "reissue" })}>
                      Reissue
                    </button>
                    <button type="button" className="btn secondary" onClick={() => setDeciding({ certificate: c, action: "revoke" })}>
                      Revoke
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {results?.length === 0 && <Empty>No certificates match that search.</Empty>}
      {deciding && (
        <Dialog title={deciding.action === "reissue" ? "Reissue certificate" : "Revoke certificate"} onClosed={() => setDeciding(null)}>
          {(close) => <Decide certificate={deciding.certificate} action={deciding.action} close={close} onDone={() => void search(query)} />}
        </Dialog>
      )}
    </>
  );
}

interface PlannerData {
  courses: Course[];
  cohortCourses: Course[];
  refunds: RefundRequest[];
}

export function Planner() {
  const page = useLoad<PlannerData>(async () => {
    const [{ courses }, { refund_requests: refunds }] = await Promise.all([
      api<{ courses: Course[] }>("GET", "/api/courses"),
      api<{ refund_requests: RefundRequest[] }>("GET", "/api/refund-requests"),
    ]);
    const cohortCourses = await Promise.all(
      courses.filter((c) => c.format === "cohort" && c.state === "published").map(async (c) => (await api<{ course: Course }>("GET", `/api/courses/${c.id}`)).course),
    );
    return { courses, cohortCourses, refunds };
  });
  const data = page.data;
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Accreditation</p>
        <PageHeading>Planner</PageHeading>
        <p className="lede">Release courses, run capped cohorts, decide refunds and keep every certificate correct.</p>
      </div>
      {page.failure && <Alert>{page.failure}</Alert>}
      {data ? (
        <>
          <section className="section" aria-labelledby="review-heading" style={{ marginTop: 0 }}>
            <div className="section-head">
              <h2 id="review-heading">Review queue</h2>
            </div>
            <ReviewQueue courses={data.courses} onChanged={page.reload} />
          </section>
          <section className="section" aria-labelledby="cohorts-heading">
            <div className="section-head">
              <h2 id="cohorts-heading">Cohorts</h2>
            </div>
            <Cohorts cohortCourses={data.cohortCourses} onChanged={() => void page.reload()} />
          </section>
          <section className="section" aria-labelledby="refunds-heading">
            <div className="section-head">
              <h2 id="refunds-heading">Refund requests</h2>
            </div>
            <Refunds requests={data.refunds} onChanged={page.reload} />
          </section>
          <section className="section" aria-labelledby="certificates-heading">
            <div className="section-head">
              <h2 id="certificates-heading">Certificates</h2>
            </div>
            <Certificates />
          </section>
        </>
      ) : (
        !page.failure && <p aria-busy="true" className="muted">Loading the planner…</p>
      )}
    </>
  );
}
