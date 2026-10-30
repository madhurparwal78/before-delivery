import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { fieldErrorOf, request } from '../lib/api.js';
import { useFeedback } from '../lib/feedback.js';
import {
  CERTIFICATE_STATE_LABELS,
  closeLine,
  COURSE_STATE_LABELS,
  formatInstantDate,
} from '../lib/format.js';
import { Link } from '../lib/router.js';
import { Dialog } from '../components/Dialog.js';
import type { Certificate, Cohort, Course, RefundRequest } from '../lib/types.js';

const SEARCH_DEBOUNCE_MS = 250;

function plannerCopy(code: string, payload: Record<string, unknown>): string | null {
  switch (code) {
    case 'stale_version':
      return 'Someone else saved this course a moment ago. Reload to see their changes before saving again.';
    case 'course_not_editable':
      return 'This course can\u2019t be edited in its current state.';
    case 'invalid_transition': {
      const from = payload['from'];
      const to = payload['to'];
      if (to === 'reissued' || to === 'revoked') {
        return 'Only a sealed certificate can be reissued or revoked.';
      }
      return `This course can\u2019t move from ${COURSE_STATE_LABELS[String(from)] ?? String(from)} to ${
        COURSE_STATE_LABELS[String(to)] ?? String(to)
      }.`;
    }
    case 'reissue_pending':
      return 'A reissue for this certificate is still being stored.';
    case 'payments_unavailable':
      return 'Payments are unavailable right now. Nothing was refunded. Try again in a few minutes.';
    case 'already_certified':
      return 'This nurse has finished the course, so no refund is due.';
    case 'request_closed':
      return 'This refund request has already been decided.';
    case 'cap_below_enrolled':
      return 'The seat cap can\u2019t be lower than the nurses already enrolled.';
    case 'course_not_open':
      return 'This course is no longer open for enrolment.';
    default:
      return null;
  }
}

