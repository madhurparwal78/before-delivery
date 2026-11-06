import { useEffect, useRef, useState } from "react";
import { api, ApiFailure, newIdempotencyKey, type Certificate, type Cohort, type Course, type Enrolment, type Quote, type User } from "../api";
import { closeLine, formatLabel, monDYyyy } from "../format";
import { Seal, type SealState } from "../seal/Seal";
import { Dialog, type CloseDialog } from "../ui/Dialog";
import { Alert, describeFailure, FieldError, useFeedback, WITHDRAWN_COPY } from "../ui/feedback";
import { StatusGlyph } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";

const CHECKOUT_COPY: Record<string, string> = {
  course_not_open: WITHDRAWN_COPY,
  cohort_full: "The last seat was just taken. Join the waitlist to hold your place in line.",
  enrolment_closed: "Enrolment for this cohort has closed.",
  already_enrolled: "You're already enrolled in this course.",
  payments_unavailable: "Payments are unavailable right now. You have not been charged. Try again in a few minutes.",
};

const WAITLIST_COPY: Record<string, string> = {
  seats_available: "A seat is open again. Choose Enrol to take it.",
  enrolment_closed: CHECKOUT_COPY.enrolment_closed ?? "",
  already_enrolled: CHECKOUT_COPY.already_enrolled ?? "",
};

interface PageData {
  course: Course;
  enrolment: Enrolment | null;
  certificate: Certificate | null;
}

/** Where "Continue learning" leads: the first unverified lesson, then the post-evaluation, then the seal. */
export function continueTarget(enrolment: Enrolment): string {
  const lesson = enrolment.modules.find((m) => m.kind === "lesson" && m.status === "unverified");
  if (lesson) return `/learn/${enrolment.id}/${lesson.id}`;
  if (enrolment.modules.some((m) => m.kind === "evaluation" && m.status === "unverified")) return `/learn/${enrolment.id}/evaluation`;
  return `/learn/${enrolment.id}/seal`;
}

export const sealStateOf = (certificate: Certificate | null): SealState =>
  certificate === null ? "open" : certificate.state === "sealing" ? "pending" : certificate.state;

const OPEN_STATES = new Set(["held", "confirmed", "completed", "certified"]);

