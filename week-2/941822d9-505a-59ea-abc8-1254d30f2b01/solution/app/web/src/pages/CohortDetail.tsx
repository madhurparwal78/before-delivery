import { useEffect, useState, type FormEvent } from "react";
import { api, type Cohort, type EnrolmentState } from "../api";
import { closeLine, ENROLMENT_LABELS, instantDate, monDYyyy } from "../format";
import { Alert, describeFailure, FieldError, useFeedback } from "../ui/feedback";
import { Empty } from "../ui/icons";
import { Link, PageHeading } from "../ui/router";
import { useLoad } from "../ui/useLoad";

export function CohortDetail({ cohortId }: { cohortId: string }) {
  const { announce, showAlert } = useFeedback();
  const page = useLoad(() => api<{ cohort: Cohort }>("GET", `/api/cohorts/${encodeURIComponent(cohortId)}`));
  const [cap, setCap] = useState("");
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const cohort = page.data?.cohort ?? null;

  useEffect(() => {
    if (cohort) setCap(String(cohort.seat_cap));
  }, [cohort]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || !cohort) return;
    setPending(true);
    showAlert(null);
    try {
      await api("PATCH", `/api/cohorts/${cohort.id}`, { seat_cap: /^\d+$/.test(cap) ? parseInt(cap, 10) : cap });
      setFields({});
      announce("Cohort saved.");
      await page.reload();
    } catch (error) {
      const failure = describeFailure(error, { cap_below_enrolled: "The seat cap can't be lower than the nurses already enrolled." });
      setFields(failure.fields);
      showAlert(failure.alert);
    } finally {
      setPending(false);
    }
  };

  if (!cohort) return page.failure ? <Alert>{page.failure}</Alert> : <p aria-busy="true" className="muted">Loading the cohort…</p>;
  const roster = cohort.roster ?? [];
  const waitlist = cohort.waitlist ?? [];
  return (
    <>
      <div className="page-head">
        <p className="eyebrow">
          <Link to="/planner">Planner</Link> · Cohort
        </p>
        <PageHeading>{cohort.name}</PageHeading>
        <p className="lede">
          Starts {monDYyyy(cohort.starts_on)}. {closeLine(cohort.close_date)}.
        </p>
      </div>
      <div className="grid">
        <div className="span-8 stack">
          <dl className="facts">
            <dt>Seat cap</dt>
            <dd className="fig" style={{ textAlign: "left" }}>
              {cohort.seat_cap}
            </dd>
            <dt>Enrolment</dt>
            <dd>{cohort.open ? "Open" : "Closed"}</dd>
          </dl>
          <p className="price">Seats remaining {cohort.seats_remaining}</p>
          <section aria-labelledby="roster-heading" className="stack">
            <h2 id="roster-heading" style={{ fontSize: "var(--h3)" }}>
              Roster
            </h2>
            <table className="data stacks" aria-label="Roster">
              <thead>
                <tr>
                  <th scope="col">Nurse</th>
                  <th scope="col">Enrolment</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.enrolment_id}>
                    <td data-label="Nurse">{r.nurse_name}</td>
                    <td data-label="Enrolment">{ENROLMENT_LABELS[r.state as EnrolmentState] ?? r.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {roster.length === 0 && <Empty>No nurse has enrolled in this cohort yet.</Empty>}
          </section>
          <section aria-labelledby="waitlist-heading" className="stack">
            <h2 id="waitlist-heading" style={{ fontSize: "var(--h3)" }}>
              Waitlist
            </h2>
            <ol className="ruled" aria-label="Waitlist">
              {waitlist.map((w) => (
                <li key={`${w.position}-${w.nurse_name}`}>
                  <span className="fig">{w.position}.</span> {w.nurse_name} <span className="hint">joined {instantDate(w.joined_at)}</span>
                </li>
              ))}
            </ol>
            {waitlist.length === 0 && <Empty>Nobody is waiting for a seat.</Empty>}
          </section>
        </div>
        <form className="span-4 stack" onSubmit={save} noValidate>
          <h2 style={{ fontSize: "var(--h3)" }}>Change the seat cap</h2>
          <div className="field">
            <label htmlFor="seat-cap">Seat cap</label>
            <input id="seat-cap" type="number" min={1} max={500} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={fields.seat_cap ? true : undefined} aria-describedby={fields.seat_cap ? "seat-cap-error" : undefined} />
            <FieldError id="seat-cap-error" message={fields.seat_cap} />
          </div>
          <div>
            <button type="submit" className={`btn${pending ? " busy" : ""}`} disabled={pending}>
              {pending ? "Saving…" : "Save seat cap"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
