import { useEffect, useState } from "react";
import { api } from "./api.js";
import { useConsole } from "./context.js";
import { local } from "./format.js";

export default function Audit() {
  const { report } = useConsole();
  const [events, setEvents] = useState(null);
  useEffect(() => {
    api("/api/audit").then((result) => {
      if (result.ok) setEvents(result.body.events);
      else report(result);
    });
  }, [report]);

  return (
    <div className="page">
      <div className="page-head"><h1>Audit log</h1></div>
      <section className="panel">
        <div className="table-frame" role="region" tabIndex={0} aria-label="Audit log table">
          <table className="data" aria-label="Audit log">
            <thead><tr><th scope="col">Seq</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Actor</th><th scope="col">Time</th></tr></thead>
            <tbody>
              {events?.map((event) => (
                <tr key={event.seq}>
                  <th scope="row" className="num">{event.seq}</th>
                  <td className="code">{event.action}</td>
                  <td className="code">{event.target_id}</td>
                  <td>{event.actor_email}</td>
                  <td className="num">{local(event.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {events?.length === 0 && <p className="empty">No changes recorded yet.</p>}
        </div>
      </section>
    </div>
  );
}
