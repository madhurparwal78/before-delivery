import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiFailure, newIdempotencyKey, NetworkFailure, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import { closeLine } from '../lib/format.js';
import { Link } from '../lib/router.js';
import { useWideLayout } from '../lib/viewport.js';
import { Dialog } from '../components/Dialog.js';
import { StatusGlyph } from '../components/Glyph.js';
import { Seal, type SealModule, type SealState } from '../components/Seal.js';
import type { Certificate, Cohort, Course, Enrolment, Quote, User } from '../lib/types.js';

const WAITLIST_KEY = 'credwell:waitlist:';

function checkoutCopy(code: string, payload: Record<string, unknown>): string | null {
  switch (code) {
    case 'course_not_open':
      return 'This course is no longer open for enrolment.';
    case 'cohort_full':
      return 'The last seat was just taken. Join the waitlist to hold your place in line.';
    case 'enrolment_closed':
      return 'Enrolment for this cohort has closed.';
    case 'already_enrolled':
      return 'You\u2019re already enrolled in this course.';
    case 'quote_changed': {
      const quote = payload['quote'];
      const share =
        typeof quote === 'object' && quote !== null ? (quote as Quote).learner_share : '0.00';
      return `The price changed while you were checking out. Your share is now $${share}.`;
    }
    case 'payments_unavailable':
      return 'Payments are unavailable right now. You have not been charged. Try again in a few minutes.';
    case 'seats_available':
      return 'A seat is open again. Choose Enrol to take it.';
    default:
      return null;
  }
}

function sealModules(course: Course, enrolment: Enrolment | null): SealModule[] {
  if (enrolment !== null) {
    return enrolment.modules.map((module) => ({
      id: module.id,
      title: module.title,
      minutes: module.minutes,
      verified: module.status === 'verified',
    }));
  }
  return (course.modules ?? []).map((module) => ({
    id: module.id,
    title: module.title,
    minutes: module.minutes,
    verified: false,
  }));
}

function cohortReason(cohort: Cohort): string | null {
  if (!cohort.open) return 'Enrolment for this cohort has closed.';
  if (cohort.seats_remaining <= 0) return 'This cohort is full.';
  return null;
}

