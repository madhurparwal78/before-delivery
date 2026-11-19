import { useEffect, useId, useState } from "react";
import type { Cohort } from "../../shared/api";
import { formatPrice } from "../../shared/money";
import { api } from "../api";
import { phaseLabel } from "../copy";
import { navigate } from "../router";
import { EmptyNightDrawing } from "../ui/icons";

const LAST_NIGHT_OFFSET_DAYS = 27;

/** `starts_on` + 27 days, the cohort's last night, as YYYY-MM-DD. */
function lastNight(startsOn: string): string {
  const day = new Date(`${startsOn}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + LAST_NIGHT_OFFSET_DAYS);
  return day.toISOString().slice(0, 10);
}

function seatsCopy(seatsLeft: number): string {
  if (seatsLeft <= 0) return "Full";
  return seatsLeft === 1 ? "1 seat left" : `${seatsLeft} seats left`;
}

function CohortCard({ cohort }: { cohort: Cohort }) {
  const titleId = useId();
  const full = cohort.seats_left <= 0;
  return (
    <li>
      <article className="cohort-card panel" aria-labelledby={titleId}>
        <span className="pill">{phaseLabel(cohort)}</span>
        <h2 id={titleId}>{cohort.name}</h2>
        <div className="cohort-meta">
          <span>{cohort.coach_name}</span>
          <span>{`Nights ${cohort.starts_on} – ${lastNight(cohort.starts_on)}`}</span>
        </div>
        <div className="cohort-facts">
          <span className="price">{formatPrice(cohort.price_cents)}</span>
          <span>{seatsCopy(cohort.seats_left)}</span>
        </div>
        <button type="button" className="button primary" aria-label={`Enroll in ${cohort.name}`} disabled={full} onClick={() => navigate(`/enroll/${cohort.id}`)}>
          Enroll
        </button>
      </article>
    </li>
  );
}

export function Cohorts() {
  const [cohorts, setCohorts] = useState<Cohort[] | null>(null);
  const [problem, setProblem] = useState("");
  useEffect(() => {
    api<{ cohorts: Cohort[] }>("GET", "/api/cohorts")
      .then((result) => setCohorts(result.data.cohorts ?? []))
      .catch(() => setProblem("Cohorts could not be loaded. Check your connection and reload."));
  }, []);
  return (
    <main className="page">
      <h1>Open cohorts</h1>
      <p className="lede">Four weeks of induction practice: a baseline week of recall, then three technique weeks with your coach.</p>
      {problem ? <p className="notice">{problem}</p> : null}
      {cohorts === null && !problem ? (
        <div className="cohort-grid" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 260 }} />
          ))}
        </div>
      ) : null}
      {cohorts?.length === 0 ? (
        <div className="empty" style={{ marginTop: 32 }}>
          <EmptyNightDrawing />
          <p>No cohorts are open for enrollment right now.</p>
        </div>
      ) : null}
      {cohorts && cohorts.length > 0 ? (
        <ul className="cohort-grid">
          {cohorts.map((cohort) => (
            <CohortCard key={cohort.id} cohort={cohort} />
          ))}
        </ul>
      ) : null}
    </main>
  );
}
