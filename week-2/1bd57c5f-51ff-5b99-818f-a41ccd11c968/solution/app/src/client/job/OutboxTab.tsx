import { useEffect, useState } from "react";
import type { OutboxEntry } from "../../shared/domain";
import { api } from "../api";
import { COPY } from "../copy";
import { localDateTime } from "../time";
import { useJob } from "./context";

const REFRESH_MS = 15_000;

export function OutboxTab() {
  const { job } = useJob();
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      api<{ entries: OutboxEntry[] }>("GET", `/api/jobs/${job.id}/outbox`)
        .then(({ entries: list }) => live && setEntries(list))
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [job.id]);

  return (
    <div className="panel">
      <section className="panel-section" aria-labelledby="outbox-heading">
        <h2 id="outbox-heading">Outbox</h2>
        <p className="muted">Every email Snaglight sends for this job. A message waits here while mail is unreachable and goes out once it returns.</p>
        {entries === null ? (
          <p className="loading">Loading</p>
        ) : (
          <div className="table-wrap">
            <table aria-label="Outbox">
              <thead>
                <tr>
                  <th scope="col">Sent to</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Status</th>
                  <th scope="col">Queued at</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="wrap">{entry.to}</td>
                    <td className="wrap">{entry.subject}</td>
                    <td>{entry.status === "sent" ? COPY.sent : COPY.notSent}</td>
                    <td className="mono">{localDateTime(entry.created_at, job.time_zone)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {entries?.length === 0 && <p className="muted">No email has been queued for this job yet.</p>}
      </section>
    </div>
  );
}
