// The client reviewer's own surveys, 20 at a time.
import { useLayoutEffect, useRef, useState } from "react";
import { api, type MissionSummary } from "../api";
import { usePoll } from "../hooks";
import { follow } from "../router";

const PAGE = 20;

export function Surveys() {
  const [missions, setMissions] = useState<MissionSummary[] | null>(null);
  const [shown, setShown] = useState(PAGE);
  const table = useRef<HTMLTableElement>(null);
  const focusRow = useRef<number | null>(null);
  usePoll(async () => {
    const r = await api<MissionSummary[]>("/api/missions");
    if (r.ok) setMissions(r.data);
  }, 10_000, []);

  useLayoutEffect(() => {
    if (focusRow.current === null) return;
    table.current?.querySelectorAll<HTMLAnchorElement>("tbody a")[focusRow.current]?.focus();
    focusRow.current = null;
  }, [shown]);

  const total = missions?.length ?? 0;
  const visible = missions?.slice(0, shown) ?? [];
  return (
    <main className="page">
      <h1>Your surveys</h1>
      {!missions ? <p className="muted">Loading surveys…</p> : (
        <>
          <p role="status" aria-live="polite" aria-label="Survey list">Showing {visible.length} of {total} surveys</p>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Surveys table">
            <table ref={table} aria-label="Surveys">
              <thead><tr><th>Name</th><th>Survey date</th><th>Status</th><th>Coverage</th></tr></thead>
              <tbody>
                {visible.map((m) => (
                  <tr key={m.id}>
                    <td><a href={`/surveys/${m.id}`} onClick={(e) => { e.preventDefault(); follow(`/surveys/${m.id}`); }}>{m.name}</a></td>
                    <td className="num">{m.survey_date}</td>
                    <td>{m.status}</td>
                    <td className="num">{m.counters.coverage_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown < total && (
            <button type="button" onClick={() => {
              focusRow.current = shown;
              setShown(shown + PAGE);
            }}>Load more surveys</button>
          )}
        </>
      )}
    </main>
  );
}
