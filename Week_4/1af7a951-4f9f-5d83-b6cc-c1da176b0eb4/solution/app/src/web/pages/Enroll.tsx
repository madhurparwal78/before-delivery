import { useEffect, useId, useState, type FormEvent } from "react";
import type { Cohort, Enrollment } from "../../shared/api";
import { api } from "../api";
import { browserZone, COPY } from "../copy";
import { follow, navigate } from "../router";
import { FieldError, Status } from "../ui/Status";
import { useTimeZones } from "../zones";

export function Enroll({ cohortId }: { cohortId: string }) {
  const ids = { heading: useId(), name: useId(), email: useId(), zone: useId(), bedtime: useId() };
  const zones = useTimeZones();
  const [cohort, setCohort] = useState<Cohort | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [zone, setZone] = useState<string | null>(null);
  const [bedtime, setBedtime] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ cohort: Cohort }>("GET", `/api/cohorts/${encodeURIComponent(cohortId)}`)
      .then((result) => setCohort(result.status === 200 ? result.data.cohort : null))
      .catch(() => setCohort(null));
  }, [cohortId]);

  // The browser's zone when the server lists it, otherwise UTC.
  const chosenZone = zone ?? (zones?.includes(browserZone()) ? browserZone() : "UTC");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const result = await api<{ enrollment: Enrollment; access_code: string }>("POST", "/api/enrollments", {
        cohort_id: cohortId,
        name,
        email,
        home_tz: chosenZone,
        bedtime,
      });
      if (result.status === 201) {
        navigate(`/enrollments/${result.data.enrollment.id}`, { state: { accessCode: result.data.access_code } });
        return;
      }
      setErrors(result.data.errors ?? {});
      if (result.data.error === "enrollment_closed") setStatus(COPY.enrollmentClosed);
      if (result.data.error === "already_enrolled") setStatus(COPY.alreadyEnrolled);
    } catch {
      setStatus(COPY.needsConnection);
    } finally {
      setBusy(false);
    }
  };

  if (cohort === null) {
    return (
      <main className="column">
        <h1>Cohort not found</h1>
        <p className="lede">We couldn't find that cohort.</p>
        <a href="/" onClick={follow}>
          See open cohorts
        </a>
      </main>
    );
  }
  if (cohort === undefined) {
    return (
      <main className="column">
        <div className="skeleton" style={{ height: 420 }} aria-hidden="true" />
      </main>
    );
  }
  return (
    <main className="column">
      <form className="panel form-stack" aria-label={`Enroll in ${cohort.name}`} noValidate onSubmit={(event) => void submit(event)}>
        <h1 id={ids.heading}>{cohort.name}</h1>
        <p className="hint">Your coach sees your name and your practice counts, never your dream text.</p>
        <div className="field">
          <label htmlFor={ids.name}>Your name</label>
          <input id={ids.name} className="input" autoComplete="name" value={name} aria-describedby={`${ids.name}-error`} onChange={(e) => setName(e.target.value)} />
          <FieldError id={`${ids.name}-error`} message={errors.name} />
        </div>
        <div className="field">
          <label htmlFor={ids.email}>Email</label>
          <input id={ids.email} className="input" type="text" inputMode="email" autoComplete="email" value={email} aria-describedby={`${ids.email}-error`} onChange={(e) => setEmail(e.target.value)} />
          <FieldError id={`${ids.email}-error`} message={errors.email} />
        </div>
        <div className="field">
          <label htmlFor={ids.zone}>Home time zone</label>
          <select id={ids.zone} className="input" value={chosenZone} aria-describedby={`${ids.zone}-error`} onChange={(e) => setZone(e.target.value)}>
            {(zones ?? [chosenZone]).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <FieldError id={`${ids.zone}-error`} message={errors.home_tz} />
        </div>
        <div className="field">
          <label htmlFor={ids.bedtime}>Usual bedtime</label>
          <input id={ids.bedtime} className="input" inputMode="numeric" placeholder="22:30" value={bedtime} aria-describedby={`${ids.bedtime}-hint ${ids.bedtime}-error`} onChange={(e) => setBedtime(e.target.value)} />
          <p id={`${ids.bedtime}-hint`} className="hint">24-hour time, between 20:00 and 23:59.</p>
          <FieldError id={`${ids.bedtime}-error`} message={errors.bedtime} />
        </div>
        <button type="submit" className="button primary" disabled={busy}>
          Continue to payment
        </button>
        <Status label="Enrollment">{status}</Status>
      </form>
    </main>
  );
}