function Checkout({ course, cohort, close, onEnrolled }: { course: Course; cohort: Cohort | null; close: CloseDialog; onEnrolled: () => void }) {
  const { announce } = useFeedback();
  const [quote, setQuote] = useState<Quote | null>(null);
  const key = useRef(newIdempotencyKey());
  const [pending, setPending] = useState<"pay" | "join" | "leave" | null>(null);
  const [alert, setAlert] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [full, setFull] = useState(false);
  const [onWaitlist, setOnWaitlist] = useState(false);
  const payRef = useRef<HTMLButtonElement>(null);
  const focusPay = useRef(true);

  useEffect(() => {
    api<Quote>("GET", `/api/checkout/quote?course_id=${encodeURIComponent(course.id)}`).then(
      (next) => setQuote(next),
      (error: unknown) => setAlert(describeFailure(error, CHECKOUT_COPY).alert),
    );
  }, [course.id]);

  useEffect(() => {
    if (quote && focusPay.current && payRef.current) {
      focusPay.current = false;
      payRef.current.focus();
    }
  }, [quote]);

  const pay = async () => {
    if (!quote || pending) return;
    setPending("pay");
    setAlert(null);
    try {
      await api(
        "POST",
        "/api/checkout",
        { course_id: course.id, cohort_id: cohort?.id ?? null, quoted_learner_share: quote.learner_share },
        { "Idempotency-Key": key.current },
      );
      announce(`You're enrolled in ${course.title}.`);
      close({ returnFocus: false });
      onEnrolled();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === "quote_changed") {
        const next = error.body.quote as Quote;
        key.current = newIdempotencyKey();
        focusPay.current = true;
        setQuote(next);
        setAlert(`The price changed while you were checking out. Your share is now $${next.learner_share}.`);
      } else {
        const failure = describeFailure(error, CHECKOUT_COPY);
        setFull(error instanceof ApiFailure && error.code === "cohort_full");
        setFields(failure.fields);
        setAlert(failure.alert);
      }
    } finally {
      setPending(null);
    }
  };

  const join = async () => {
    if (!cohort || pending) return;
    setPending("join");
    setAlert(null);
    try {
      const body = await api<{ waitlist_entry: { position: number } }>("POST", `/api/cohorts/${cohort.id}/waitlist`);
      setOnWaitlist(true);
      announce(`You're number ${body.waitlist_entry.position} on the waitlist.`);
    } catch (error) {
      setAlert(describeFailure(error, WAITLIST_COPY).alert);
    } finally {
      setPending(null);
    }
  };

  const leave = async () => {
    if (!cohort || pending) return;
    setPending("leave");
    try {
      await api("DELETE", `/api/cohorts/${cohort.id}/waitlist`);
      setOnWaitlist(false);
      announce("You've left the waitlist.");
    } catch (error) {
      setAlert(describeFailure(error).alert);
    } finally {
      setPending(null);
    }
  };

  const free = quote?.learner_share === "0.00";
  return (
    <>
      <p>
        <span className="serif" style={{ fontSize: "19.2px" }}>
          {course.title}
        </span>
        {cohort && <span className="muted"> · {cohort.name}</span>}
      </p>
      {alert && <Alert>{alert}</Alert>}
      <FieldError id="checkout-cohort-error" message={fields.cohort_id ?? fields.quoted_learner_share} />
      <div className="money">
        <div>
          <span>List price</span>
          <span className="fig">{quote ? `$${quote.list_price}` : <span className="skeleton" />}</span>
        </div>
        {quote?.sponsor && (
          <div>
            <span>Paid by {quote.sponsor}</span>
            <span className="fig">${quote.employer_share}</span>
          </div>
        )}
        <div className="total">
          <span>Your share</span>
          <span className="fig">{quote ? `$${quote.learner_share}` : <span className="skeleton" />}</span>
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn secondary" onClick={() => close()}>
          Cancel
        </button>
        {full && cohort && !onWaitlist && (
          <button type="button" className={`btn secondary${pending === "join" ? " busy" : ""}`} disabled={pending !== null} onClick={join}>
            {pending === "join" ? "Joining the waitlist…" : "Join waitlist"}
          </button>
        )}
        {onWaitlist && (
          <button type="button" className={`btn secondary${pending === "leave" ? " busy" : ""}`} disabled={pending !== null} onClick={leave}>
            {pending === "leave" ? "Leaving the waitlist…" : "Leave waitlist"}
          </button>
        )}
        <button ref={payRef} type="button" data-primary="" className={`btn${pending === "pay" ? " busy" : ""}`} disabled={!quote || pending !== null} onClick={pay}>
          {pending === "pay" ? "Recording your payment…" : free ? "Confirm enrolment" : `Pay $${quote?.learner_share ?? ""}`}
        </button>
      </div>
    </>
  );
}

interface CohortChoicesProps {
  cohorts: Cohort[];
  selected: string | null;
  /** False once the learner is enrolled (or for roles that cannot enrol): the list is shown read-only. */
  choosable: boolean;
  enrolledIn: string | null;
  onSelect: (id: string) => void;
}

