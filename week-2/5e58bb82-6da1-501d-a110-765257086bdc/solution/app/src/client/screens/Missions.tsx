// Every mission in the mission order.
import { useState } from "react";
import { api, type MissionSummary } from "../api";
import { usePoll } from "../hooks";
import { follow } from "../router";

export function Missions() {
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  usePoll(async () => {
    const r = await api<MissionSummary[]>("/api/missions");
    if (r.ok) setMissions(r.data);
  }, 5000, []);
  return (
    <main className="page">
      <h1>Missions</h1>
      {!missions ? <p className="muted">Loading missions…</p> : (
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Missions table">
          <table aria-label="Missions">
            <thead><tr><th>Name</th><th>Client</th><th>Survey date</th><th>Status</th><th>Coverage</th></tr></thead>
            <tbody>
              {missions.map((m) => (
                <tr key={m.id}>
                  <td><a href={`/missions/${m.id}`} onClick={(e) => { e.preventDefault(); follow(`/missions/${m.id}`); }}>{m.name}</a></td>
                  <td>{m.client_name}</td>
                  <td className="num">{m.survey_date}</td>
                  <td>{m.status}</td>
                  <td className="num">{m.counters.coverage_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