export function CoursePage({ courseId, user }: { readonly courseId: string; readonly user: User }): ReactNode {
  const feedback = useFeedback();
  const [course, setCourse] = useState<Course | null>(null);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [pending, setPending] = useState(false);
  const [fullCohort, setFullCohort] = useState(false);
  const [focusPay, setFocusPay] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const wide = useWideLayout();
  const idempotencyKey = useRef<string>(newIdempotencyKey());
  const payButton = useRef<HTMLButtonElement>(null);
  const continueLink = useRef<HTMLAnchorElement>(null);
  const focusContinue = useRef(false);

  const load = useCallback(async (): Promise<void> => {
    const result = await request<{ course: Course }>(`/api/courses/${courseId}`);
    setCourse(result.course);
    if (user.role !== 'learner') return;
    const mine = await request<{ enrolments: Enrolment[] }>('/api/me/enrolments');
    const live =
      mine.enrolments.find(
        (entry) =>
          entry.course_id === courseId && entry.state !== 'refunded' && entry.state !== 'withdrawn',
      ) ?? null;
    setEnrolment(live);
    if (live?.certificate_id !== null && live?.certificate_id !== undefined) {
      const found = await request<{ certificate: Certificate }>(`/api/certificates/${live.certificate_id}`);
      setCertificate(found.certificate);
    } else {
      setCertificate(null);
    }
  }, [courseId, user.role]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (course === null || course.format !== 'cohort' || cohortId !== null) return;
    const first = (course.cohorts ?? []).find((cohort) => cohortReason(cohort) === null);
    if (first !== undefined) setCohortId(first.id);
  }, [course, cohortId]);

  useEffect(() => {
    if (cohortId === null) return;
    const stored = window.sessionStorage.getItem(`${WAITLIST_KEY}${cohortId}`);
    setWaitlistPosition(stored === null ? null : Number.parseInt(stored, 10));
  }, [cohortId]);

  // Pay is disabled while the request is in flight, so the focus waits for it to come back.
  useEffect(() => {
    if (!focusPay || pending) return;
    setFocusPay(false);
    payButton.current?.focus();
  }, [focusPay, pending]);

  useEffect(() => {
    if (focusContinue.current && continueLink.current !== null) {
      focusContinue.current = false;
      continueLink.current.focus();
    }
  }, [enrolment]);

  const selectedCohort = (course?.cohorts ?? []).find((cohort) => cohort.id === cohortId) ?? null;

  async function openCheckout(): Promise<void> {
    idempotencyKey.current = newIdempotencyKey();
    setFullCohort(false);
    feedback.clear();
    setDialogOpen(true);
    try {
      const fresh = await request<Quote>(`/api/checkout/quote?course_id=${courseId}`);
      setQuote(fresh);
    } catch (error) {
      feedback.report(error, checkoutCopy);
    }
  }

  async function pay(): Promise<void> {
    if (pending) return;
    setPending(true);
    feedback.announce('Recording your payment…');
    try {
      await request<{ enrolment: Enrolment }>('/api/checkout', {
        method: 'POST',
        body: {
          course_id: courseId,
          cohort_id: course?.format === 'cohort' ? cohortId : null,
          quoted_learner_share: quote?.learner_share ?? '0.00',
        },
        idempotencyKey: idempotencyKey.current,
      });
      setDialogOpen(false);
      focusContinue.current = true;
      await load();
      feedback.announce(`You\u2019re enrolled in ${course?.title ?? 'this course'}.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'quote_changed') {
        const replacement = error.payload['quote'];
        if (typeof replacement === 'object' && replacement !== null) setQuote(replacement as Quote);
        idempotencyKey.current = newIdempotencyKey();
        feedback.report(error, checkoutCopy);
        setFocusPay(true);
      } else if (error instanceof ApiFailure && error.code === 'cohort_full') {
        setFullCohort(true);
        idempotencyKey.current = newIdempotencyKey();
        feedback.report(error, checkoutCopy);
        await load();
      } else if (error instanceof NetworkFailure) {
        feedback.report(error, checkoutCopy);
      } else {
        feedback.report(error, checkoutCopy);
        idempotencyKey.current = newIdempotencyKey();
      }
    } finally {
      setPending(false);
    }
  }

  async function joinWaitlist(): Promise<void> {
    if (cohortId === null) return;
    feedback.announce('Joining the waitlist…');
    try {
      const result = await request<{ waitlist_entry: { position: number } }>(
        `/api/cohorts/${cohortId}/waitlist`,
        { method: 'POST' },
      );
      window.sessionStorage.setItem(`${WAITLIST_KEY}${cohortId}`, String(result.waitlist_entry.position));
      setWaitlistPosition(result.waitlist_entry.position);
      setDialogOpen(false);
      setFullCohort(false);
      feedback.announce(`You\u2019re number ${result.waitlist_entry.position} on the waitlist.`);
    } catch (error) {
      feedback.report(error, checkoutCopy);
    }
  }

  async function leaveWaitlist(): Promise<void> {
    if (cohortId === null) return;
    feedback.announce('Leaving the waitlist…');
    try {
      await request(`/api/cohorts/${cohortId}/waitlist`, { method: 'DELETE' });
      window.sessionStorage.removeItem(`${WAITLIST_KEY}${cohortId}`);
      setWaitlistPosition(null);
      feedback.announce('You\u2019ve left the waitlist.');
      await load();
    } catch (error) {
      feedback.report(error, checkoutCopy);
    }
  }

  if (course === null) return <p className="hint">Loading the course…</p>;

  const sealState: SealState =
    certificate === null ? 'open' : certificate.state === 'sealing' ? 'pending' : certificate.state;
  const learnerShare = quote?.learner_share ?? '0.00';
  const payLabel = learnerShare === '0.00' ? 'Confirm enrolment' : `Pay $${learnerShare}`;
  const canEnrol =
    user.role === 'learner' &&
    enrolment === null &&
    course.state === 'published' &&
    (course.format !== 'cohort' || (selectedCohort !== null && cohortReason(selectedCohort) === null));

  const summary = (
    <header>
      <h1>{course.title}</h1>
      <p>{course.summary}</p>
      <p className="hint">
        {course.total_minutes} minutes · {course.contact_hours} contact hours · ${course.list_price}
      </p>
    </header>
  );

  const modulesColumn = (
    <div className="col-main">
      <h2 className="sr-only">Modules</h2>
      <ul className="rows" aria-label="Modules">
        {(enrolment?.modules ?? course.modules ?? []).map((module) => (
          <li key={module.id} className="row">
            <span className="row__main">
              <span className="row__title">{module.title}</span>
            </span>
            <span className="row__figures">
              <span className="nowrap">{module.minutes} min</span>
              <StatusGlyph verified={'status' in module && module.status === 'verified'} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const sealColumn = (
    <div className="col-side">
      <div className="seal-wrap">
        <Seal
          state={sealState}
          modules={sealModules(course, enrolment)}
          hours={certificate?.contact_hours ?? course.contact_hours}
          serial={certificate?.serial ?? null}
          issuedOn={certificate?.issued_on ?? null}
        />
        <p className="hint" style={{ textAlign: 'center' }}>
          {course.contact_hours} contact hours on completion
        </p>
      </div>

      {course.format === 'cohort' ? (
        <fieldset style={{ border: 'none', padding: 0, margin: '1rem 0' }}>
          <legend className="total-label">Cohort</legend>
          <ul className="choices" role="radiogroup" aria-label="Cohort">
            {(course.cohorts ?? []).map((cohort) => {
              const reason = cohortReason(cohort);
              return (
                <li key={cohort.id} className="choice">
                  <label>
                    <input
                      type="radio"
                      name="cohort"
                      value={cohort.id}
                      aria-label={cohort.name}
                      disabled={reason !== null}
                      checked={cohortId === cohort.id}
                      onChange={() => setCohortId(cohort.id)}
                    />
                    <span>
                      <span className="choice__name">{cohort.name}</span>
                      <br />
                      <span className="hint">Starts {cohort.starts_on}</span>
                      <br />
                      <span className="hint">{cohort.seats_remaining} seats remaining</span>
                      <br />
                      <span className="hint">{closeLine(cohort.close_date)}</span>
                      {reason === null ? null : (
                        <>
                          <br />
                          <span className="hint">{reason}</span>
                        </>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}

      <div className="stack">
        <p className="total-figure">${course.list_price}</p>
        {course.state === 'withdrawn' && enrolment === null ? (
          <p>This course has been withdrawn and is no longer open for enrolment.</p>
        ) : null}
        {enrolment === null ? null : (
          <Link
            to={`/learn/${enrolment.id}/${enrolment.modules[0]?.id ?? 'evaluation'}`}
            className="button"
            ref={continueLink}
          >
            Continue learning
          </Link>
        )}
        {canEnrol ? (
          <button type="button" onClick={() => void openCheckout()}>
            Enrol
          </button>
        ) : null}
        {user.role === 'learner' &&
        enrolment === null &&
        selectedCohort !== null &&
        selectedCohort.open &&
        selectedCohort.seats_remaining <= 0 ? (
          <>
            {waitlistPosition === null ? null : (
              <p className="hint">You are number {waitlistPosition} on the waitlist.</p>
            )}
            <button type="button" className="quiet" onClick={() => void joinWaitlist()}>
              Join waitlist
            </button>
            <button type="button" className="quiet" onClick={() => void leaveWaitlist()}>
              Leave waitlist
            </button>
          </>
        ) : null}
      </div>
    </div>
  );

  return (
    <>
      {summary}
      <div className="grid">
        {wide ? modulesColumn : sealColumn}
        {wide ? sealColumn : modulesColumn}
      </div>

      {dialogOpen ? (
        <Dialog
          title="Checkout"
          onClose={() => {
            setDialogOpen(false);
            setFullCohort(false);
          }}
        >
          <ul className="money-rows">
            <li>
              <span>List price</span>
              <span className="amount">${quote?.list_price ?? course.list_price}</span>
            </li>
            <li>
              <span>Paid by {quote?.sponsor ?? 'your hospital'}</span>
              <span className="amount">${quote?.employer_share ?? '0.00'}</span>
            </li>
            <li>
              <span>Your share</span>
              <span className="amount">${learnerShare}</span>
            </li>
          </ul>
          {selectedCohort === null ? null : <p className="hint">{selectedCohort.name}</p>}
          <div className="dialog__actions">
            <button type="button" ref={payButton} disabled={pending} onClick={() => void pay()}>
              {pending ? 'Recording your payment…' : payLabel}
            </button>
            {fullCohort ? (
              <button type="button" className="quiet" onClick={() => void joinWaitlist()}>
                Join waitlist
              </button>
            ) : null}
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setDialogOpen(false);
                setFullCohort(false);
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