function CohortChoices({ cohorts, selected, choosable, enrolledIn, onSelect }: CohortChoicesProps) {
  return (
    <div className="stack">
      <h2 id="cohort-label" className="label" style={{ fontSize: "19.2px" }}>
        Cohort
      </h2>
      <div role="radiogroup" aria-labelledby="cohort-label" className="choices">
        {cohorts.map((cohort) => {
          const reason =
            enrolledIn === cohort.id
              ? "You're enrolled in this cohort."
              : !cohort.open
                ? "Enrolment has closed."
                : cohort.seats_remaining <= 0
                  ? "Full: no seats remaining."
                  : null;
          return (
            <label key={cohort.id} className="choice">
              <input
                type="radio"
                name="cohort"
                value={cohort.id}
                checked={choosable ? selected === cohort.id : enrolledIn === cohort.id}
                disabled={!choosable || reason !== null}
                onChange={() => onSelect(cohort.id)}
                aria-labelledby={`cohort-${cohort.id}`}
                aria-describedby={`cohort-${cohort.id}-details`}
              />
              <span className="choice-body">
                <strong id={`cohort-${cohort.id}`}>{cohort.name}</strong>
                <span id={`cohort-${cohort.id}-details`} className="hint">
                  Starts {monDYyyy(cohort.starts_on)}. {closeLine(cohort.close_date)}. <span className="fig">{cohort.seats_remaining} seats remaining</span>
                  {reason && <strong className="choice-reason">{reason}</strong>}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export function CoursePage({ courseId, user }: { courseId: string; user: User }) {
  const learner = user.role === "learner";
  const page = useLoad<PageData>(async () => {
    const { course } = await api<{ course: Course }>("GET", `/api/courses/${encodeURIComponent(courseId)}`);
    if (!learner) return { course, enrolment: null, certificate: null };
    const { enrolments } = await api<{ enrolments: Enrolment[] }>("GET", "/api/me/enrolments");
    const enrolment = enrolments.find((e) => e.course_id === course.id && OPEN_STATES.has(e.state)) ?? null;
    const certificate = enrolment?.certificate_id
      ? (await api<{ certificate: Certificate }>("GET", `/api/certificates/${enrolment.certificate_id}`)).certificate
      : null;
    return { course, enrolment, certificate };
  });
  const [checkout, setCheckout] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const focusContinue = useRef(false);
  const continueRef = useRef<HTMLAnchorElement>(null);

  const data = page.data;
  const cohorts = data?.course.cohorts ?? [];
  useEffect(() => {
    if (selected === null) {
      const first = cohorts.find((c) => c.open && c.seats_remaining > 0);
      if (first) setSelected(first.id);
    }
  }, [cohorts, selected]);

  useEffect(() => {
    if (focusContinue.current && continueRef.current) {
      focusContinue.current = false;
      continueRef.current.focus();
    }
  });

  if (!data) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading the course…</p>;
  const { course, enrolment, certificate } = data;
  const verified = new Set(enrolment?.modules.filter((m) => m.status === "verified").map((m) => m.id) ?? []);
  const modules = course.modules ?? [];
  const cohort = cohorts.find((c) => c.id === selected) ?? null;

  return (
    <div className="grid course-grid">
      <div className="span-8 stack course-main">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <p className="eyebrow">
            {formatLabel(course.format)} · {course.contact_hours} contact hours
          </p>
          <PageHeading>{course.title}</PageHeading>
          <p className="lede">{course.summary}</p>
          <p className="muted">By {course.author.display_name}</p>
        </div>
      </div>
      <aside className="span-4 course-aside" aria-label="Enrolment">
        <div className="seal-wrap">
          <Seal
            modules={modules.map((m) => ({ id: m.id, number: m.position, title: m.title, minutes: m.minutes, verified: verified.has(m.id) }))}
            totalMinutes={course.total_minutes}
            state={sealStateOf(certificate)}
            numeral={certificate?.contact_hours ?? null}
            ringText={certificate?.issued_on ? { serial: certificate.serial, issued: monDYyyy(certificate.issued_on) } : null}
          />
        </div>
        <div className="price-block">
          <div className="row-actions" style={{ justifyContent: "space-between" }}>
            <span className="muted">List price</span>
            <span className="price fig">${course.list_price}</span>
          </div>
          {course.format === "cohort" && cohorts.length > 0 && (
            <CohortChoices
              cohorts={cohorts}
              selected={selected}
              choosable={learner && !enrolment && course.state === "published"}
              enrolledIn={enrolment?.cohort_id ?? null}
              onSelect={setSelected}
            />
          )}
          {enrolment ? (
            <Link to={continueTarget(enrolment)} className="btn" ref={continueRef}>
              Continue learning
            </Link>
          ) : course.state === "withdrawn" ? (
            <p className="withdrawn-note">This course has been withdrawn and is no longer open for enrolment.</p>
          ) : learner && course.state === "published" ? (
            <button type="button" className="btn" onClick={() => setCheckout(true)}>
              Enrol
            </button>
          ) : user.role === "coordinator" && course.format === "self_paced" ? (
            <p className="muted">
              Buy seats for your nurses from <Link to="/sponsor">Hospital seats</Link>.
            </p>
          ) : null}
        </div>
      </aside>
      <section className="span-8 course-modules" aria-labelledby="modules-heading">
        <div className="section-head">
          <h2 id="modules-heading">Modules</h2>
          <span className="muted fig">{course.total_minutes} minutes in total</span>
        </div>
        <ul className="ruled" aria-label="Modules">
          {modules.map((m) => (
            <li key={m.id} className="module-row">
              <span className="num">{m.position}.</span>
              <span>{m.title}</span>
              <span className="fig muted">{m.minutes} min</span>
              <StatusGlyph verified={verified.has(m.id)} />
            </li>
          ))}
        </ul>
      </section>
      {checkout && (
        <Dialog title="Checkout" onClosed={() => setCheckout(false)}>
          {(close) => (
            <Checkout
              course={course}
              cohort={course.format === "cohort" ? cohort : null}
              close={close}
              onEnrolled={() => {
                focusContinue.current = true;
                void page.reload();
              }}
            />
          )}
        </Dialog>
      )}
    </div>
  );
}
