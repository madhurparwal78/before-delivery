// Objectives: the service strip and the objective panel, refreshed by clock and upload messages.
import { useState } from "react";
import { api } from "../lib/api";
import { useLive } from "../lib/live";
import { Link } from "../lib/router";
import { EmptyBand, LoadFailed, Skeleton } from "../lib/ui";
import { useResource } from "../lib/useResource";

interface Window { bad: number; total: number }
interface Objective {
  id: number;
  service: string;
  name: string;
  target: number;
  budget_remaining: string;
  objective: Window;
  long: Window & { burn: string };
  short: Window & { burn: string };
  status: string;
}

export function ObjectivesPage() {
  const list = useResource(() => api.get<{ objectives: Objective[] }>("/api/objectives"), []);
  const [picked, setPicked] = useState<string | null>(null);
  const refresh = (): void => {
    api.get<{ objectives: Objective[] }>("/api/objectives").then((next) => list.set(next), () => undefined);
  };
  useLive(["clock", "upload"], refresh);
  const objectives = list.data?.objectives ?? [];
  const current = objectives.find((o) => o.service === picked) ?? objectives[0];
  return (
    <div className="stack">
      <h1>Objectives</h1>
      {list.error ? <LoadFailed failure={list.error} onRetry={list.reload} /> : null}
      {!list.data && !list.error ? <Skeleton /> : null}
      {list.data?.objectives.length === 0 ? <EmptyBand line="No objectives yet."><Link to="/rules" className="btn btn-primary">Published rules</Link></EmptyBand> : null}
      {list.data && current ? (
        <>
          <ul className="services" aria-label="Services">
            {objectives.map((objective) => (
              <li key={objective.service}>
                <button type="button" className={`service-tile${objective.service === current.service ? " selected" : ""}`} aria-pressed={objective.service === current.service} onClick={() => setPicked(objective.service)}>{objective.service}</button>
              </li>
            ))}
          </ul>
          <section role="region" aria-label="Objective" className="card objective">
            <h2>{current.name}</h2>
            <p className="muted small">Target {current.target}% for service <span className="mono">{current.service}</span></p>
            <div className={`budget${current.status === "Burning fast" ? " budget-fast" : current.status === "Burning" ? " budget-burning" : ""}`} aria-hidden="true">
              <span style={{ width: `${Math.max(0, Math.min(100, Number(current.budget_remaining)))}%` }} />
            </div>
            <dl className="objective-lines mono">
              <div><dt className="sr-only">Budget</dt><dd>Budget remaining {current.budget_remaining}%</dd></div>
              <div><dt className="sr-only">Long</dt><dd>Long burn {current.long.burn}</dd></div>
              <div><dt className="sr-only">Short</dt><dd>Short burn {current.short.burn}</dd></div>
              <div><dt className="sr-only">Status</dt><dd>Status {current.status}</dd></div>
            </dl>
            <ul className="plain-list mono small">
              <li>30 day window: {current.objective.bad} bad of {current.objective.total}</li>
              <li>Long window: {current.long.bad} bad of {current.long.total}</li>
              <li>Short window: {current.short.bad} bad of {current.short.total}</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