export function Planner(): ReactNode {
  const feedback = useFeedback();
  const [courses, setCourses] = useState<Course[]>([]);
  const [refunds, setRefunds] = useState<RefundRequest[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [cohortCourse, setCohortCourse] = useState<Course | null>(null);
  const [cohortName, setCohortName] = useState('');
  const [seatCap, setSeatCap] = useState(20);
  const [startsOn, setStartsOn] = useState('');
  const [closesOn, setClosesOn] = useState('');
  const [cohortErrors, setCohortErrors] = useState<Record<string, string>>({});
  const [certificateAction, setCertificateAction] = useState<
    { readonly kind: 'reissue' | 'revoke'; readonly certificate: Certificate } | null
  >(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const debounce = useRef<number | null>(null);

  const loadCertificates = useCallback(
    async (text: string): Promise<void> => {
      try {
        const result = await request<{ certificates: Certificate[] }>(
          `/api/planner/certificates?q=${encodeURIComponent(text)}`,
        );
        setCertificates(result.certificates);
        setSearchError(null);
      } catch (error) {
        const message = fieldErrorOf(error, 'q');
        if (message !== null) setSearchError(message);
        else feedback.report(error, plannerCopy);
      }
    },
    [feedback],
  );

  const load = useCallback(async (): Promise<void> => {
    const courseResult = await request<{ courses: Course[] }>('/api/courses');
    const detailed: Course[] = [];
    for (const summary of courseResult.courses) {
      const full = await request<{ course: Course }>(`/api/courses/${summary.id}`);
      detailed.push(full.course);
    }
    setCourses(detailed);
    const refundResult = await request<{ refund_requests: RefundRequest[] }>('/api/refund-requests');
    setRefunds(refundResult.refund_requests);
  }, []);

  useEffect(() => {
    void load().catch(() => undefined);
    void loadCertificates('').catch(() => undefined);
  }, [load, loadCertificates]);

  async function moveCourse(course: Course, to: string): Promise<void> {
    if (pending) return;
    setPending(true);
    setNoteErrors({});
    feedback.announce('Saving…');
    const note = notes[course.id] ?? '';
    try {
      await request(`/api/courses/${course.id}/transitions`, {
        method: 'POST',
        body: { to, note: note === '' ? null : note },
        ifMatch: course.version,
      });
      await load();
      feedback.announce(`Course moved to ${COURSE_STATE_LABELS[to] ?? to}.`);
    } catch (error) {
      const message = fieldErrorOf(error, 'note');
      if (message !== null) {
        setNoteErrors({ [course.id]: message });
        feedback.clear();
      } else {
        feedback.report(error, plannerCopy);
      }
    } finally {
      setPending(false);
    }
  }

  async function decideRefund(entry: RefundRequest, action: 'approve' | 'decline'): Promise<void> {
    if (pending) return;
    setPending(true);
    feedback.announce(action === 'approve' ? 'Recording the refund…' : 'Saving…');
    try {
      await request(`/api/refund-requests/${entry.id}/${action}`, { method: 'POST', body: {} });
      await load();
      feedback.announce(
        action === 'approve' ? `Refund of $${entry.refund_total} recorded.` : 'Refund declined.',
      );
    } catch (error) {
      feedback.report(error, plannerCopy);
    } finally {
      setPending(false);
    }
  }

  async function createCohort(): Promise<void> {
    if (cohortCourse === null || pending) return;
    setPending(true);
    setCohortErrors({});
    feedback.announce('Saving…');
    try {
      await request(`/api/courses/${cohortCourse.id}/cohorts`, {
        method: 'POST',
        body: { name: cohortName, seat_cap: seatCap, starts_on: startsOn, close_date: closesOn },
      });
      setCohortCourse(null);
      await load();
      feedback.announce('Cohort saved.');
    } catch (error) {
      const errors: Record<string, string> = {};
      for (const field of ['name', 'seat_cap', 'starts_on', 'close_date']) {
        const message = fieldErrorOf(error, field);
        if (message !== null) errors[field] = message;
      }
      if (Object.keys(errors).length > 0) {
        setCohortErrors(errors);
        feedback.clear();
      } else {
        feedback.report(error, plannerCopy);
      }
    } finally {
      setPending(false);
    }
  }

  async function decideCertificate(): Promise<void> {
    if (certificateAction === null || pending) return;
    setPending(true);
    setReasonError(null);
    feedback.announce(certificateAction.kind === 'reissue' ? 'Reissuing…' : 'Revoking…');
    try {
      const result = await request<{ certificate: Certificate }>(
        `/api/certificates/${certificateAction.certificate.id}/${certificateAction.kind}`,
        { method: 'POST', body: { reason } },
      );
      setCertificateAction(null);
      setReason('');
      await loadCertificates(search);
      if (certificateAction.kind === 'reissue') {
        feedback.announce(
          result.certificate.reissue_pending
            ? 'Reissue recorded. The new PDF is still being stored.'
            : `Certificate reissued as version ${result.certificate.version}.`,
        );
      } else {
        feedback.announce('Certificate revoked.');
      }
    } catch (error) {
      const message = fieldErrorOf(error, 'reason');
      if (message !== null) {
        setReasonError(message);
        feedback.clear();
      } else {
        feedback.report(error, plannerCopy);
      }
    } finally {
      setPending(false);
    }
  }

  const inReview = courses.filter((course) => course.state === 'in_review');
  const published = courses.filter((course) => course.state === 'published');
  const cohortCourses = courses.filter((course) => course.format === 'cohort');
  const allCohorts: { course: Course; cohort: Cohort }[] = cohortCourses.flatMap((course) =>
    (course.cohorts ?? []).map((cohort) => ({ course, cohort })),
  );

  return (
    <>
      <h1>Planner</h1>

      <section className="region" aria-label="Review queue">
        <h2>Review queue</h2>
        {inReview.length === 0 ? <p className="hint">No courses are waiting for review.</p> : null}
        <ul className="rows">
          {inReview.map((course) => (
            <li key={course.id} className="row">
              <span className="row__main">
                <span className="row__title">{course.title}</span>
                <div className="hint">
                  {COURSE_STATE_LABELS[course.state]} · version {course.version} · {course.contact_hours} contact
                  hours
                </div>
                <div className="field" style={{ marginTop: '0.75rem', maxWidth: '26rem' }}>
                  <label htmlFor={`note-${course.id}`}>Note to author</label>
                  <textarea
                    id={`note-${course.id}`}
                    value={notes[course.id] ?? ''}
                    aria-describedby={noteErrors[course.id] === undefined ? undefined : `note-error-${course.id}`}
                    onChange={(event) =>
                      setNotes((value) => ({ ...value, [course.id]: event.target.value }))
                    }
                  />
                  {noteErrors[course.id] === undefined ? null : (
                    <p className="field__error" id={`note-error-${course.id}`}>
                      {noteErrors[course.id]}
                    </p>
                  )}
                </div>
              </span>
              <span className="row__figures inline-actions">
                <button type="button" disabled={pending} onClick={() => void moveCourse(course, 'published')}>
                  Approve and publish
                </button>
                <button
                  type="button"
                  className="quiet"
                  disabled={pending}
                  onClick={() => void moveCourse(course, 'draft')}
                >
                  Return to author
                </button>
              </span>
            </li>
          ))}
        </ul>
        <h3 style={{ fontSize: 'var(--h5)' }}>Published courses</h3>
        <ul className="rows">
          {published.map((course) => (
            <li key={course.id} className="row">
              <span className="row__main">
                <span className="row__title">{course.title}</span>
                <div className="hint">version {course.version}</div>
              </span>
              <span className="row__figures inline-actions">
                <button
                  type="button"
                  className="quiet"
                  disabled={pending}
                  onClick={() => void moveCourse(course, 'withdrawn')}
                >
                  Withdraw course
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="region" aria-label="Cohorts">
        <h2>Cohorts</h2>
        <button
          type="button"
          disabled={cohortCourses.length === 0}
          onClick={() => {
            setCohortName('');
            setSeatCap(20);
            setStartsOn('');
            setClosesOn('');
            setCohortErrors({});
            setCohortCourse(cohortCourses[0] ?? null);
          }}
        >
          New cohort
        </button>
        <ul className="rows">
          {allCohorts.map(({ course, cohort }) => (
            <li key={cohort.id} className="row">
              <span className="row__main">
                <Link to={`/planner/cohorts/${cohort.id}`} className="row__title">
                  {cohort.name}
                </Link>
                <div className="hint">
                  {course.title} · {closeLine(cohort.close_date)}
                </div>
              </span>
              <span className="row__figures">
                <span>Seats remaining {cohort.seats_remaining}</span>
                <span>Cap {cohort.seat_cap}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="region" aria-label="Refund requests">
        <h2>Refund requests</h2>
        {refunds.length === 0 ? <p className="hint">No refund requests.</p> : null}
        <ul className="rows">
          {refunds.map((entry) => (
            <li key={entry.id} className="row">
              <span className="row__main">
                <span className="row__title">{entry.course_title}</span>
                <div className="hint">
                  {entry.nurse_name} · {entry.reason}
                </div>
                <div>Refund due ${entry.refund_total}</div>
              </span>
              <span className="row__figures inline-actions">
                {entry.state === 'pending' ? (
                  <>
                    <button type="button" disabled={pending} onClick={() => void decideRefund(entry, 'approve')}>
                      Approve refund
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={pending}
                      onClick={() => void decideRefund(entry, 'decline')}
                    >
                      Decline refund
                    </button>
                  </>
                ) : (
                  <span className="decision-line">
                    {entry.state === 'approved' ? 'Approved' : 'Declined'} by{' '}
                    {entry.decided_by?.display_name ?? 'the planner'} on{' '}
                    {entry.decided_at === null ? '' : formatInstantDate(entry.decided_at)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="region" aria-label="Certificates">
        <h2>Certificates</h2>
        <div className="field">
          <label htmlFor="certificate-search">Search certificates</label>
          <input
            id="certificate-search"
            type="search"
            value={search}
            aria-describedby={searchError === null ? undefined : 'certificate-search-error'}
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              if (debounce.current !== null) window.clearTimeout(debounce.current);
              debounce.current = window.setTimeout(() => void loadCertificates(value), SEARCH_DEBOUNCE_MS);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              if (debounce.current !== null) window.clearTimeout(debounce.current);
              void loadCertificates(search);
            }}
          />
          {searchError === null ? null : (
            <p className="field__error" id="certificate-search-error">
              {searchError}
            </p>
          )}
        </div>
        <ul className="rows">
          {certificates.map((certificate) => (
            <li key={certificate.id} className="row">
              <span className="row__main">
                <span className="row__title">{certificate.serial}</span>
                <div className="hint">
                  {certificate.nurse_name} · {certificate.course_title} ·{' '}
                  {CERTIFICATE_STATE_LABELS[certificate.state]} · version {certificate.version}
                  {certificate.reissue_pending ? ' · reissue pending' : ''}
                </div>
              </span>
              <span className="row__figures inline-actions">
                <span>{certificate.contact_hours}</span>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setReason('');
                    setReasonError(null);
                    setCertificateAction({ kind: 'reissue', certificate });
                  }}
                >
                  Reissue
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setReason('');
                    setReasonError(null);
                    setCertificateAction({ kind: 'revoke', certificate });
                  }}
                >
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {cohortCourse === null ? null : (
        <Dialog title="New cohort" onClose={() => setCohortCourse(null)}>
          <div className="field">
            <label htmlFor="cohort-course">Course</label>
            <select
              id="cohort-course"
              value={cohortCourse.id}
              onChange={(event) =>
                setCohortCourse(cohortCourses.find((entry) => entry.id === event.target.value) ?? cohortCourse)
              }
            >
              {cohortCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cohort-name">Cohort name</label>
            <input
              id="cohort-name"
              type="text"
              value={cohortName}
              aria-describedby={cohortErrors['name'] === undefined ? undefined : 'cohort-name-error'}
              onChange={(event) => setCohortName(event.target.value)}
            />
            {cohortErrors['name'] === undefined ? null : (
              <p className="field__error" id="cohort-name-error">
                {cohortErrors['name']}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="cohort-cap">Seat cap</label>
            <input
              id="cohort-cap"
              type="number"
              min={1}
              max={500}
              value={seatCap}
              aria-describedby={cohortErrors['seat_cap'] === undefined ? undefined : 'cohort-cap-error'}
              onChange={(event) => setSeatCap(Number.parseInt(event.target.value, 10) || 0)}
            />
            {cohortErrors['seat_cap'] === undefined ? null : (
              <p className="field__error" id="cohort-cap-error">
                {cohortErrors['seat_cap']}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="cohort-starts">Starts on</label>
            <input
              id="cohort-starts"
              type="text"
              value={startsOn}
              aria-describedby={cohortErrors['starts_on'] === undefined ? undefined : 'cohort-starts-error'}
              onChange={(event) => setStartsOn(event.target.value)}
            />
            {cohortErrors['starts_on'] === undefined ? null : (
              <p className="field__error" id="cohort-starts-error">
                {cohortErrors['starts_on']}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="cohort-closes">Enrolment closes on</label>
            <input
              id="cohort-closes"
              type="text"
              value={closesOn}
              aria-describedby={cohortErrors['close_date'] === undefined ? undefined : 'cohort-closes-error'}
              onChange={(event) => setClosesOn(event.target.value)}
            />
            {cohortErrors['close_date'] === undefined ? null : (
              <p className="field__error" id="cohort-closes-error">
                {cohortErrors['close_date']}
              </p>
            )}
          </div>
          <div className="dialog__actions">
            <button type="button" disabled={pending} onClick={() => void createCohort()}>
              {pending ? 'Saving…' : 'Create cohort'}
            </button>
            <button type="button" className="quiet" onClick={() => setCohortCourse(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}

      {certificateAction === null ? null : (
        <Dialog
          title={certificateAction.kind === 'reissue' ? 'Reissue certificate' : 'Revoke certificate'}
          onClose={() => setCertificateAction(null)}
        >
          <p className="hint">
            {certificateAction.certificate.serial} · {certificateAction.certificate.nurse_name}
          </p>
          <div className="field">
            <label htmlFor="certificate-reason">Reason</label>
            <textarea
              id="certificate-reason"
              value={reason}
              aria-describedby={reasonError === null ? undefined : 'certificate-reason-error'}
              onChange={(event) => setReason(event.target.value)}
            />
            {reasonError === null ? null : (
              <p className="field__error" id="certificate-reason-error">
                {reasonError}
              </p>
            )}
          </div>
          <div className="dialog__actions">
            <button type="button" disabled={pending} onClick={() => void decideCertificate()}>
              {certificateAction.kind === 'reissue' ? 'Confirm reissue' : 'Confirm revoke'}
            </button>
            <button type="button" className="quiet" onClick={() => setCertificateAction(null)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
