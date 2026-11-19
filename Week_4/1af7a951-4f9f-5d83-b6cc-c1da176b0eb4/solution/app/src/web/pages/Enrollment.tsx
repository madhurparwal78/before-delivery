import { useEffect, useState } from "react";
import type { Enrollment as EnrollmentView, Session } from "../../shared/api";
import { formatPrice } from "../../shared/money";
import { api } from "../api";
import { COPY } from "../copy";
import { navigate } from "../router";
import { AlertIcon, CheckIcon } from "../ui/icons";

/** The access code of the enrolment just created: it travels in this history entry only, never in storage or the address. */
function freshAccessCode(): string | null {
  const state: unknown = history.state;
  if (typeof state !== "object" || state === null || !("accessCode" in state)) return null;
  return typeof state.accessCode === "string" ? state.accessCode : null;
}

export function EnrollmentPage({ enrollmentId, onSignedIn }: { enrollmentId: string; onSignedIn: (session: Session) => void }) {
  const [enrollment, setEnrollment] = useState<EnrollmentView | null | undefined>(undefined);
  const [code] = useState(freshAccessCode);
  const [status, setStatus] = useState("");
  const [alert, setAlert] = useState("");
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    api<{ enrollment: EnrollmentView }>("GET", `/api/enrollments/${enrollmentId}`)
      .then((result) => setEnrollment(result.status === 200 ? result.data.enrollment : null))
      .catch(() => setEnrollment(null));
  }, [enrollmentId]);

  const pay = async () => {
    setPaying(true);
    setAlert("");
    setStatus(COPY.confirming);
    try {
      const result = await api<{ enrollment: EnrollmentView }>("POST", `/api/enrollments/${enrollmentId}/pay`);
      if (result.status === 200) {
        setEnrollment(result.data.enrollment);
        setStatus(`A receipt is on its way to ${result.data.enrollment.email}.`);
        return;
      }
      if (result.status === 409 && result.data.error === "illegal_transition") {
        const latest = await api<{ enrollment: EnrollmentView }>("GET", `/api/enrollments/${enrollmentId}`);
        if (latest.status === 200) setEnrollment(latest.data.enrollment);
        setStatus("");
        return;
      }
      setStatus(COPY.pendingNotice);
      const error = result.data.error;
      setAlert(
        error === "billing_unavailable" ? COPY.paymentOutage
          : error === "cohort_full" ? COPY.full
          : error === "enrollment_closed" ? COPY.enrollmentClosed
          : COPY.declined,
      );
    } catch {
      setStatus(COPY.pendingNotice);
      setAlert(COPY.paymentOutage);
    } finally {
      setPaying(false);
    }
  };

  const openLogbook = async () => {
    if (code) {
      const result = await api<Session>("POST", "/api/session", { access_code: code }).catch(() => null);
      if (result?.status === 200) {
        onSignedIn({ role: result.data.role, name: result.data.name, id: result.data.id });
        navigate("/logbook");
        return;
      }
    }
    navigate(`/signin?next=${encodeURIComponent("/logbook")}`);
  };

  if (enrollment === undefined) return <main className="column"><div className="skeleton" style={{ height: 320 }} aria-hidden="true" /></main>;
  if (enrollment === null) {
    return (
      <main className="column">
        <h1>Enrollment not found</h1>
        <p className="lede">We couldn't find that enrollment.</p>
      </main>
    );
  }
  const active = enrollment.status === "active";
  return (
    <main className="column">
      <div className="panel form-stack">
        <p className="hint">{enrollment.cohort_name}</p>
        <h1>{active ? "Enrolled" : enrollment.status === "refunded" ? "Refunded" : "Payment pending"}</h1>
        {code && !active ? (
          <div role="group" aria-label="Access code" className="access-code">
            <p>
              Your access code: <code>{code}</code>
            </p>
            <p className="hint">Keep it somewhere safe. You sign in with it every night.</p>
          </div>
        ) : null}
        {active && enrollment.first_night ? (
          <p>{`Your first night: ${enrollment.first_night} – bedtime ${enrollment.bedtime}, wake alarm ${enrollment.wake_alarm}.`}</p>
        ) : null}
        <dl className="facts">
          <div>
            <dt>Name</dt>
            <dd>{enrollment.name}</dd>
          </div>
          <div>
            <dt>Seat price</dt>
            <dd>{formatPrice(enrollment.price_cents)}</dd>
          </div>
          <div>
            <dt>Home time zone</dt>
            <dd>{enrollment.home_tz}</dd>
          </div>
        </dl>
        <div role="status" aria-label="Enrollment" className={active ? "status-line confirmed" : "status-line"}>
          {active && status ? <CheckIcon /> : null}
          {status || (enrollment.status === "pending_payment" ? COPY.pendingNotice : "")}
        </div>
        {enrollment.status === "pending_payment" ? (
          <button type="button" className="button primary" disabled={paying} onClick={() => void pay()}>
            {`Pay ${formatPrice(enrollment.price_cents)}`}
          </button>
        ) : null}
        <div role="alert" aria-label="Payment" className={enrollment.status === "pending_payment" ? "notice" : "notice spent"}>
          {alert ? <AlertIcon /> : null}
          {alert ? <span>{alert}</span> : null}
        </div>
        {active ? (
          <button type="button" className="button primary" onClick={() => void openLogbook()}>
            Open my logbook
          </button>
        ) : null}
      </div>
    </main>
  );
}
